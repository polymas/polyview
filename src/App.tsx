import { useState } from 'react';
import { getWalletTransactions } from './services/polymarketApi';
import { calculatePropositionPnL, calculateDailyPnL, calculateStatistics, calculateHoldingDurations } from './utils/pnlCalculator';
import { PolymarketTransaction, PropositionPnL, DailyPnL, Statistics, HoldingDuration } from './types';
import { PnLTable } from './components/PnLTable';
import { PnLCalendar } from './components/PnLCalendar';
import { TradingVolumeCalendar } from './components/TradingVolumeCalendar';
import { Statistics as StatisticsComponent } from './components/Statistics';
import { HoldingDurationChart } from './components/HoldingDurationChart';
import './App.css';

function App() {
  const [walletAddress, setWalletAddress] = useState<string>('0x45deaaD70997b2998FBb9433B1819178e34B409C');
  const [loading, setLoading] = useState<boolean>(false);
  const [, setTransactions] = useState<PolymarketTransaction[]>([]);
  const [propositions, setPropositions] = useState<PropositionPnL[]>([]);
  const [dailyPnL, setDailyPnL] = useState<DailyPnL[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [holdingDurations, setHoldingDurations] = useState<HoldingDuration[]>([]);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  const handleSearch = async () => {
    if (!walletAddress.trim()) {
      alert('请输入钱包地址');
      return;
    }

    if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
      alert('请输入有效的以太坊钱包地址（0x 开头的 42 位地址）');
      return;
    }

    setLoading(true);
    // 清空之前的数据
    setTransactions([]);
    setPropositions([]);
    setDailyPnL([]);
    setStatistics(null);
    setHoldingDurations([]);

    try {
      const txData = await getWalletTransactions(walletAddress);
      
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

      const stats = calculateStatistics(props, txData);
      setStatistics(stats);

      const durations = calculateHoldingDurations(txData);
      setHoldingDurations(durations);
    } catch (error: any) {
      console.error('获取数据失败:', error);
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
      <div className="container mx-auto px-4 py-4">
        <header className="mb-4">
          <div className="flex items-center justify-between gap-4 mb-1">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Polymarket 交易分析
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                输入钱包地址，查看历史交易记录和盈亏分析
              </p>
            </div>
            
            <div className="flex-shrink-0 flex items-center gap-2">
              <input
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="输入钱包地址 (0x...)"
                className="w-80 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm whitespace-nowrap"
              >
                {loading ? '加载中...' : '查询'}
              </button>
            </div>
          </div>
        </header>

        {statistics && (
          <div className="flex flex-col gap-3">
            {/* 上部分：统计和日历 */}
            <div className="flex-shrink-0">
              <StatisticsComponent statistics={statistics} />
              
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* 盈亏日历 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-base font-semibold text-gray-900">盈亏日历</h2>
                    <div className="flex gap-1">
                      <button
                        onClick={handlePrevMonth}
                        className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-xs"
                      >
                        上个月
                      </button>
                      <button
                        onClick={handleNextMonth}
                        className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-xs"
                      >
                        下个月
                      </button>
                    </div>
                  </div>
                  <PnLCalendar dailyPnL={dailyPnL} currentMonth={currentMonth} />
                </div>
                
                {/* 交易额日历 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-base font-semibold text-gray-900">交易额日历</h2>
                    <div className="flex gap-1">
                      <button
                        onClick={handlePrevMonth}
                        className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-xs"
                      >
                        上个月
                      </button>
                      <button
                        onClick={handleNextMonth}
                        className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-xs"
                      >
                        下个月
                      </button>
                    </div>
                  </div>
                  <TradingVolumeCalendar dailyPnL={dailyPnL} currentMonth={currentMonth} />
                </div>
                
                {/* 持仓时长分布 */}
                {holdingDurations.length > 0 && (
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 mb-2">持仓时长分布</h2>
                    <HoldingDurationChart durations={holdingDurations} />
                  </div>
                )}
              </div>
            </div>

            {/* 下部分：表格（全宽） */}
            <div className="flex-1 flex flex-col min-h-[500px]">
              <h2 className="text-base font-semibold text-gray-900 mb-2">
                命题盈亏表格
              </h2>
              <div className="flex-1 min-h-0 bg-white rounded-lg shadow-sm border border-gray-200 p-3">
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

export default App;


