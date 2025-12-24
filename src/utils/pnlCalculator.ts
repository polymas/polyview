import { PolymarketTransaction, PropositionPnL, DailyPnL, Statistics, HoldingDuration } from '../types';
import { differenceInHours } from 'date-fns';

/**
 * 将时间戳转换为 UTC+8 时区的日期字符串 (yyyy-MM-dd)
 */
function formatDateUTC8(timestamp: number): string {
  // UTC+8 = UTC + 8小时 = UTC + 8 * 60 * 60 * 1000 毫秒
  const utc8Timestamp = timestamp + 8 * 60 * 60 * 1000;
  // 使用 UTC 时间格式化，得到 UTC+8 的日期
  const date = new Date(utc8Timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
    // 收集所有不同的 outcome 用于显示（不强制设置YES）
    const outcomeSet = new Set<string>();
    txs.forEach((tx) => {
      if (tx.outcome) {  // 只添加有outcome的交易
        outcomeSet.add(tx.outcome);
      }
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

    // 使用第一个 outcome 作为主要显示（如果没有outcome则为空）
    const primaryOutcome = outcomes[0] || '';

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
 * 计算每日盈亏（只计算已平仓的盈亏）
 * 交易额只计算TRADE类型，不计算REDEEM
 */
export function calculateDailyPnL(
  transactions: PolymarketTransaction[],
  propositions: PropositionPnL[]
): DailyPnL[] {
  // 过滤掉 size=0 的交易
  const validTransactions = transactions.filter(tx => tx.amount > 0);

  const dailyMap = new Map<string, DailyPnL>();

  // 只处理已平仓的命题
  const closedPropositions = propositions.filter(prop => prop.status === 'CLOSED');

  // 初始化每日数据（只统计TRADE类型的交易额，不统计REDEEM）
  validTransactions.forEach((tx) => {
    // 只计算TRADE类型的交易额，REDEEM不算交易额
    // 使用originalType字段来判断：只有TRADE类型的BUY才算交易额
    if (tx.type === 'BUY' && tx.originalType === 'TRADE') {
      // 使用 UTC+8 时区计算日期
      const date = formatDateUTC8(tx.timestamp);

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
      daily.tradingVolume += tx.totalCost;  // 只累计TRADE类型的BUY交易额

      if (!daily.markets.includes(tx.market)) {
        daily.markets.push(tx.market);
      }
    }
  });

  // 计算每日已实现盈亏（只计算已平仓的命题，按平仓时间计算）
  closedPropositions.forEach((prop) => {
    // 只处理有平仓时间的命题
    if (!prop.closeTime) return;

    const sortedTxs = [...prop.transactions].sort((a, b) => a.timestamp - b.timestamp);

    // 使用队列来跟踪持仓
    const positions: Array<{ amount: number; cost: number; timestamp: number }> = [];

    // 先遍历所有交易，建立持仓队列
    sortedTxs.forEach((tx) => {
      if (tx.type === 'BUY') {
        // 开仓：添加到持仓队列
        positions.push({
          amount: tx.amount,
          cost: tx.totalCost,
          timestamp: tx.timestamp,
        });
      }
    });

    // 按平仓时间计算盈亏（只计算SELL交易，按平仓日期分组）
    sortedTxs.forEach((tx) => {
      if (tx.type === 'SELL') {
        // 平仓：计算盈亏，按平仓时间（SELL交易的时间）记录到对应日期
        // 使用 UTC+8 时区计算日期
        const closeDate = formatDateUTC8(tx.timestamp);

        // 确保日期存在
        if (!dailyMap.has(closeDate)) {
          dailyMap.set(closeDate, {
            date: closeDate,
            pnl: 0,
            realizedPnL: 0,
            tradingVolume: 0,
            transactions: 0,
            markets: [],
          });
        }

        const daily = dailyMap.get(closeDate)!;

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

        // 按平仓时间记录当日盈亏（不累计）
        daily.realizedPnL += realizedPnL;
      }
    });
  });

  // 当日盈亏 = 当日已实现盈亏（不累计）
  dailyMap.forEach((daily) => {
    daily.pnl = daily.realizedPnL;
  });

  return Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

/**
 * 计算统计数据（只计算指定天数内的数据）
 */
export function calculateStatistics(
  propositions: PropositionPnL[],
  transactions: PolymarketTransaction[],
  days: number = 30  // 默认30天
): Statistics {
  // 计算指定天数前的时间戳
  const daysAgo = Date.now() - days * 24 * 60 * 60 * 1000;

  // 过滤掉 size=0 的交易，并且只保留指定天数内的交易
  const validTransactions = transactions.filter(
    tx => tx.amount > 0 && tx.timestamp >= daysAgo
  );

  // 过滤命题：只保留那些在指定天数内有交易的命题
  // 通过检查命题的交易时间戳来判断
  const recentPropositions = propositions.filter(prop => {
    // 检查命题的交易中是否有指定天数内的交易
    return prop.transactions.some(tx => tx.timestamp >= daysAgo);
  });

  // 只计算指定天数内的投入和收回
  // 需要重新计算每个命题在指定天数内的投入和收回
  let totalInvested = 0;
  let totalReturned = 0;
  let totalPnL = 0;

  recentPropositions.forEach((prop) => {
    // 只统计指定天数内的交易
    const recentTxs = prop.transactions.filter(tx => tx.timestamp >= daysAgo);

    // 计算指定天数内的投入（只统计BUY交易）
    const recentInvested = recentTxs
      .filter(tx => tx.type === 'BUY')
      .reduce((sum, tx) => sum + tx.totalCost, 0);

    // 计算指定天数内的收回（只统计SELL交易）
    const recentReturned = recentTxs
      .filter(tx => tx.type === 'SELL')
      .reduce((sum, tx) => sum + (tx.amount * tx.price), 0);

    // 对于已平仓的命题，如果平仓时间在指定天数内，计算盈亏
    // 对于持仓中的命题，只计算已实现的盈亏（如果有部分平仓）
    if (prop.status === 'CLOSED' && prop.closeTime && prop.closeTime >= daysAgo) {
      // 已平仓且在指定天数内平仓的，使用整个命题的已实现盈亏
      totalInvested += prop.totalInvested;
      totalReturned += prop.totalReturned;
      totalPnL += prop.realizedPnL;
    } else if (prop.status === 'OPEN') {
      // 持仓中的，只计算指定天数内的投入和已实现盈亏
      totalInvested += recentInvested;
      totalReturned += recentReturned;
      // 对于持仓中的，需要计算指定天数内的已实现盈亏
      // 这里简化处理，使用命题的realizedPnL（如果有部分平仓）
      totalPnL += prop.realizedPnL;
    } else if (prop.status === 'CLOSED' && prop.closeTime && prop.closeTime < daysAgo) {
      // 已平仓但不在指定天数内的，不计算
      // 但如果开仓在指定天数内，可能需要部分计算
      // 这里简化处理，不计算
    }
  });

  const totalPnLPercent = totalInvested > 0
    ? (totalPnL / totalInvested) * 100
    : 0;

  // 计算年化收益率（基于时间按最大占用资金算）
  if (validTransactions.length === 0) {
    return {
      totalInvested: 0,
      totalReturned: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      annualizedReturn: 0,
      monthlyReturn: 0,
      totalTransactions: 0,
      activeMarkets: recentPropositions.filter(p => p.status === 'OPEN').length,
      closedMarkets: recentPropositions.filter(p => p.status === 'CLOSED').length,
    };
  }

  // 计算最大占用资金：按时间顺序遍历所有交易，计算每个时间点的占用资金
  // 占用资金 = 累计投入 - 累计收回 + 当前持仓价值
  let maxOccupiedCapital = 0;
  let currentOccupiedCapital = 0;
  const sortedTxs = [...validTransactions].sort((a, b) => a.timestamp - b.timestamp);

  // 按时间顺序计算占用资金（只考虑已平仓的，持仓中的单独计算）
  // 对于每个时间点，占用资金 = 累计投入 - 累计收回
  sortedTxs.forEach(tx => {
    if (tx.type === 'BUY') {
      currentOccupiedCapital += tx.totalCost;
    } else if (tx.type === 'SELL') {
      currentOccupiedCapital -= tx.amount * tx.price;
    }

    // 更新最大占用资金
    if (currentOccupiedCapital > maxOccupiedCapital) {
      maxOccupiedCapital = currentOccupiedCapital;
    }
  });

  // 计算当前持仓中命题的占用资金
  // 对于持仓中的命题，占用资金 = totalInvested - totalReturned + currentValue
  let currentOpenPositionsCapital = 0;
  recentPropositions.forEach(prop => {
    if (prop.status === 'OPEN') {
      // 持仓中的占用资金 = 投入 - 收回 + 当前价值
      currentOpenPositionsCapital += prop.totalInvested - prop.totalReturned + prop.currentValue;
    }
  });

  // 最终的最大占用资金 = max(历史最大占用资金, 当前持仓占用资金)
  const finalMaxOccupiedCapital = Math.max(maxOccupiedCapital, currentOpenPositionsCapital);

  // 计算实际时间跨度（从第一笔交易到最后一笔交易，或到当前时间）
  const firstTxTime = sortedTxs[0].timestamp;
  const lastTxTime = sortedTxs[sortedTxs.length - 1].timestamp;
  const now = Date.now();
  // 如果有持仓，时间跨度到当前；否则到最后交易时间
  const hasOpenPositions = recentPropositions.some(p => p.status === 'OPEN');
  const endTime = hasOpenPositions ? now : lastTxTime;
  const actualDays = (endTime - firstTxTime) / (24 * 60 * 60 * 1000);

  // 年化收益率 = (总盈亏 / 最大占用资金) * (365 / 实际天数) * 100
  const annualizedReturn = finalMaxOccupiedCapital > 0 && actualDays > 0
    ? (totalPnL / finalMaxOccupiedCapital) * (365 / actualDays) * 100
    : 0;

  // 月化收益率 = (总盈亏 / 最大占用资金) * (30 / 实际天数) * 100
  const monthlyReturn = finalMaxOccupiedCapital > 0 && actualDays > 0
    ? (totalPnL / finalMaxOccupiedCapital) * (30 / actualDays) * 100
    : 0;

  const activeMarkets = recentPropositions.filter(p => p.status === 'OPEN').length;
  const closedMarkets = recentPropositions.filter(p => p.status === 'CLOSED').length;

  return {
    totalInvested,
    totalReturned,
    totalPnL,
    totalPnLPercent,
    annualizedReturn,
    monthlyReturn,
    totalTransactions: validTransactions.length,
    activeMarkets,
    closedMarkets,
  };
}

/**
 * 计算每个代币的持仓时长分布（只统计指定天数内的数据）
 */
export function calculateHoldingDurations(
  transactions: PolymarketTransaction[],
  days: number = 30  // 默认30天
): HoldingDuration[] {
  // 计算指定天数前的时间戳
  const daysAgo = Date.now() - days * 24 * 60 * 60 * 1000;

  // 过滤掉 size=0 的交易，并且只保留指定天数内的交易
  const validTransactions = transactions.filter(
    tx => tx.amount > 0 && tx.timestamp >= daysAgo
  );

  const durations: HoldingDuration[] = [];

  // 按市场和 outcome 分组
  // 如果没有outcome，使用空字符串作为分组键的一部分
  const marketGroups = new Map<string, PolymarketTransaction[]>();

  validTransactions.forEach((tx) => {
    // 如果没有outcome，使用空字符串，不强制设置为YES
    const outcome = tx.outcome ? tx.outcome.toUpperCase() : '';
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

        // 如果完全平仓，记录持仓时长（按小时计算）
        // 只统计平仓时间在指定天数内的持仓
        if (positions.length === 0 && firstOpenTime !== null && lastCloseTime !== null) {
          // 只统计平仓时间在指定天数内的持仓
          if (lastCloseTime >= daysAgo) {
            const durationHours = differenceInHours(
              new Date(lastCloseTime),
              new Date(firstOpenTime)
            );

            durations.push({
              market,
              question: sortedTxs[0].marketQuestion,
              outcome,
              openTime: firstOpenTime,
              closeTime: lastCloseTime,
              duration: Math.max(durationHours, 0),  // 确保非负，单位：小时
              status: 'CLOSED',
              realizedPnL,
            });
          }
        }
      }
    });

    // 如果还有持仓，记录为 OPEN（按小时计算）
    // 只统计开仓时间在指定天数内的持仓
    if (positions.length > 0) {
      const firstOpenTime = positions[0].timestamp;
      // 只统计开仓时间在指定天数内的持仓
      if (firstOpenTime >= daysAgo) {
        const durationHours = differenceInHours(
          new Date(),
          new Date(firstOpenTime)
        );

        durations.push({
          market,
          question: sortedTxs[0].marketQuestion,
          outcome,
          openTime: firstOpenTime,
          closeTime: null,
          duration: Math.max(durationHours, 0),  // 单位：小时
          status: 'OPEN',
          realizedPnL: 0,  // 未实现盈亏
        });
      }
    }
  });

  return durations;
}


