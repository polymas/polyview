import { NextRequest, NextResponse } from 'next/server';
import { getActivityFromPolyActivity } from '../../../lib/polyActivityApi';

/** 上个月1号 00:00:00 UTC 的 Unix 秒时间戳 */
function getLastMonthFirstUtcSeconds(): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1, 0, 0, 0, 0));
  return Math.floor(first.getTime() / 1000);
}

function getTimestamp(item: { timestamp?: number }): number {
  const t = item.timestamp ?? 0;
  return t > 1e10 ? Math.floor(t / 1000) : t;
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
    const rangeParam = searchParams.get('range'); // 'month' = 上个月1号 00:00 UTC 至当天

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
    const rangeMonth = rangeParam === 'month';
    const days = daysParam ? parseInt(daysParam, 10) : null;

    const nowSec = Math.floor(Date.now() / 1000);
    const from_ts = rangeMonth
      ? getLastMonthFirstUtcSeconds()
      : nowSec - (days ?? 180) * 24 * 60 * 60;
    const to_ts = nowSec;

    const requestLimit = limit === 0 || limit === -1 ? 3000 : Math.min(limit + offset, 3000);
    const result = await getActivityFromPolyActivity(user, {
      from_ts,
      to_ts,
      limit: requestLimit,
      force_refresh: forceRefresh,
    });
    const data = result.data;

    const sorted =
      sortDirection.toUpperCase() === 'ASC'
        ? [...data].sort((a, b) => getTimestamp(a as { timestamp?: number }) - getTimestamp(b as { timestamp?: number }))
        : [...data].sort((a, b) => getTimestamp(b as { timestamp?: number }) - getTimestamp(a as { timestamp?: number }));

    const sliced =
      limit > 0 && limit !== 3000 ? sorted.slice(offset, offset + limit) : sorted;
    const message =
      limit === 0 || limit === -1
        ? rangeMonth
          ? `成功获取上个月1日至当天 ${sliced.length} 条历史活动记录`
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
    if (result.backendRequestUrl != null || result.backendRequestElapsedSec != null) {
      body._debug = {
        backendRequestUrl: result.backendRequestUrl,
        backendRequestElapsedSec: result.backendRequestElapsedSec,
      };
    }
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
