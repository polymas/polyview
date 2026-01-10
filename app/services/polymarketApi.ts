import axios from 'axios';
import { PolymarketTransaction } from '../types';

// Next.js API 端点
const API_BASE_URL = '/api';

/**
 * 从本地 API 获取用户活动数据
 * @param walletAddress 钱包地址
 * @param days 获取最近N天的数据，如果不指定则获取所有数据
 */
async function getActivitiesFromLocalAPI(walletAddress: string, days?: number): Promise<any[]> {
  try {
    const params: any = {
      user: walletAddress,
      limit: -1,  // 获取所有历史记录
      sort_by: 'TIMESTAMP',
      sort_direction: 'DESC',
      use_cache: true
    };
    
    // 如果指定了days，添加days参数
    if (days) {
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

  const amount = Math.abs(size || 0);
  // 优先使用 usdcSize，否则计算 price * amount
  const totalCost = usdcSize > 0 ? Math.abs(usdcSize) : (amount * Math.abs(price));
  // 如果 price 为 0，从 totalCost 和 amount 计算
  const calculatedPrice = price || (amount > 0 ? totalCost / amount : 0);

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
 * @param days 获取最近N天的数据，如果不指定则默认30天（懒加载优化）
 */
export async function getWalletTransactions(
  walletAddress: string,
  days: number = 30 // 默认只加载30天数据
): Promise<PolymarketTransaction[]> {
  if (!walletAddress || !walletAddress.startsWith('0x')) {
    throw new Error('无效的钱包地址，必须以 0x 开头');
  }

  const normalizedAddress = walletAddress.toLowerCase();

  try {
    const activities = await getActivitiesFromLocalAPI(normalizedAddress, days);

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
