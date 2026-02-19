import axios from 'axios';
import { PolymarketTransaction } from '../types';

// Next.js API 端点
const API_BASE_URL = '/api';

/**
 * 从本地 API 获取用户活动数据
 * @param walletAddress 钱包地址
 * @param days 获取最近 N 天的数据（range=month 时忽略）
 * @param forceRefresh 是否强制刷新
 * @param rangeMonth 为 true 时拉取「上个月1号 00:00 UTC 至当天」，忽略 days
 */
async function getActivitiesFromLocalAPI(
  walletAddress: string,
  days?: number,
  forceRefresh = false,
  rangeMonth = false
): Promise<any[]> {
  try {
    const params: any = {
      user: walletAddress,
      limit: -1,
      sort_by: 'TIMESTAMP',
      sort_direction: 'DESC',
      use_cache: !forceRefresh,
    };
    if (rangeMonth) {
      params.range = 'month';
    } else if (days) {
      params.days = days;
    }

    const response = await axios.get(`${API_BASE_URL}/activity`, {
      params,
      timeout: 300000,  // 300秒（5分钟）超时，因为可能需要获取大量数据并合并
    });

    if (response.data && response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error('本地 API 返回数据格式错误');
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED' || error.response?.status === 500) {
      throw new Error('无法连接到 API 服务，请确保服务已启动');
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
  };
}

/**
 * 获取指定钱包地址的交易记录
 * @param walletAddress 钱包地址
 * @param days 按天数时获取最近 N 天（rangeMonth 为 true 时忽略）
 * @param forceRefresh 为 true 时忽略缓存，强制重新拉取
 * @param rangeMonth 为 true 时拉取「上个月1号至当天」数据，忽略 days
 */
export async function getWalletTransactions(
  walletAddress: string,
  days: number = 30,
  forceRefresh: boolean = false,
  rangeMonth: boolean = true
): Promise<PolymarketTransaction[]> {
  if (!walletAddress || !walletAddress.startsWith('0x')) {
    throw new Error('无效的钱包地址，必须以 0x 开头');
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const activities = await getActivitiesFromLocalAPI(normalizedAddress, days, forceRefresh, rangeMonth);

    if (!activities || activities.length === 0) {
      throw new Error('本地 API 返回空数据');
    }

    const transactions = activities
      .filter((activity: any) => activity.type === 'TRADE' || activity.type === 'REDEEM')
      .map(transformActivityToTransaction);

    transactions.sort((a, b) => a.timestamp - b.timestamp);
    return transactions;
  } catch (error: any) {
    throw new Error(
      `无法获取交易记录: ${error.message}\n` +
      `请确认：\n` +
      `1. API 服务已启动\n` +
      `2. 钱包地址 ${walletAddress} 在 Polymarket 上有交易记录`
    );
  }
}
