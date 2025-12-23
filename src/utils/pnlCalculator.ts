import { PolymarketTransaction, PropositionPnL, DailyPnL, Statistics, HoldingDuration } from '../types';
import { format, differenceInDays } from 'date-fns';

/**
 * 计算每个命题的盈亏
 * 通过 conditionId (market) 匹配买入卖出，REDEEM 算卖出
 */
export function calculatePropositionPnL(
  transactions: PolymarketTransaction[]
): PropositionPnL[] {
  // 过滤掉 size=0 的交易
  const validTransactions = transactions.filter(tx => tx.amount > 0);

  // 按 conditionId (market) 分组，同一个 conditionId 的所有交易一起计算
  const conditionGroups = new Map<string, PolymarketTransaction[]>();

  validTransactions.forEach((tx) => {
    // market 字段存储的是 conditionId
    const conditionId = tx.market;
    if (!conditionGroups.has(conditionId)) {
      conditionGroups.set(conditionId, []);
    }
    conditionGroups.get(conditionId)!.push(tx);
  });

  const propositions: PropositionPnL[] = [];

  conditionGroups.forEach((txs, conditionId) => {
    // 同一个 conditionId 的所有交易合并计算，不按 outcome 分组
    // 收集所有不同的 outcome 用于显示
    const outcomeSet = new Set<string>();
    txs.forEach((tx) => {
      const outcomeRaw = tx.outcome || 'YES';
      outcomeSet.add(outcomeRaw);
    });
    const outcomes = Array.from(outcomeSet);

    // 使用所有交易一起计算
    // 使用 FIFO 方法计算盈亏
    const positions: Array<{ amount: number; cost: number; timestamp: number }> = [];
    let totalInvested = 0;
    let totalReturned = 0;
    let currentShares = 0;
    let realizedPnL = 0;

    // 按时间排序
    const sortedTxs = [...txs].sort((a, b) => a.timestamp - b.timestamp);

    sortedTxs.forEach((tx) => {
      if (tx.type === 'BUY') {
        // 买入：添加到持仓队列
        totalInvested += tx.totalCost;
        currentShares += tx.amount;
        positions.push({
          amount: tx.amount,
          cost: tx.totalCost,
          timestamp: tx.timestamp,
        });
      } else if (tx.type === 'SELL') {
        // 卖出（包括 REDEEM）：使用 FIFO 匹配买入
        // 如果没有持仓，说明是卖空或只有REDEEM没有开仓，不计入盈利
        if (positions.length > 0) {
          let remainingAmount = tx.amount;
          let sellRealizedPnL = 0;

          while (remainingAmount > 0 && positions.length > 0) {
            const position = positions[0];
            const avgCost = position.cost / position.amount;

            if (position.amount <= remainingAmount) {
              // 完全平掉这个持仓
              const sellValue = position.amount * tx.price;
              const profit = sellValue - position.cost;
              sellRealizedPnL += profit;
              totalReturned += sellValue;
              remainingAmount -= position.amount;
              currentShares -= position.amount;
              positions.shift();
            } else {
              // 部分平仓
              const sellAmount = remainingAmount;
              const sellValue = sellAmount * tx.price;
              const cost = sellAmount * avgCost;
              const profit = sellValue - cost;
              sellRealizedPnL += profit;
              totalReturned += sellValue;
              position.amount -= sellAmount;
              position.cost -= cost;
              currentShares -= sellAmount;
              remainingAmount = 0;
            }
          }

          // 如果还有剩余卖出量，说明是卖空（简化处理）
          if (remainingAmount > 0) {
            const sellValue = remainingAmount * tx.price;
            totalReturned += sellValue;
            currentShares -= remainingAmount;
            // 卖空收益（简化处理，不计算成本）
            sellRealizedPnL += sellValue;
          }

          realizedPnL += sellRealizedPnL;
        }
        // 如果没有持仓，只有REDEEM没有开仓的情况，不计入盈利，但会记录平仓时间
      }
    });

    // 计算当前价值（使用最后交易价格，如果没有则使用平均成本）
    let currentValue = 0;
    if (currentShares > 0) {
      const lastTx = sortedTxs[sortedTxs.length - 1];
      if (lastTx && lastTx.price > 0) {
        currentValue = currentShares * lastTx.price;
      } else if (positions.length > 0) {
        // 使用平均成本估算
        const totalCost = positions.reduce((sum, p) => sum + p.cost, 0);
        const totalAmount = positions.reduce((sum, p) => sum + p.amount, 0);
        const avgCost = totalAmount > 0 ? totalCost / totalAmount : 0;
        currentValue = currentShares * avgCost;
      }
    }

    // 计算开仓时间：以最早的一笔开仓（BUY）时间算
    const buyTxs = sortedTxs.filter(tx => tx.type === 'BUY');
    const openTime = buyTxs.length > 0
      ? Math.min(...buyTxs.map(tx => tx.timestamp))
      : undefined;

    // 计算平仓时间：以最晚的一笔平仓（SELL）时间算
    // 如果已完全平仓（status为CLOSED），或者只有REDEEM没有开仓，都显示平仓时间
    const sellTxs = sortedTxs.filter(tx => tx.type === 'SELL');
    let closeTime: number | undefined = undefined;
    if (sellTxs.length > 0) {
      // 判断是否完全平仓：currentShares为0或接近0（处理浮点数精度问题）
      // 使用更宽松的条件：只要 currentShares 接近0就认为完全平仓
      const isFullyClosed = Math.abs(currentShares) < 0.01;
      // 或者没有开仓（只有REDEEM），也显示平仓时间
      const onlyRedeem = buyTxs.length === 0 && sellTxs.length > 0;

      if (isFullyClosed || onlyRedeem) {
        closeTime = Math.max(...sellTxs.map(tx => tx.timestamp));
      }
    }

    // PnL 只计算已实现的盈亏，未平仓的不算盈亏
    // 如果完全平仓：PnL = totalReturned - totalInvested = realizedPnL
    // 如果有持仓：PnL = realizedPnL（不包含未实现的持仓价值）
    // 如果没有开仓（只有REDEEM）：PnL = 0（不计入盈利）
    const pnl = buyTxs.length > 0 ? realizedPnL : 0;
    const pnlPercent = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

    // 判断是否完全平仓：使用和 closeTime 一样的判断逻辑
    // 如果 currentShares 接近0（处理浮点数精度问题），认为完全平仓
    const isFullyClosed = Math.abs(currentShares) < 0.01;
    const onlyRedeem = buyTxs.length === 0 && sellTxs.length > 0;
    const status = (isFullyClosed || onlyRedeem) ? 'CLOSED' : (currentShares > 0 ? 'OPEN' : 'CLOSED');

    // 使用第一个 outcome 作为主要显示（向后兼容）
    const primaryOutcome = outcomes[0] || 'YES';

    propositions.push({
      market: conditionId,
      question: txs[0].marketQuestion,
      totalInvested,
      totalReturned,
      currentValue,
      pnl,
      pnlPercent,
      realizedPnL: realizedPnL,  // 已实现盈亏（开平仓的盈亏）
      transactions: sortedTxs,
      status: status,
      outcome: primaryOutcome,  // 向后兼容
      outcomes: outcomes,  // 多个 outcome 列表
      openTime,
      closeTime,
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
  // 过滤掉 size=0 的交易
  const validTransactions = transactions.filter(tx => tx.amount > 0);

  const dailyMap = new Map<string, DailyPnL>();

  // 初始化每日数据
  validTransactions.forEach((tx) => {
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
  // 过滤掉 size=0 的交易
  const validTransactions = transactions.filter(tx => tx.amount > 0);

  const totalInvested = propositions.reduce(
    (sum, prop) => sum + prop.totalInvested,
    0
  );

  const totalReturned = propositions.reduce(
    (sum, prop) => sum + prop.totalReturned,
    0
  );

  // 总盈亏按正常开平仓的盈亏计算（使用每个命题的已实现盈亏）
  const totalPnL = propositions.reduce(
    (sum, prop) => sum + prop.realizedPnL,
    0
  );
  const totalPnLPercent = totalInvested > 0
    ? (totalPnL / totalInvested) * 100
    : 0;

  // 计算年化收益率
  if (validTransactions.length === 0) {
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

  const firstTx = validTransactions.reduce(
    (earliest, tx) => tx.timestamp < earliest.timestamp ? tx : earliest,
    validTransactions[0]
  );

  const lastTx = validTransactions.reduce(
    (latest, tx) => tx.timestamp > latest.timestamp ? tx : latest,
    validTransactions[0]
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
    totalTransactions: validTransactions.length,
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
  // 过滤掉 size=0 的交易
  const validTransactions = transactions.filter(tx => tx.amount > 0);

  const durations: HoldingDuration[] = [];

  // 按市场和 outcome 分组
  // 统一 outcome 格式，确保 "Yes" 和 "YES" 被视为同一个
  const marketGroups = new Map<string, PolymarketTransaction[]>();

  validTransactions.forEach((tx) => {
    const outcome = (tx.outcome || 'YES').toUpperCase();
    const key = `${tx.market}-${outcome}`;
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


