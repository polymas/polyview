// Polymarket 交易记录类型定义
export interface PolymarketTransaction {
  id: string;
  timestamp: number;
  market: string;
  marketQuestion: string;
  outcome: string;
  type: 'BUY' | 'SELL';
  amount: number;
  price: number;
  totalCost: number;
  user: string;
  originalType?: 'TRADE' | 'REDEEM';  // 原始类型，用于区分TRADE和REDEEM
}

// 命题盈亏数据
export interface PropositionPnL {
  market: string;
  question: string;
  totalInvested: number;
  totalReturned: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  realizedPnL: number;  // 已实现盈亏（开平仓的盈亏）
  transactions: PolymarketTransaction[];
  status: 'OPEN' | 'CLOSED';
  outcome?: string;  // 单个 outcome（向后兼容）
  outcomes?: string[];  // 多个 outcome 列表
  openTime?: number;  // 开仓时间戳
  closeTime?: number;  // 平仓时间戳（最后卖出时间，OPEN状态为undefined）
}

// 每日盈亏数据
export interface DailyPnL {
  date: string;
  pnl: number;  // 累计盈亏
  realizedPnL: number;  // 已实现盈亏（平仓获利）
  tradingVolume: number;  // 交易额
  transactions: number;
  markets: string[];
}

// 持仓时长分布数据
export interface HoldingDuration {
  market: string;
  question: string;
  outcome: string;
  openTime: number;  // 开仓时间戳
  closeTime: number | null;  // 平仓时间戳（null表示仍持仓）
  duration: number;  // 持仓时长（小时）
  status: 'OPEN' | 'CLOSED';
  realizedPnL: number;  // 已实现盈亏
}

// 统计数据
export interface Statistics {
  totalInvested: number;
  totalReturned: number;
  totalPnL: number;
  totalPnLPercent: number;
  annualizedReturn: number;
  totalTransactions: number;
  activeMarkets: number;
  closedMarkets: number;
}


