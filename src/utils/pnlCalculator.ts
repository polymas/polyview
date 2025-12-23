import { PolymarketTransaction, PropositionPnL, DailyPnL, Statistics, HoldingDuration } from '../types';
import { format, differenceInDays } from 'date-fns';

/**
 * 计算每个命题的盈亏
 */
export function calculatePropositionPnL(
  transactions: PolymarketTransaction[]
): PropositionPnL[] {
  // 按市场分组
  const marketGroups = new Map<string, PolymarketTransaction[]>();

  transactions.forEach((tx) => {
    if (!marketGroups.has(tx.market)) {
      marketGroups.set(tx.market, []);
    }
    marketGroups.get(tx.market)!.push(tx);
  });

  const propositions: PropositionPnL[] = [];

  marketGroups.forEach((txs, market) => {
    // 按 outcome 分组
    const outcomeGroups = new Map<string, PolymarketTransaction[]>();

    txs.forEach((tx) => {
      const key = `${tx.outcome}`;
      if (!outcomeGroups.has(key)) {
        outcomeGroups.set(key, []);
      }
      outcomeGroups.get(key)!.push(tx);
    });

    outcomeGroups.forEach((outcomeTxs, outcome) => {
      let totalInvested = 0;
      let totalReturned = 0;
      let currentShares = 0;

      // 按时间排序
      const sortedTxs = [...outcomeTxs].sort((a, b) => a.timestamp - b.timestamp);

      sortedTxs.forEach((tx) => {
        if (tx.type === 'BUY') {
          totalInvested += tx.totalCost;
          currentShares += tx.amount;
        } else if (tx.type === 'SELL') {
          totalReturned += tx.totalCost;
          currentShares -= tx.amount;
        }
      });

      // 计算当前价值（假设使用最后交易价格）
      const lastTx = sortedTxs[sortedTxs.length - 1];
      const currentValue = currentShares * lastTx.price;

      const pnl = totalReturned + currentValue - totalInvested;
      const pnlPercent = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

      // 计算开仓时间（首次买入时间）
      const firstBuyTx = sortedTxs.find(tx => tx.type === 'BUY');
      const openTime = firstBuyTx ? firstBuyTx.timestamp : undefined;

      // 计算平仓时间（最后卖出时间，如果已完全平仓）
      let closeTime: number | undefined = undefined;
      if (currentShares === 0) {
        const lastSellTx = [...sortedTxs].reverse().find(tx => tx.type === 'SELL');
        closeTime = lastSellTx ? lastSellTx.timestamp : undefined;
      }

      propositions.push({
        market,
        question: outcomeTxs[0].marketQuestion,
        totalInvested,
        totalReturned,
        currentValue,
        pnl,
        pnlPercent,
        transactions: sortedTxs,
        status: currentShares > 0 ? 'OPEN' : 'CLOSED',
        outcome,
        openTime,
        closeTime,
      });
    });
  });

  return propositions;
}

/**
 * 计算每日盈亏（根据开仓和平仓计算实际获利）
 */
export function calculateDailyPnL(
  transactions: PolymarketTransaction[],
  propositions: PropositionPnL[]
): DailyPnL[] {
  const dailyMap = new Map<string, DailyPnL>();

  // 初始化每日数据
  transactions.forEach((tx) => {
    const date = format(new Date(tx.timestamp), 'yyyy-MM-dd');

    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        pnl: 0,
        realizedPnL: 0,
        tradingVolume: 0,
        transactions: 0,
        markets: [],
      });
    }

    const daily = dailyMap.get(date)!;
    daily.transactions += 1;
    daily.tradingVolume += tx.totalCost;  // 累计交易额

    if (!daily.markets.includes(tx.market)) {
      daily.markets.push(tx.market);
    }
  });

  // 计算每日已实现盈亏（平仓获利）
  // 使用 FIFO 方法计算每个持仓的盈亏
  propositions.forEach((prop) => {
    const sortedTxs = [...prop.transactions].sort((a, b) => a.timestamp - b.timestamp);

    // 使用队列来跟踪持仓
    const positions: Array<{ amount: number; cost: number; timestamp: number }> = [];

    sortedTxs.forEach((tx) => {
      const date = format(new Date(tx.timestamp), 'yyyy-MM-dd');
      const daily = dailyMap.get(date);

      if (!daily) return;

      if (tx.type === 'BUY') {
        // 开仓：添加到持仓队列
        positions.push({
          amount: tx.amount,
          cost: tx.totalCost,
          timestamp: tx.timestamp,
        });
      } else if (tx.type === 'SELL') {
        // 平仓：计算盈亏
        let remainingAmount = tx.amount;
        let realizedPnL = 0;

        while (remainingAmount > 0 && positions.length > 0) {
          const position = positions[0];
          const avgCost = position.cost / position.amount;

          if (position.amount <= remainingAmount) {
            // 完全平掉这个持仓
            const sellValue = position.amount * tx.price;
            const profit = sellValue - position.cost;
            realizedPnL += profit;
            remainingAmount -= position.amount;
            positions.shift();
          } else {
            // 部分平仓
            const sellAmount = remainingAmount;
            const sellValue = sellAmount * tx.price;
            const cost = sellAmount * avgCost;
            const profit = sellValue - cost;
            realizedPnL += profit;
            position.amount -= sellAmount;
            position.cost -= cost;
            remainingAmount = 0;
          }
        }

        // 如果还有剩余卖出量，说明是卖空（简化处理）
        if (remainingAmount > 0) {
          const sellValue = remainingAmount * tx.price;
          realizedPnL += sellValue;  // 卖空收益
        }

        daily.realizedPnL += realizedPnL;
      }
    });
  });

  // 计算累计盈亏
  const sortedDates = Array.from(dailyMap.keys()).sort();
  let cumulativePnL = 0;

  sortedDates.forEach((date) => {
    const daily = dailyMap.get(date)!;
    cumulativePnL += daily.realizedPnL;
    daily.pnl = cumulativePnL;
  });

  return Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

/**
 * 计算统计数据
 */
export function calculateStatistics(
  propositions: PropositionPnL[],
  transactions: PolymarketTransaction[]
): Statistics {
  const totalInvested = propositions.reduce(
    (sum, prop) => sum + prop.totalInvested,
    0
  );

  const totalReturned = propositions.reduce(
    (sum, prop) => sum + prop.totalReturned,
    0
  );

  const totalCurrentValue = propositions.reduce(
    (sum, prop) => sum + prop.currentValue,
    0
  );

  const totalPnL = totalReturned + totalCurrentValue - totalInvested;
  const totalPnLPercent = totalInvested > 0
    ? (totalPnL / totalInvested) * 100
    : 0;

  // 计算年化收益率
  if (transactions.length === 0) {
    return {
      totalInvested: 0,
      totalReturned: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      annualizedReturn: 0,
      totalTransactions: 0,
      activeMarkets: 0,
      closedMarkets: 0,
    };
  }

  const firstTx = transactions.reduce(
    (earliest, tx) => tx.timestamp < earliest.timestamp ? tx : earliest,
    transactions[0]
  );

  const lastTx = transactions.reduce(
    (latest, tx) => tx.timestamp > latest.timestamp ? tx : latest,
    transactions[0]
  );

  const daysDiff = differenceInDays(
    new Date(lastTx.timestamp),
    new Date(firstTx.timestamp)
  );

  const years = Math.max(daysDiff / 365, 1 / 365); // 至少1天
  const annualizedReturn = totalInvested > 0
    ? ((Math.pow(1 + totalPnL / totalInvested, 1 / years) - 1) * 100)
    : 0;

  const activeMarkets = propositions.filter(p => p.status === 'OPEN').length;
  const closedMarkets = propositions.filter(p => p.status === 'CLOSED').length;

  return {
    totalInvested,
    totalReturned,
    totalPnL,
    totalPnLPercent,
    annualizedReturn,
    totalTransactions: transactions.length,
    activeMarkets,
    closedMarkets,
  };
}

/**
 * 计算每个代币的持仓时长分布
 */
export function calculateHoldingDurations(
  transactions: PolymarketTransaction[]
): HoldingDuration[] {
  const durations: HoldingDuration[] = [];

  // 按市场和 outcome 分组
  const marketGroups = new Map<string, PolymarketTransaction[]>();

  transactions.forEach((tx) => {
    const key = `${tx.market}-${tx.outcome}`;
    if (!marketGroups.has(key)) {
      marketGroups.set(key, []);
    }
    marketGroups.get(key)!.push(tx);
  });

  marketGroups.forEach((txs, key) => {
    const sortedTxs = [...txs].sort((a, b) => a.timestamp - b.timestamp);
    const [market, outcome] = key.split('-');

    // 使用 FIFO 队列跟踪持仓
    const positions: Array<{ amount: number; cost: number; timestamp: number }> = [];

    sortedTxs.forEach((tx) => {
      if (tx.type === 'BUY') {
        // 开仓：添加到持仓队列
        positions.push({
          amount: tx.amount,
          cost: tx.totalCost,
          timestamp: tx.timestamp,
        });
      } else if (tx.type === 'SELL') {
        // 平仓：使用 FIFO 方法计算
        let remainingAmount = tx.amount;
        let realizedPnL = 0;
        const sellPrice = tx.price;
        let firstOpenTime: number | null = null;
        let lastCloseTime: number | null = null;

        while (remainingAmount > 0 && positions.length > 0) {
          const position = positions[0];

          if (firstOpenTime === null) {
            firstOpenTime = position.timestamp;
          }
          lastCloseTime = tx.timestamp;

          const avgCost = position.cost / position.amount;

          if (position.amount <= remainingAmount) {
            // 完全平掉这个持仓
            const profit = (sellPrice - avgCost) * position.amount;
            realizedPnL += profit;
            remainingAmount -= position.amount;
            positions.shift();
          } else {
            // 部分平仓
            const profit = (sellPrice - avgCost) * remainingAmount;
            realizedPnL += profit;
            position.amount -= remainingAmount;
            position.cost -= avgCost * remainingAmount;
            remainingAmount = 0;
          }
        }

        // 如果完全平仓，记录持仓时长
        if (positions.length === 0 && firstOpenTime !== null && lastCloseTime !== null) {
          const durationDays = differenceInDays(
            new Date(lastCloseTime),
            new Date(firstOpenTime)
          );

          durations.push({
            market,
            question: sortedTxs[0].marketQuestion,
            outcome,
            openTime: firstOpenTime,
            closeTime: lastCloseTime,
            duration: Math.max(durationDays, 0),  // 确保非负
            status: 'CLOSED',
            realizedPnL,
          });
        }
      }
    });

    // 如果还有持仓，记录为 OPEN
    if (positions.length > 0) {
      const firstOpenTime = positions[0].timestamp;
      const durationDays = differenceInDays(
        new Date(),
        new Date(firstOpenTime)
      );

      durations.push({
        market,
        question: sortedTxs[0].marketQuestion,
        outcome,
        openTime: firstOpenTime,
        closeTime: null,
        duration: Math.max(durationDays, 0),
        status: 'OPEN',
        realizedPnL: 0,  // 未实现盈亏
      });
    }
  });

  return durations;
}


