import React, { useMemo } from 'react';
import { DailyPnL } from '../types';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday } from 'date-fns';
import zhCN from 'date-fns/locale/zh-CN';

interface PnLCalendarProps {
  dailyPnL: DailyPnL[];
  currentMonth?: Date;
}

export const PnLCalendar: React.FC<PnLCalendarProps> = ({
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

  const getPnLColor = (pnl: number) => {
    if (pnl > 0) return 'bg-green-100 text-green-800 border-green-300';
    if (pnl < 0) return 'bg-red-100 text-red-800 border-red-300';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  };

  const formatCurrency = (value: number) => {
    if (value === 0) return '$0.00';
    const sign = value > 0 ? '+' : '';
    return `${sign}$${Math.abs(value).toFixed(2)}`;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
      <div className="mb-1">
        <h3 className="text-sm font-semibold text-gray-900">
          已平仓盈亏日历 - {format(currentMonth, 'yyyy年MM月', { locale: zhCN })}
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
              className={`h-12 border rounded p-0.5 flex flex-col items-center justify-center ${daily ? getPnLColor(daily.pnl) : 'bg-gray-50 border-gray-200'
                } ${isCurrentDay ? 'ring-1 ring-blue-500' : ''} ${!isCurrentMonth ? 'opacity-50' : ''
                }`}
            >
              <div className="text-[10px] font-medium leading-tight">
                {format(day, 'd')}
              </div>
              {daily && (
                <>
                  <div className="text-[8px] font-semibold leading-tight">
                    {formatCurrency(daily.pnl)}
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
          <div className="w-2 h-2 bg-green-100 border border-green-300 rounded"></div>
          <span>盈利</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 bg-red-100 border border-red-300 rounded"></div>
          <span>亏损</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 bg-gray-50 border border-gray-200 rounded"></div>
          <span>无交易</span>
        </div>
      </div>
    </div>
  );
};

