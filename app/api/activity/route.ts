import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '../../../lib/cache';
import { getUserActivity, getAllUserActivity } from '../../../lib/polymarketApi';

const BATCH_SIZE_DEFAULT = 500; // 与官方 /activity limit 上限一致，减少请求次数

// 相同 user+days+range+useCache 的「全量拉取」并发请求共用一个 in-flight
const inFlightAllActivity = new Map<string, Promise<any[]>>();

/** 上个月1号 00:00:00 UTC 的 Unix 秒时间戳 */
function getLastMonthFirstUtcSeconds(): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1, 0, 0, 0, 0));
  return Math.floor(first.getTime() / 1000);
}

function getAllUserActivityCoalesced(
  user: string,
  days: number | null,
  startTimestamp: number | null,
  useCache: boolean,
  excludeDepositsWithdrawals: boolean,
  sortBy: string,
  sortDirection: string
): Promise<any[]> {
  const rangeKey = startTimestamp != null ? `s${startTimestamp}` : (days ?? 'all');
  const key = `${user.toLowerCase()}_${rangeKey}_${useCache}`;
  const existing = inFlightAllActivity.get(key);
  if (existing) return existing;
  const promise = getAllUserActivity(
    user,
    cacheManager,
    sortBy,
    sortDirection,
    BATCH_SIZE_DEFAULT,
    null,
    useCache,
    excludeDepositsWithdrawals,
    days,
    startTimestamp ?? undefined
  ).finally(() => {
    inFlightAllActivity.delete(key);
  });
  inFlightAllActivity.set(key, promise);
  return promise;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const user = searchParams.get('user');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const sortBy = searchParams.get('sort_by') || 'TIMESTAMP';
    const sortDirection = searchParams.get('sort_direction') || 'DESC';
    const useCacheParam = searchParams.get('use_cache');
    const excludeDepositsWithdrawalsParam = searchParams.get('excludeDepositsWithdrawals');
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
    const useCache = useCacheParam !== 'false';
    const excludeDepositsWithdrawals = excludeDepositsWithdrawalsParam !== 'false';
    const days = daysParam ? parseInt(daysParam, 10) : null;
    const rangeMonth = rangeParam === 'month';
    const startTimestamp = rangeMonth ? getLastMonthFirstUtcSeconds() : null;

    let data: any[];
    let message: string;

    if (limit === 0 || limit === -1) {
      data = await getAllUserActivityCoalesced(
        user,
        rangeMonth ? null : days,
        startTimestamp,
        useCache,
        excludeDepositsWithdrawals,
        sortBy,
        sortDirection
      );
      message = rangeMonth
        ? `成功获取上个月1日至当天 ${data.length} 条历史活动记录`
        : days
          ? `成功获取最近 ${days} 天 ${data.length} 条历史活动记录`
          : `成功获取所有 ${data.length} 条历史活动记录`;
    } else {
      if (limit < 1) {
        return NextResponse.json(
          { success: false, error: 'limit 参数无效，必须大于0（或使用0/-1获取所有记录）' },
          { status: 400 }
        );
      }

      data = await getUserActivity(
        user,
        cacheManager,
        limit,
        offset,
        sortBy,
        sortDirection,
        useCache,
        excludeDepositsWithdrawals
      );
      message = `成功获取 ${data.length} 条活动记录（offset: ${offset}, limit: ${limit}）`;
    }

    return NextResponse.json({
      success: true,
      count: data.length,
      data,
      message,
    });
  } catch (error: any) {
    console.error('[api/activity]', error?.message || error);
    if (error?.response) {
      console.error('[api/activity] Polymarket 响应', error.response?.status, error.response?.data);
    }
    const isTimeoutError =
      error.code === 'ECONNABORTED' ||
      error.message?.includes('timeout') ||
      error.message?.includes('超时') ||
      error.message?.includes('timed out');
    const is502503 =
      error.response?.status === 502 ||
      error.response?.status === 503 ||
      error.message?.includes('502') ||
      error.message?.includes('503') ||
      error.message?.includes('服务暂时不可用');

    const errorMessage = isTimeoutError
      ? '获取用户活动数据超时，数据量可能较大。请稍后重试，或尝试使用缓存数据。'
      : is502503
        ? 'Polymarket 服务暂时不可用，请稍后重试；若之前查过该地址，可去掉「强制刷新」用缓存数据。'
        : '获取用户活动失败';

    const statusCode = isTimeoutError ? 504 : is502503 ? 503 : 500;
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        detail: error.message || String(error),
        isTimeout: isTimeoutError,
        isServerUnavailable: is502503,
      },
      { status: statusCode }
    );
  }
}

