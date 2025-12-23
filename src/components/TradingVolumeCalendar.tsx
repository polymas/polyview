import React, { useMemo } from 'react';
import { DailyPnL } from '../types';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday } from 'date-fns';
import zhCN from 'date-fns/locale/zh-CN';

interface TradingVolumeCalendarProps {
  dailyPnL: DailyPnL[];
  currentMonth?: Date;
}

export const TradingVolumeCalendar: React.FC<TradingVolumeCalendarProps> = ({
  dailyPnL,
  currentMonth = new Date()
}) => {
  const dailyMap = useMemo(() => {
    const map = new Map<string, DailyPnL>();
    dailyPnL.forEach((daily) => {
      map.set(daily.date, daily);
    });
    return map;
  }, [dailyPnL]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // 获取月初前的空白天数（用于对齐周）
  const startDay = monthStart.getDay();
  const emptyDays = Array.from({ length: startDay }, (_, i) => i);

  // 获取交易额的最大值，用于颜色深浅
  const maxVolume = useMemo(() => {
    return Math.max(...Array.from(dailyMap.values()).map(d => d.tradingVolume), 1);
  }, [dailyMap]);

  const getVolumeColor = (volume: number) => {
    if (volume === 0) return 'bg-gray-50 text-gray-600 border-gray-200';
    // 根据交易额大小设置颜色深浅
    const intensity = Math.min(volume / maxVolume, 1);
    if (intensity > 0.5) {
      return 'bg-blue-200 text-blue-900 border-blue-400';
    } else if (intensity > 0.2) {
      return 'bg-blue-100 text-blue-800 border-blue-300';
    } else {
      return 'bg-blue-50 text-blue-700 border-blue-200';
    }
  };

  const formatCurrency = (value: number) => {
    if (value === 0) return '$0';
    if (value < 1000) return `$${Math.abs(value).toFixed(0)}`;
    if (value < 10000) return `$${(Math.abs(value) / 1000).toFixed(1)}k`;
    return `$${(Math.abs(value) / 1000).toFixed(0)}k`;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
      <div className="mb-1">
        <h3 className="text-sm font-semibold text-gray-900">
          {format(currentMonth, 'yyyy年MM月', { locale: zhCN })}
        </h3>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {/* 星期标题 */}
        {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
          <div
            key={day}
            className="text-center text-[10px] font-medium text-gray-500 py-0.5"
          >
            {day}
          </div>
        ))}

        {/* 月初空白 */}
        {emptyDays.map((_, index) => (
          <div key={`empty-${index}`} className="h-12" />
        ))}

        {/* 日期格子 */}
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daily = dailyMap.get(dateStr);
          const isCurrentDay = isToday(day);
          const isCurrentMonth = isSameMonth(day, currentMonth);

          return (
            <div
              key={dateStr}
              className={`h-12 border rounded p-0.5 flex flex-col items-center justify-center ${daily ? getVolumeColor(daily.tradingVolume) : 'bg-gray-50 border-gray-200'
                } ${isCurrentDay ? 'ring-1 ring-blue-500' : ''} ${!isCurrentMonth ? 'opacity-50' : ''
                }`}
            >
              <div className="text-[10px] font-medium leading-tight">
                {format(day, 'd')}
              </div>
              {daily && daily.tradingVolume > 0 && (
                <>
                  <div className="text-[8px] font-semibold leading-tight">
                    {formatCurrency(daily.tradingVolume)}
                  </div>
                  {daily.transactions > 0 && (
                    <div className="text-[7px] text-gray-500 leading-tight">
                      {daily.transactions}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="mt-1.5 flex items-center justify-center gap-2 text-[10px]">
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 bg-blue-200 border border-blue-400 rounded"></div>
          <span>高交易额</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 bg-blue-100 border border-blue-300 rounded"></div>
          <span>中交易额</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 bg-blue-50 border border-blue-200 rounded"></div>
          <span>低交易额</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 bg-gray-50 border border-gray-200 rounded"></div>
          <span>无交易</span>
        </div>
      </div>
    </div>
  );
};

