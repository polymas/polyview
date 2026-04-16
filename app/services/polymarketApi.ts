import axios from 'axios';
import { PolymarketTransaction } from '../types';
import { mapItemToLegacyShape } from '../../lib/activityMapping';

/**
 * 统一走本站 `/api/activity`，由 Vercel Node 后端并发拉取 activity 并返回聚合结果。
 */
const ACTIVITY_API_PATH = '/api/activity';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestWithRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      const message = String(err?.message || '');
      const isRetryable =
        status === 503 ||
        status === 504 ||
        message.includes('503') ||
        message.includes('504') ||
        message.toLowerCase().includes('timeout') ||
        message.includes('超时');
      if (!isRetryable || attempt === maxAttempts) break;
      await sleep(400 * attempt);
    }
  }
  throw lastErr;
}

/** 前端统一走本站 `/api/activity`。 */
async function getActivitiesFromLocalAPI(
  walletAddress: string,
  days?: number,
  forceRefresh = false,
  range: 'month' | 'last_month' | null = 'month'
): Promise<any[]> {
  const base = ACTIVITY_API_PATH.replace(/\/$/, '');
  const addr = walletAddress.toLowerCase();
  const params: Record<string, string | number | boolean | undefined> = {
    user: addr,
    // 让服务端一次拉到上限后再统一裁剪与排序
    limit: 0,
    range: range ?? undefined,
    days: range ? undefined : (days ?? 180),
    use_cache: forceRefresh ? 'false' : 'true',
    sort_direction: 'DESC',
  };

  // 清理 undefined，避免 URLSearchParams 变成字符串 "undefined"
  Object.keys(params).forEach((k) => (params[k] === undefined ? delete params[k] : null));

  const url = `${base}?${new URLSearchParams(params as Record<string, string>).toString()}`;
  const startMs = Date.now();

  try {
    const response = await requestWithRetry(
      () =>
        axios.get<any>(url, {
          headers: { Accept: 'application/json' },
          timeout: 120000,
        }),
      2
    );

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(2);
    console.log('[polyview] 后端请求:', url);
    console.log('[polyview] 后端请求耗时:', elapsedSec, '秒');

    const payload = response.data;
    const raw = Array.isArray(payload?.data) ? payload.data : [];
    const mapped = raw.map((item: any) => mapItemToLegacyShape(item as Record<string, unknown>));
    mapped.sort((a: any, b: any) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
    return mapped;
  } catch (error: any) {
    if (error.response?.status) {
      const status = error.response.status;
      const serverMsg =
        error.response?.data?.error ||
        error.response?.data?.message ||
        error.response?.data?.detail ||
        error.message;
      // 避免把上游内部错误（例如 DuckDB assertion）直接展示给用户
      const safeMsg =
        status === 503 || status === 504
          ? '活动服务暂时不可用，请稍后重试。'
          : String(serverMsg || '获取活动失败');
      throw new Error(`活动接口 ${status}: ${safeMsg}`);
    }
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      throw new Error('请求活动数据超时，请稍后重试');
    }
    throw error;
  }
}

/**
 * 转换活动数据为内部交易格式
 */
function transformActivityToTransaction(activity: any): PolymarketTransaction {
  // 处理时间戳（API 返回的是秒级时间戳）
  const timestamp = activity.timestamp
    ? (typeof activity.timestamp === 'string'
      ? parseInt(activity.timestamp)
      : activity.timestamp) * 1000
    : Date.now();

  const size = parseFloat(activity.size || '0');
  const usdcSize = parseFloat(activity.usdcSize || '0');
  const price = parseFloat(activity.price || '0');

  // 判断买入/卖出：
  // 1. 如果 type 是 REDEEM，视为卖出
  // 2. 如果有 side 字段，直接使用
  // 3. 否则根据 size 的正负判断（size > 0 通常表示买入）
  // 4. 如果都没有，默认设为 BUY
  let isBuy = true;
  const originalType = activity.type ? (activity.type.toUpperCase() === 'REDEEM' ? 'REDEEM' : 'TRADE') : 'TRADE';

  if (activity.type && activity.type.toUpperCase() === 'REDEEM') {
    isBuy = false; // REDEEM 视为卖出
  } else if (activity.side) {
    isBuy = activity.side.toUpperCase() === 'BUY';
  } else if (size !== 0) {
    isBuy = size > 0;
  }

  let amount = Math.abs(size || 0);
  const isRedeem = activity.type && activity.type.toUpperCase() === 'REDEEM';
  // API 有时 REDEEM 返回 size=0 但 usdcSize>0，若不补全会被 pnlCalculator 的 amount>0 过滤掉，导致「只有开仓没有平仓」
  if (isRedeem && amount === 0 && usdcSize > 0) {
    amount = Math.abs(usdcSize);
  }
  // 优先使用 usdcSize，否则计算 price * amount
  const totalCost = usdcSize > 0 ? Math.abs(usdcSize) : (amount * Math.abs(price));
  let calculatedPrice = price || (amount > 0 ? totalCost / amount : 0);
  if (isRedeem && !calculatedPrice) calculatedPrice = 1; // Claim 通常 1:1

  return {
    id: activity.transactionHash || activity.id || `activity-${timestamp}-${Math.random().toString(36).substring(2, 11)}`,
    timestamp,
    market: activity.conditionId || activity.market || 'unknown',
    marketQuestion: activity.title || activity.question || 'Unknown Market',
    outcome: activity.outcome || '',
    type: isBuy ? 'BUY' : 'SELL',
    amount,
    price: calculatedPrice,
    totalCost,
    user: activity.proxyWallet || activity.user || '',
    originalType: originalType as 'TRADE' | 'REDEEM',
    slug: activity.slug || '',
    eventSlug: activity.eventSlug || '',
    tokenId: String(activity.tokenId ?? activity.token_id ?? activity.asset ?? '').trim(),
  };
}

/**
 * 获取指定钱包地址的交易记录
 * @param walletAddress 钱包地址
 * @param days 按天数时获取最近 N 天（range 有值时忽略）
 * @param forceRefresh 为 true 时忽略缓存，强制重新拉取
 * @param range 查询范围：month=本月, last_month=上个月
 */
export async function getWalletTransactions(
  walletAddress: string,
  days: number = 30,
  forceRefresh: boolean = false,
  range: 'month' | 'last_month' | null = 'month'
): Promise<PolymarketTransaction[]> {
  if (!walletAddress || !walletAddress.startsWith('0x')) {
    throw new Error('无效的钱包地址，必须以 0x 开头');
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const activities = await getActivitiesFromLocalAPI(normalizedAddress, days, forceRefresh, range);

    if (!activities || activities.length === 0) {
      throw new Error('活动数据为空');
    }

    const transactions = activities
      .filter((activity: any) => activity.type === 'TRADE' || activity.type === 'REDEEM')
      .map(transformActivityToTransaction);

    transactions.sort((a, b) => a.timestamp - b.timestamp);
    return transactions;
  } catch (error: any) {
    throw new Error(
      `无法获取交易记录: ${error.message}\n` +
      `请确认钱包地址 ${walletAddress} 在 Polymarket 上有交易记录，且网络可访问 data-api.polymarket.com`
    );
  }
}
