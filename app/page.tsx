'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { format } from 'date-fns';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { getWalletTransactions } from './services/polymarketApi';
import { calculatePropositionPnL, calculateDailyPnL, calculateStatistics, calculateHoldingDurations } from './utils/pnlCalculator';
import { PolymarketTransaction, PropositionPnL, DailyPnL, Statistics, HoldingDuration } from './types';
import { PnLTable } from './components/PnLTable';
import { PnLCalendar } from './components/PnLCalendar';
import { TradingVolumeCalendar } from './components/TradingVolumeCalendar';
import { Statistics as StatisticsComponent } from './components/Statistics';
import { HoldingDurationChart } from './components/HoldingDurationChart';
import { getRecentAddresses, addRecentAddress, RecentAddress, isFavorite, addFavorite, removeFavorite, getFavoriteNote } from './utils/recentAddresses';

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const defaultAddress = '0x17db3fcd93ba12d38382a0cade24b200185c5f6d';
  const addressFromUrl = searchParams.get('address') || defaultAddress;

  const [walletAddress, setWalletAddress] = useState<string>(addressFromUrl);
  const [loading, setLoading] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<PolymarketTransaction[]>([]);
  const [propositions, setPropositions] = useState<PropositionPnL[]>([]);
  const [dailyPnL, setDailyPnL] = useState<DailyPnL[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [holdingDurations, setHoldingDurations] = useState<HoldingDuration[]>([]);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [statisticsDays, setStatisticsDays] = useState<number>(7);
  const [recentAddresses, setRecentAddresses] = useState<RecentAddress[]>([]);
  const [initialized, setInitialized] = useState<boolean>(false);
  const [showFavoriteModal, setShowFavoriteModal] = useState<boolean>(false);
  const [favoriteNote, setFavoriteNote] = useState<string>('');
  const [shareSuccess, setShareSuccess] = useState<boolean>(false);
  /** 盈亏日历选中的日期 yyyy-MM-dd，用于本地过滤「当天平仓」的命题；null 表示不过滤 */
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  // 更新URL参数
  const updateUrlAddress = (address: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (address && address !== defaultAddress) {
      params.set('address', address);
    } else {
      params.delete('address');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // 加载最近查询的地址
  useEffect(() => {
    setRecentAddresses(getRecentAddresses());
  }, []);

  // 同步URL参数到输入框
  useEffect(() => {
    if (addressFromUrl && addressFromUrl !== walletAddress) {
      setWalletAddress(addressFromUrl);
    }
  }, [addressFromUrl]);

  const handleSearch = useCallback(async (address?: string, forceRefresh = false) => {
    const targetAddress = address || walletAddress;

    if (!targetAddress.trim()) {
      alert('请输入钱包地址');
      return;
    }

    if (!targetAddress.startsWith('0x') || targetAddress.length !== 42) {
      alert('请输入有效的以太坊钱包地址（0x 开头的 42 位地址）');
      return;
    }

    if (address) setWalletAddress(address);
    updateUrlAddress(targetAddress);

    setLoading(true);
    setTransactions([]);
    setPropositions([]);
    setDailyPnL([]);
    setSelectedCalendarDate(null);
    setStatistics(null);
    setHoldingDurations([]);

    try {
      const txData = await getWalletTransactions(targetAddress, 30, forceRefresh);

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
  }, [walletAddress, statisticsDays, searchParams, pathname, router, defaultAddress]);

  // 从URL参数初始化地址并自动加载
  useEffect(() => {
    if (!initialized && addressFromUrl && addressFromUrl !== defaultAddress) {
      setInitialized(true);
      handleSearch(addressFromUrl);
    } else if (!initialized) {
      setInitialized(true);
    }
  }, [addressFromUrl, initialized, defaultAddress, handleSearch]);

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  /** 点击盈亏日历某天：筛选当天平仓的命题；再次点击同一天则清除筛选 */
  const handleCalendarDayClick = useCallback((dateStr: string) => {
    setSelectedCalendarDate((prev) => (prev === dateStr ? null : dateStr));
  }, []);

  /** 根据日历选中日期过滤命题（只保留当天平仓的）；未选则返回全部 */
  const propositionsForTable = useMemo(() => {
    if (!selectedCalendarDate) return propositions;
    return propositions.filter((prop) => {
      if (prop.status !== 'CLOSED' || prop.closeTime == null) return false;
      const closeDateStr = format(new Date(prop.closeTime), 'yyyy-MM-dd');
      return closeDateStr === selectedCalendarDate;
    });
  }, [propositions, selectedCalendarDate]);

  // 处理收藏
  const handleFavorite = () => {
    if (!walletAddress.trim() || !walletAddress.startsWith('0x') || walletAddress.length !== 42) {
      alert('请先输入有效的钱包地址');
      return;
    }

    const currentNote = getFavoriteNote(walletAddress);
    setFavoriteNote(currentNote || '');
    setShowFavoriteModal(true);
  };

  // 确认收藏
  const handleConfirmFavorite = () => {
    if (!walletAddress.trim()) {
      return;
    }

    if (favoriteNote.trim()) {
      addFavorite(walletAddress, favoriteNote.trim());
    } else {
      removeFavorite(walletAddress);
    }

    setShowFavoriteModal(false);
    setRecentAddresses(getRecentAddresses());
  };

  // 处理分享
  const handleShare = async () => {
    try {
      const url = `${window.location.origin}${pathname}?address=${walletAddress}`;
      await navigator.clipboard.writeText(url);
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2000);
    } catch (error) {
      // 降级方案：使用传统方法
      const textArea = document.createElement('textarea');
      textArea.value = `${window.location.origin}${pathname}?address=${walletAddress}`;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2000);
      } catch (err) {
        alert('复制失败，请手动复制URL');
      }
      document.body.removeChild(textArea);
    }
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
                <button
                  onClick={() => handleSearch(undefined, true)}
                  disabled={loading}
                  className="px-3 py-2 border border-amber-500 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-50 text-sm whitespace-nowrap"
                  title="忽略缓存重新拉取，可修复「开仓未平」误判"
                >
                  强制刷新
                </button>
                {statistics && (
                  <>
                    <button
                      onClick={handleFavorite}
                      className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${isFavorite(walletAddress)
                        ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      title={isFavorite(walletAddress) ? '已收藏，点击修改备注' : '收藏'}
                    >
                      ⭐
                    </button>
                    <button
                      onClick={handleShare}
                      className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm whitespace-nowrap transition-colors relative"
                      title="分享链接"
                    >
                      {shareSuccess ? '✓ 已复制' : '🔗 分享'}
                    </button>
                  </>
                )}
                {recentAddresses.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 border border-gray-300 rounded-lg bg-white">
                    <span className="text-xs text-gray-500 hidden sm:inline">最近:</span>
                    <div className="flex gap-1 flex-wrap">
                      {recentAddresses.slice(0, 5).map((item) => (
                        <button
                          key={item.address}
                          onClick={() => handleSearch(item.address)}
                          className={`px-2 py-1 text-xs rounded transition-colors truncate max-w-[120px] sm:max-w-[150px] ${item.isFavorite
                            ? 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            }`}
                          title={item.note ? `${item.note}\n${item.address}` : item.address}
                        >
                          {item.note ? (
                            <span className="font-medium">⭐ {item.note}</span>
                          ) : (
                            `${item.address.slice(0, 6)}...${item.address.slice(-4)}`
                          )}
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
                    <PnLCalendar
                      dailyPnL={dailyPnL}
                      currentMonth={currentMonth}
                      onDayClick={handleCalendarDayClick}
                      selectedDate={selectedCalendarDate}
                    />
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
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h2 className="text-sm sm:text-base font-semibold text-gray-900">
                  命题盈亏表格
                </h2>
                {selectedCalendarDate && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-800 rounded text-xs border border-blue-200">
                    <span>已按 {selectedCalendarDate} 筛选（当天平仓）</span>
                    <button
                      type="button"
                      onClick={() => setSelectedCalendarDate(null)}
                      className="hover:underline font-medium"
                    >
                      清除
                    </button>
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0 bg-white rounded-lg shadow-sm border border-gray-200 p-2 sm:p-3">
                <PnLTable propositions={propositionsForTable} />
              </div>
            </div>
          </div>
        )}

        {!statistics && !loading && (
          <div className="text-center py-12 text-gray-500">
            <p>请输入钱包地址开始查询</p>
          </div>
        )}

        {/* 收藏弹窗 */}
        {showFavoriteModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {isFavorite(walletAddress) ? '编辑收藏备注' : '添加收藏'}
              </h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  备注名称
                </label>
                <input
                  type="text"
                  value={favoriteNote}
                  onChange={(e) => setFavoriteNote(e.target.value)}
                  placeholder="输入备注名称（如：我的主钱包）"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  autoFocus
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleConfirmFavorite();
                    } else if (e.key === 'Escape') {
                      setShowFavoriteModal(false);
                    }
                  }}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowFavoriteModal(false);
                    setFavoriteNote('');
                  }}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                {isFavorite(walletAddress) && (
                  <button
                    onClick={() => {
                      removeFavorite(walletAddress);
                      setShowFavoriteModal(false);
                      setFavoriteNote('');
                      setRecentAddresses(getRecentAddresses());
                    }}
                    className="px-4 py-2 text-sm text-red-700 bg-red-100 rounded-lg hover:bg-red-200 transition-colors"
                  >
                    取消收藏
                  </button>
                )}
                <button
                  onClick={handleConfirmFavorite}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p>加载中...</p>
        </div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}

