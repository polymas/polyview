import React, { useMemo } from 'react';
import { HoldingDuration } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

interface HoldingDurationChartProps {
  durations: HoldingDuration[];
}

export const HoldingDurationChart: React.FC<HoldingDurationChartProps> = ({ durations }) => {
  // 按持仓时长分组统计
  const durationGroups = useMemo(() => {
    const groups: { [key: string]: { count: number; totalPnL: number; markets: string[] } } = {};
    
    durations.forEach((duration) => {
      let groupKey: string;
      
      if (duration.duration < 1) {
        groupKey = '<1天';
      } else if (duration.duration < 7) {
        groupKey = '1-7天';
      } else if (duration.duration < 30) {
        groupKey = '7-30天';
      } else if (duration.duration < 90) {
        groupKey = '30-90天';
      } else if (duration.duration < 180) {
        groupKey = '90-180天';
      } else {
        groupKey = '>180天';
      }
      
      if (!groups[groupKey]) {
        groups[groupKey] = { count: 0, totalPnL: 0, markets: [] };
      }
      
      groups[groupKey].count += 1;
      groups[groupKey].totalPnL += duration.realizedPnL;
      
      if (!groups[groupKey].markets.includes(duration.market)) {
        groups[groupKey].markets.push(duration.market);
      }
    });
    
    return Object.entries(groups).map(([duration, data]) => ({
      duration,
      count: data.count,
      totalPnL: data.totalPnL,
      avgPnL: data.totalPnL / data.count,
      markets: data.markets.length,
    })).sort((a, b) => {
      // 按时长排序
      const order = ['<1天', '1-7天', '7-30天', '30-90天', '90-180天', '>180天'];
      return order.indexOf(a.duration) - order.indexOf(b.duration);
    });
  }, [durations]);

  const getPnLColor = (value: number) => {
    if (value > 0) return '#10b981';  // green
    if (value < 0) return '#ef4444';  // red
    return '#6b7280';  // gray
  };

  if (durations.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">持仓时长分布</h3>
        <p className="text-gray-500 text-center py-4 text-xs">暂无持仓数据</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 按时长分组统计 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">持仓时长分布（按时长分组）</h3>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={durationGroups}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="duration" />
            <YAxis yAxisId="left" orientation="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip
              formatter={(value: any, name: string) => {
                if (name === '持仓数量') return [value, name];
                if (name === '平均盈亏') return [`$${Number(value).toFixed(2)}`, name];
                return [value, name];
              }}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="count" fill="#3b82f6" name="持仓数量" />
            <Bar yAxisId="right" dataKey="avgPnL" name="平均盈亏">
              {durationGroups.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getPnLColor(entry.avgPnL)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          {durationGroups.map((group) => (
            <div key={group.duration} className="bg-gray-50 rounded p-1.5">
              <div className="font-medium text-gray-900 text-xs">{group.duration}</div>
              <div className="text-gray-600 text-[10px] mt-0.5">
                {group.count} | ${group.avgPnL.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 按代币统计 - 已隐藏以节省空间 */}
    </div>
  );
};

