import React from 'react';
import { Statistics as StatisticsType } from '../types';

interface StatisticsProps {
  statistics: StatisticsType;
  days: number;  // 统计天数
}

export const Statistics: React.FC<StatisticsProps> = ({ statistics, days }) => {
  const formatCurrency = (value: number) => {
    return `$${Math.abs(value).toFixed(2)}`;
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const getPnLClass = (value: number) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const daysLabel = days === 7 ? '近7天' : '近30天';

  const stats = [
    {
      label: `总投入（${daysLabel}）`,
      value: formatCurrency(statistics.totalInvested),
      color: 'text-gray-900',
    },
    {
      label: `已收回（${daysLabel}）`,
      value: formatCurrency(statistics.totalReturned),
      color: 'text-gray-900',
    },
    {
      label: `总盈亏（${daysLabel}）`,
      value: formatCurrency(statistics.totalPnL),
      color: getPnLClass(statistics.totalPnL),
    },
    {
      label: `总收益率（${daysLabel}）`,
      value: formatPercent(statistics.totalPnLPercent),
      color: getPnLClass(statistics.totalPnLPercent),
    },
    {
      label: `月化收益率（${daysLabel}）`,
      value: formatPercent(statistics.monthlyReturn),
      color: getPnLClass(statistics.monthlyReturn),
      highlight: true,
    },
    {
      label: '总交易次数',
      value: statistics.totalTransactions.toString(),
      color: 'text-gray-900',
    },
    {
      label: '活跃市场',
      value: statistics.activeMarkets.toString(),
      color: 'text-blue-600',
    },
    {
      label: '已关闭市场',
      value: statistics.closedMarkets.toString(),
      color: 'text-gray-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`bg-white rounded-lg shadow-sm border border-gray-200 p-2 ${stat.highlight ? 'ring-1 ring-blue-500' : ''
            }`}
        >
          <div className="text-xs text-gray-500 mb-0.5">{stat.label}</div>
          <div className={`text-lg font-bold ${stat.color}`}>
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
};


