import axios from 'axios';
import { PolymarketTransaction } from '../types';

// 本地 HTTP 服务端点
// 可通过环境变量 VITE_API_BASE_URL 配置，默认使用 localhost:8000
const LOCAL_API_BASE_URL = 'http://localhost:8000';

// Polymarket API 端点（备用）
const POLYMARKET_CLOB_API = 'https://clob.polymarket.com';
// The Graph Polymarket 子图（公共端点，无需 API key）
const POLYMARKET_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/polymarket/polymarket';

/**
 * 从 The Graph 子图获取交易记录
 */
async function getTradesFromSubgraph(walletAddress: string): Promise<any[]> {
  const query = `
    query GetUserTrades($user: String!) {
      trades(
        where: { user: $user }
        orderBy: timestamp
        orderDirection: desc
        first: 1000
      ) {
        id
        market {
          id
          question
          outcomes
        }
        outcome
        amount
        price
        timestamp
        user
        txHash
      }
    }
  `;

  try {
    const response = await axios.post(
      POLYMARKET_SUBGRAPH_URL,
      {
        query,
        variables: { user: walletAddress.toLowerCase() },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.errors) {
      throw new Error(response.data.errors[0]?.message || 'GraphQL 查询错误');
    }

    return response.data.data?.trades || [];
  } catch (error: any) {
    console.error('The Graph API 调用失败:', error);
    throw error;
  }
}

/**
 * 从 CLOB API 获取交易记录（备用方法）
 */
async function getFillsFromClob(walletAddress: string): Promise<any[]> {
  try {
    // 尝试多种参数格式
    const params = [
      { user: walletAddress.toLowerCase() },
      { maker: walletAddress.toLowerCase() },
      { taker: walletAddress.toLowerCase() },
    ];

    for (const param of params) {
      try {
        const response = await axios.get(`${POLYMARKET_CLOB_API}/fills`, {
          params: param,
          headers: {
            'Accept': 'application/json',
          },
          timeout: 10000,
        });

        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
          return response.data;
        }
      } catch (error) {
        // 继续尝试下一个参数格式
        continue;
      }
    }

    throw new Error('CLOB API 未返回数据');
  } catch (error) {
    console.error('CLOB API 调用失败:', error);
    throw error;
  }
}

/**
 * 转换 The Graph 数据为内部交易格式
 */
function transformSubgraphTrade(trade: any): PolymarketTransaction {
  const timestamp = trade.timestamp ? parseInt(trade.timestamp) * 1000 : Date.now();

  // 判断是买入还是卖出（简化处理，实际可能需要更复杂的逻辑）
  // 通常 amount > 0 表示买入，amount < 0 表示卖出
  const isBuy = parseFloat(trade.amount) > 0;

  const amount = Math.abs(parseFloat(trade.amount || '0'));
  const price = parseFloat(trade.price || '0');
  const totalCost = amount * price;

  return {
    id: trade.id || trade.txHash || `trade-${timestamp}`,
    timestamp,
    market: trade.market?.id || 'unknown',
    marketQuestion: trade.market?.question || 'Unknown Market',
    outcome: trade.outcome || '',
    type: isBuy ? 'BUY' : 'SELL',
    amount,
    price,
    totalCost,
    user: trade.user || '',
  };
}

/**
 * 转换 CLOB API 数据为内部交易格式
 */
function transformClobFill(fill: any): PolymarketTransaction {
  const timestamp = fill.timestamp
    ? (typeof fill.timestamp === 'string' ? parseInt(fill.timestamp) : fill.timestamp) * 1000
    : Date.now();

  const isBuy = fill.side === 'BUY' || fill.side === 'buy' ||
    (fill.maker && fill.maker.toLowerCase() === fill.user?.toLowerCase());

  const amount = parseFloat(fill.amount || fill.size || '0');
  const price = parseFloat(fill.price || '0');
  const totalCost = parseFloat(fill.totalCost || fill.cost || (amount * price).toString());

  return {
    id: fill.id || fill.txHash || `fill-${timestamp}`,
    timestamp,
    market: fill.market || fill.conditionId || 'unknown',
    marketQuestion: fill.question || fill.marketQuestion || 'Unknown Market',
    outcome: fill.outcome || '',
    type: isBuy ? 'BUY' : 'SELL',
    amount,
    price,
    totalCost,
    user: fill.user || fill.maker || fill.taker || '',
  };
}

/**
 * 从本地 HTTP 服务获取用户活动数据
 */
async function getActivitiesFromLocalAPI(walletAddress: string): Promise<any[]> {
  try {
    const response = await axios.get(`${LOCAL_API_BASE_URL}/activity`, {
      params: {
        user: walletAddress,
        limit: -1,  // 获取所有历史记录
        sort_by: 'TIMESTAMP',
        sort_direction: 'DESC',
        use_cache: true
      },
      timeout: 60000,  // 60秒超时，因为可能需要获取大量数据
    });

    if (response.data && response.data.success && response.data.data) {
      return response.data.data;
    }

    throw new Error('本地 API 返回数据格式错误');
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('无法连接到本地 API 服务，请确保服务已启动在 http://localhost:8000');
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
    id: activity.transactionHash || activity.id || `activity-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp,
    market: activity.conditionId || activity.market || 'unknown',
    marketQuestion: activity.title || activity.question || 'Unknown Market',
    outcome: activity.outcome || '',  // 不强制设置YES，如果没有outcome就为空字符串
    type: isBuy ? 'BUY' : 'SELL',
    amount,
    price: calculatedPrice,
    totalCost,
    user: activity.proxyWallet || activity.user || '',
    originalType: originalType as 'TRADE' | 'REDEEM',  // 保存原始类型
  };
}

/**
 * 获取指定钱包地址的交易记录
 */
export async function getWalletTransactions(
  walletAddress: string
): Promise<PolymarketTransaction[]> {
  if (!walletAddress || !walletAddress.startsWith('0x')) {
    throw new Error('无效的钱包地址，必须以 0x 开头');
  }

  const normalizedAddress = walletAddress.toLowerCase();

  // 方法1: 优先使用本地 HTTP 服务（推荐，支持缓存和完整历史数据）
  try {
    console.log('正在从本地 API 服务获取活动记录...');
    const activities = await getActivitiesFromLocalAPI(normalizedAddress);

    if (activities && activities.length > 0) {
      const transactions = activities
        .filter((activity: any) => activity.type === 'TRADE' || activity.type === 'REDEEM')  // 处理交易和赎回类型
        .map(transformActivityToTransaction);

      // 按时间戳排序（从旧到新）
      transactions.sort((a, b) => a.timestamp - b.timestamp);
      console.log(`成功从本地 API 获取 ${transactions.length} 笔交易记录`);
      return transactions;
    } else {
      console.warn('本地 API 返回空数据，尝试备用方案...');
    }
  } catch (error: any) {
    console.warn('本地 API 失败，尝试备用方案...', error.message);
  }

  // 方法2: 备用方案 - 使用 The Graph 子图
  try {
    console.log('正在从 The Graph 子图获取交易记录...');
    const trades = await getTradesFromSubgraph(normalizedAddress);

    if (trades && trades.length > 0) {
      const transactions = trades.map(transformSubgraphTrade);
      transactions.sort((a, b) => a.timestamp - b.timestamp);
      console.log(`成功从 The Graph 获取 ${transactions.length} 笔交易记录`);
      return transactions;
    }
  } catch (error: any) {
    console.warn('The Graph API 失败，尝试 CLOB API...', error.message);
  }

  // 方法3: 备用方案 - 使用 CLOB API
  try {
    console.log('正在从 CLOB API 获取交易记录...');
    const fills = await getFillsFromClob(normalizedAddress);

    if (fills && fills.length > 0) {
      const transactions = fills.map(transformClobFill);
      transactions.sort((a, b) => a.timestamp - b.timestamp);
      console.log(`成功从 CLOB API 获取 ${transactions.length} 笔交易记录`);
      return transactions;
    }
  } catch (error: any) {
    console.warn('CLOB API 也失败:', error.message);
  }

  // 如果所有方法都失败
  throw new Error(
    `无法获取交易记录。可能的原因：\n` +
    `1. 本地 API 服务未启动（请运行: python activity.py）\n` +
    `2. 钱包地址 ${walletAddress} 在 Polymarket 上没有交易记录\n` +
    `3. API 端点暂时不可用\n` +
    `4. 网络连接问题\n\n` +
    `请确认钱包地址正确，或稍后重试。`
  );
}


