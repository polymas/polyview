import { NextRequest, NextResponse } from 'next/server';
import { fetchUserActivityFromAPI } from '../../../lib/polymarketApi';
import { mapItemToLegacyShape } from '../../../lib/activityMapping';

const POLY_PAGE_LIMIT = 500;
const POLY_MAX_OFFSET = 3000;
const DEFAULT_SEGMENTS = 6;

/** 本月1号 00:00:00 UTC 的 Unix 秒时间戳 */
function getCurrentMonthFirstUtcSeconds(): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  return Math.floor(first.getTime() / 1000);
}

/** 上个月时间范围（UTC 秒），到上个月最后一秒 */
function getLastMonthRangeUtcSeconds(): { from: number; to: number } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const currentMonthFirst = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const lastMonthFirst = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1, 0, 0, 0, 0));
  return {
    from: Math.floor(lastMonthFirst.getTime() / 1000),
    to: Math.floor(currentMonthFirst.getTime() / 1000) - 1,
  };
}

function getTimestamp(item: { timestamp?: number }): number {
  const t = item.timestamp ?? 0;
  return t > 1e10 ? Math.floor(t / 1000) : t;
}

function filterByConditionIdsFromEnv(data: Record<string, unknown>[]): Record<string, unknown>[] {
  const envIds = process.env.FILTER_CONDITION_IDS;
  if (!envIds) return data;
  const exclude = envIds
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0);
  if (exclude.length === 0) return data;
  return data.filter((row) => {
    const cid = (row.conditionId ?? row.condition_id ?? '') as string;
    if (!cid) return true;
    return !exclude.includes(String(cid).toLowerCase());
  });
}

function dedupeActivities(data: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];
  for (const item of data) {
    const key = [
      String(item.transactionHash ?? item.transaction_hash ?? ''),
      String(item.conditionId ?? item.condition_id ?? ''),
      String(item.tokenId ?? item.token_id ?? item.asset ?? ''),
      String(item.type ?? ''),
      String(item.timestamp ?? ''),
    ].join('_');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function splitRange(fromTs: number, toTs: number, segments: number): Array<{ start: number; end: number }> {
  const safeSegments = Math.max(1, segments);
  const total = Math.max(0, toTs - fromTs);
  const step = Math.max(1, Math.ceil(total / safeSegments));
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < safeSegments; i++) {
    const start = fromTs + i * step;
    const end = i === safeSegments - 1 ? toTs : Math.min(toTs, start + step - 1);
    if (start <= end) ranges.push({ start, end });
  }
  return ranges;
}

async function fetchSegmentActivity(
  user: string,
  start: number,
  end: number
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let offset = 0; offset <= POLY_MAX_OFFSET; offset += POLY_PAGE_LIMIT) {
    const batch = await fetchUserActivityFromAPI(
      user,
      POLY_PAGE_LIMIT,
      offset,
      'TIMESTAMP',
      'DESC',
      true,
      start,
      end
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...(batch as Record<string, unknown>[]));
    if (batch.length < POLY_PAGE_LIMIT) break;
  }
  return all;
}

async function fetchActivityConcurrently(
  user: string,
  fromTs: number,
  toTs: number
): Promise<Record<string, unknown>[]> {
  const segmentCount = Math.min(
    12,
    Math.max(1, Number(process.env.ACTIVITY_CONCURRENT_SEGMENTS || DEFAULT_SEGMENTS))
  );
  const ranges = splitRange(fromTs, toTs, segmentCount);
  const chunked = await Promise.all(ranges.map((r) => fetchSegmentActivity(user, r.start, r.end)));
  return chunked.flat();
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const user = searchParams.get('user');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const sortDirection = searchParams.get('sort_direction') || 'DESC';
    const useCacheParam = searchParams.get('use_cache');
    const daysParam = searchParams.get('days');
    const rangeParam = searchParams.get('range'); // month=本月, last_month=上个月

    if (!user) {
      return NextResponse.json(
        { success: false, error: '缺少必需参数: user' },
        { status: 400 }
      );
    }

    if (!user.startsWith('0x') || user.length !== 42) {
      return NextResponse.json(
        { success: false, error: '无效的用户地址格式，必须是0x开头的42位十六进制字符串' },
        { status: 400 }
      );
    }

    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
    const forceRefresh = useCacheParam === 'false';
    const rangeMode: 'month' | 'last_month' | null =
      rangeParam === 'last_month' ? 'last_month' : rangeParam === 'month' ? 'month' : null;
    const days = daysParam ? parseInt(daysParam, 10) : null;

    const nowSec = Math.floor(Date.now() / 1000);
    const currentMonthFirst = getCurrentMonthFirstUtcSeconds();
    const lastMonthRange = getLastMonthRangeUtcSeconds();
    const from_ts =
      rangeMode === 'month'
        ? currentMonthFirst
        : rangeMode === 'last_month'
          ? lastMonthRange.from
          : nowSec - (days ?? 180) * 24 * 60 * 60;
    const to_ts =
      rangeMode === 'last_month'
        ? lastMonthRange.to
        : nowSec;
    const started = Date.now();
    const raw = await fetchActivityConcurrently(user, from_ts, to_ts);
    const mapped = raw.map((item) => mapItemToLegacyShape(item));
    const data = dedupeActivities(filterByConditionIdsFromEnv(mapped));
    const elapsedSec = ((Date.now() - started) / 1000).toFixed(2);

    const sorted =
      sortDirection.toUpperCase() === 'ASC'
        ? [...data].sort((a, b) => getTimestamp(a as { timestamp?: number }) - getTimestamp(b as { timestamp?: number }))
        : [...data].sort((a, b) => getTimestamp(b as { timestamp?: number }) - getTimestamp(a as { timestamp?: number }));

    const sliced =
      limit > 0 && limit !== 3000 ? sorted.slice(offset, offset + limit) : sorted;
    const message =
      limit === 0 || limit === -1
        ? rangeMode === 'month'
          ? `成功并发获取本月 ${sliced.length} 条历史活动记录`
          : rangeMode === 'last_month'
            ? `成功并发获取上个月 ${sliced.length} 条历史活动记录`
          : days
            ? `成功获取最近 ${days} 天 ${sliced.length} 条历史活动记录`
            : `成功获取所有 ${sliced.length} 条历史活动记录`
        : `成功获取 ${sliced.length} 条活动记录（offset: ${offset}, limit: ${limit}）`;

    const body: Record<string, unknown> = {
      success: true,
      count: sliced.length,
      data: sliced,
      message,
    };
    body._debug = {
      backendRequestElapsedSec: elapsedSec,
      source: 'polymarket-data-api-concurrent',
    };
    return NextResponse.json(body);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    console.error('[api/activity]', err?.message || error);
    const isTimeout =
      err?.code === 'ECONNABORTED' ||
      err?.message?.includes('timeout') ||
      err?.message?.includes('超时') ||
      err?.message?.includes('timed out');
    const is5xx = err?.message?.includes('502') || err?.message?.includes('503') || err?.message?.includes('500');
    const errorMessage = isTimeout
      ? '获取用户活动数据超时，请稍后重试。'
      : is5xx
        ? '活动服务暂时不可用，请稍后重试。'
        : '获取用户活动失败';
    const statusCode = isTimeout ? 504 : is5xx ? 503 : 500;
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        detail: err?.message || String(error),
        isTimeout,
        isServerUnavailable: is5xx,
      },
      { status: statusCode }
    );
  }
}
