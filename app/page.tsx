'use client';

import { useState, useEffect } from 'react';
import { getWalletTransactions } from './services/polymarketApi';
import { calculatePropositionPnL, calculateDailyPnL, calculateStatistics, calculateHoldingDurations } from './utils/pnlCalculator';
import { PolymarketTransaction, PropositionPnL, DailyPnL, Statistics, HoldingDuration } from './types';
import { PnLTable } from './components/PnLTable';
import { PnLCalendar } from './components/PnLCalendar';
import { TradingVolumeCalendar } from './components/TradingVolumeCalendar';
import { Statistics as StatisticsComponent } from './components/Statistics';
import { HoldingDurationChart } from './components/HoldingDurationChart';
import { getRecentAddresses, addRecentAddress, RecentAddress } from './utils/recentAddresses';

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string>('0x17db3fcd93ba12d38382a0cade24b200185c5f6d');
  const [loading, setLoading] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<PolymarketTransaction[]>([]);
  const [propositions, setPropositions] = useState<PropositionPnL[]>([]);
  const [dailyPnL, setDailyPnL] = useState<DailyPnL[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [holdingDurations, setHoldingDurations] = useState<HoldingDuration[]>([]);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [statisticsDays, setStatisticsDays] = useState<number>(7);
  const [recentAddresses, setRecentAddresses] = useState<RecentAddress[]>([]);

  // 加载最近查询的地址
  useEffect(() => {
    setRecentAddresses(getRecentAddresses());
  }, []);

  const handleSearch = async (address?: string) => {
    const targetAddress = address || walletAddress;
    
    if (!targetAddress.trim()) {
      alert('请输入钱包地址');
      return;
    }

    if (!targetAddress.startsWith('0x') || targetAddress.length !== 42) {
      alert('请输入有效的以太坊钱包地址（0x 开头的 42 位地址）');
      return;
    }

    // 如果传入了地址，更新状态
    if (address) {
      setWalletAddress(address);
    }

    setLoading(true);
    setTransactions([]);
    setPropositions([]);
    setDailyPnL([]);
    setStatistics(null);
    setHoldingDurations([]);

    try {
      const txData = await getWalletTransactions(targetAddress);

      if (txData.length === 0) {
        alert('该钱包地址在 Polymarket 上没有找到交易记录');
        setLoading(false);
        return;
      }

      setTransactions(txData);

      const props = calculatePropositionPnL(txData);
      setPropositions(props);

      const daily = calculateDailyPnL(txData, props);
      setDailyPnL(daily);

      const stats = calculateStatistics(props, txData, statisticsDays);
      setStatistics(stats);

      const durations = calculateHoldingDurations(txData, statisticsDays);
      setHoldingDurations(durations);

      // 保存到最近查询列表
      addRecentAddress(targetAddress);
      setRecentAddresses(getRecentAddresses());
    } catch (error: any) {
      alert(error.message || '获取交易记录失败，请检查钱包地址是否正确或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
        <header className="mb-3 sm:mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-1">
            <div className="flex-shrink-0">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                Polymarket 交易分析
              </h1>
              <p className="text-xs sm:text-sm text-gray-600 mt-1">
                输入钱包地址，查看历史交易记录和盈亏分析
              </p>
            </div>

            <div className="flex flex-col sm:flex-row flex-shrink-0 gap-2 sm:items-center">
              <div className="flex gap-2 items-center flex-1">
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="输入钱包地址 (0x...)"
                  className="flex-1 sm:w-80 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button
                  onClick={() => handleSearch()}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm whitespace-nowrap"
                >
                  {loading ? '加载中...' : '查询'}
                </button>
                {recentAddresses.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 border border-gray-300 rounded-lg bg-white">
                    <span className="text-xs text-gray-500 hidden sm:inline">最近:</span>
                    <div className="flex gap-1 flex-wrap">
                      {recentAddresses.slice(0, 5).map((item) => (
                        <button
                          key={item.address}
                          onClick={() => handleSearch(item.address)}
                          className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors truncate max-w-[120px] sm:max-w-[150px]"
                          title={item.address}
                        >
                          {item.address.slice(0, 6)}...{item.address.slice(-4)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 border border-gray-300 rounded-lg p-0.5 self-start sm:self-auto">
                <button
                  onClick={() => {
                    setStatisticsDays(7);
                    if (propositions.length > 0 && transactions.length > 0) {
                      const stats = calculateStatistics(propositions, transactions, 7);
                      setStatistics(stats);
                      const durations = calculateHoldingDurations(transactions, 7);
                      setHoldingDurations(durations);
                    }
                  }}
                  className={`px-2 sm:px-3 py-1 text-xs rounded transition-colors ${statisticsDays === 7
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  近7天
                </button>
                <button
                  onClick={() => {
                    setStatisticsDays(30);
                    if (propositions.length > 0 && transactions.length > 0) {
                      const stats = calculateStatistics(propositions, transactions, 30);
                      setStatistics(stats);
                      const durations = calculateHoldingDurations(transactions, 30);
                      setHoldingDurations(durations);
                    }
                  }}
                  className={`px-2 sm:px-3 py-1 text-xs rounded transition-colors ${statisticsDays === 30
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  近30天
                </button>
              </div>
            </div>
          </div>
        </header>

        {statistics && (
          <div className="flex flex-col gap-3">
            <div className="flex-shrink-0">
              <StatisticsComponent statistics={statistics} days={statisticsDays} />

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900">盈亏日历</h2>
                    <div className="flex gap-1">
                      <button
                        onClick={handlePrevMonth}
                        className="px-1.5 sm:px-2 py-0.5 sm:py-1 border border-gray-300 rounded hover:bg-gray-50 text-[10px] sm:text-xs"
                      >
                        上月
                      </button>
                      <button
                        onClick={handleNextMonth}
                        className="px-1.5 sm:px-2 py-0.5 sm:py-1 border border-gray-300 rounded hover:bg-gray-50 text-[10px] sm:text-xs"
                      >
                        下月
                      </button>
                    </div>
                  </div>
                  <div className="min-h-[280px] sm:min-h-[320px]">
                    <PnLCalendar dailyPnL={dailyPnL} currentMonth={currentMonth} />
                  </div>
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900">交易额日历</h2>
                    <div className="flex gap-1">
                      <button
                        onClick={handlePrevMonth}
                        className="px-1.5 sm:px-2 py-0.5 sm:py-1 border border-gray-300 rounded hover:bg-gray-50 text-[10px] sm:text-xs"
                      >
                        上月
                      </button>
                      <button
                        onClick={handleNextMonth}
                        className="px-1.5 sm:px-2 py-0.5 sm:py-1 border border-gray-300 rounded hover:bg-gray-50 text-[10px] sm:text-xs"
                      >
                        下月
                      </button>
                    </div>
                  </div>
                  <div className="min-h-[280px] sm:min-h-[320px]">
                    <TradingVolumeCalendar dailyPnL={dailyPnL} currentMonth={currentMonth} />
                  </div>
                </div>

                {false && holdingDurations.length > 0 && (
                  <div className="flex flex-col md:col-span-2 lg:col-span-1">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900 mb-2">持仓时长分布</h2>
                    <div className="min-h-[280px] sm:min-h-[320px]">
                      <HoldingDurationChart durations={holdingDurations} days={statisticsDays} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-[400px] sm:min-h-[500px]">
              <h2 className="text-sm sm:text-base font-semibold text-gray-900 mb-2">
                命题盈亏表格
              </h2>
              <div className="flex-1 min-h-0 bg-white rounded-lg shadow-sm border border-gray-200 p-2 sm:p-3">
                <PnLTable propositions={propositions} />
              </div>
            </div>
          </div>
        )}

        {!statistics && !loading && (
          <div className="text-center py-12 text-gray-500">
            <p>请输入钱包地址开始查询</p>
          </div>
        )}
      </div>
    </div>
  );
}

