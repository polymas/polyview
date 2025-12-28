import React, { useState, useMemo } from 'react';
import { PropositionPnL } from '../types';
import { format } from 'date-fns';
import zhCN from 'date-fns/locale/zh-CN';

interface PnLTableProps {
  propositions: PropositionPnL[];
}

type SortField = 'openTime' | 'closeTime' | null;
type SortDirection = 'asc' | 'desc';

export const PnLTable: React.FC<PnLTableProps> = ({ propositions }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortField, setSortField] = useState<SortField>('closeTime');  // 默认按平仓时间排序
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');  // 默认倒序
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');

  // 排序和分页数据
  const sortedAndPaginatedData = useMemo(() => {
    // 先过滤
    let sorted = propositions.filter(prop => {
      if (filterStatus === 'ALL') return true;
      return prop.status === filterStatus;
    });

    // 排序（默认按平仓时间倒序，没有平仓时间的排在最后）
    if (sortField) {
      sorted.sort((a, b) => {
        let aValue: number | undefined;
        let bValue: number | undefined;

        if (sortField === 'openTime') {
          aValue = a.openTime;
          bValue = b.openTime;
        } else if (sortField === 'closeTime') {
          // 对于平仓时间，没有平仓时间的（OPEN状态或closeTime为undefined）排在最后
          const aHasCloseTime = a.closeTime !== undefined;
          const bHasCloseTime = b.closeTime !== undefined;

          // 如果两个都没有平仓时间，保持原顺序
          if (!aHasCloseTime && !bHasCloseTime) return 0;
          // 如果a没有平仓时间，a排在最后
          if (!aHasCloseTime) return 1;
          // 如果b没有平仓时间，b排在最后
          if (!bHasCloseTime) return -1;

          // 两个都有平仓时间，正常排序
          aValue = a.closeTime;
          bValue = b.closeTime;
        }

        // 处理 undefined 值（未开仓或未平仓）
        if (aValue === undefined && bValue === undefined) return 0;
        if (aValue === undefined) return sortDirection === 'asc' ? 1 : -1;
        if (bValue === undefined) return sortDirection === 'asc' ? -1 : 1;

        // 正常排序
        if (sortDirection === 'asc') {
          return aValue - bValue;
        } else {
          return bValue - aValue;
        }
      });
    }

    // 分页
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return sorted.slice(startIndex, endIndex);
  }, [propositions, currentPage, itemsPerPage, sortField, sortDirection, filterStatus]);

  const filteredPropositions = propositions.filter(prop => {
    if (filterStatus === 'ALL') return true;
    return prop.status === filterStatus;
  });

  const totalPages = Math.ceil(filteredPropositions.length / itemsPerPage);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // 切换排序方向
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // 设置新的排序字段
      setSortField(field);
      setSortDirection('desc'); // 默认降序
    }
    setCurrentPage(1); // 重置到第一页
  };

  const SortButton: React.FC<{ field: SortField; label: string }> = ({ field, label }) => {
    const isActive = sortField === field;
    return (
      <button
        onClick={() => handleSort(field)}
        className={`flex items-center gap-1 hover:text-gray-900 focus:outline-none transition-colors ${isActive ? 'text-blue-600 font-semibold' : 'text-gray-500'
          }`}
        title={`点击${isActive ? '切换' : '按'}${label}排序`}
      >
        <span>{label}</span>
        <span className={`text-xs ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
          {isActive ? (
            sortDirection === 'asc' ? '↑' : '↓'
          ) : (
            '↕'
          )}
        </span>
      </button>
    );
  };

  const formatCurrency = (value: number) => {
    if (Math.abs(value) >= 1000) {
      return `$${(value / 1000).toFixed(1)}k`;
    }
    return `$${value.toFixed(0)}`;
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  };

  const getPnLClass = (pnl: number) => {
    if (pnl > 0) return 'text-green-600';
    if (pnl < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '-';
    // 只显示月-日 时:分，更紧凑
    return format(new Date(timestamp), 'MM-dd HH:mm', { locale: zhCN });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 过滤控件 */}
      <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <span className="text-xs sm:text-sm font-medium text-gray-700">状态过滤：</span>
        <div className="flex gap-1.5 sm:gap-2 flex-wrap">
          <button
            onClick={() => {
              setFilterStatus('ALL');
              setCurrentPage(1);
            }}
            className={`px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md border transition-colors ${filterStatus === 'ALL'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
          >
            全部 ({propositions.length})
          </button>
          <button
            onClick={() => {
              setFilterStatus('CLOSED');
              setCurrentPage(1);
            }}
            className={`px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md border transition-colors ${filterStatus === 'CLOSED'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
          >
            已平仓 ({propositions.filter(p => p.status === 'CLOSED').length})
          </button>
          <button
            onClick={() => {
              setFilterStatus('OPEN');
              setCurrentPage(1);
            }}
            className={`px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md border transition-colors ${filterStatus === 'OPEN'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
          >
            持仓中 ({propositions.filter(p => p.status === 'OPEN').length})
          </button>
        </div>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-x-auto min-h-0 border border-gray-200 rounded-lg">
        <table className="w-full bg-white table-fixed min-w-[800px] sm:min-w-0">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="w-[25%] px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                命题
              </th>
              <th className="w-[8%] px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                结果
              </th>
              <th className="w-[10%] px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <SortButton field="openTime" label="开仓" />
              </th>
              <th className="w-[10%] px-1 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <SortButton field="closeTime" label="平仓" />
              </th>
              <th className="w-[8%] px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                投入
              </th>
              <th className="w-[8%] px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                收回
              </th>
              <th className="w-[8%] px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                价值
              </th>
              <th className="w-[8%] px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                盈亏
              </th>
              <th className="w-[8%] px-1 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                收益率
              </th>
              <th className="w-[4%] px-1 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                状态
              </th>
              <th className="w-[3%] px-1 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                次数
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedAndPaginatedData.map((prop, index) => (
              <tr key={`${prop.market}-${index}`} className="hover:bg-gray-50">
                <td className="px-2 py-2">
                  <div className="text-sm font-medium text-gray-900 truncate" title={prop.question}>
                    {prop.question}
                  </div>
                  <div className="text-xs text-gray-500 truncate" title={prop.market}>{prop.market}</div>
                </td>
                <td className="px-1 py-2">
                  {prop.outcomes && prop.outcomes.length > 1 ? (
                    <div className="flex flex-wrap gap-0.5">
                      {prop.outcomes.map((outcome, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                        >
                          {outcome}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="px-1 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      {prop.outcome || (prop.outcomes && prop.outcomes.length > 0 ? prop.outcomes.join(', ') : 'N/A')}
                    </span>
                  )}
                </td>
                <td className="px-1 py-2 text-sm text-gray-600 truncate" title={formatDate(prop.openTime)}>
                  {formatDate(prop.openTime)}
                </td>
                <td className="px-1 py-2 text-sm text-gray-600 truncate">
                  {prop.status === 'OPEN' ? (
                    <span className="text-gray-400">持仓中</span>
                  ) : (
                    <span title={formatDate(prop.closeTime)}>{formatDate(prop.closeTime)}</span>
                  )}
                </td>
                <td className="px-1 py-2 text-right text-sm text-gray-900">
                  {formatCurrency(prop.totalInvested)}
                </td>
                <td className="px-1 py-2 text-right text-sm text-gray-900">
                  {formatCurrency(prop.totalReturned)}
                </td>
                <td className="px-1 py-2 text-right text-sm text-gray-900">
                  {formatCurrency(prop.currentValue)}
                </td>
                <td className={`px-1 py-2 text-right text-sm font-semibold ${getPnLClass(prop.pnl)}`}>
                  {formatCurrency(prop.pnl)}
                </td>
                <td className={`px-1 py-2 text-right text-sm font-semibold ${getPnLClass(prop.pnl)}`}>
                  {formatPercent(prop.pnlPercent)}
                </td>
                <td className="px-1 py-2 text-center">
                  <span className={`px-1 py-0.5 text-xs font-semibold rounded-full ${prop.status === 'OPEN'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                    }`}>
                    {prop.status === 'OPEN' ? '持仓' : '已平'}
                  </span>
                </td>
                <td className="px-1 py-2 text-center text-sm text-gray-900">
                  {prop.transactions.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredPropositions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            {propositions.length === 0 ? '暂无交易记录' : '没有符合条件的交易记录'}
          </div>
        )}
      </div>

      {/* 分页控件 */}
      {propositions.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-3 sm:mt-4 px-2 sm:px-4 py-2 sm:py-3 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <span className="text-xs sm:text-sm text-gray-700">
              每页显示
            </span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 sm:px-3 py-1 border border-gray-300 rounded-md text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-xs sm:text-sm text-gray-700">
              条，共 {filteredPropositions.length} 条
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-center sm:justify-end">
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className="px-2 sm:px-3 py-1 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              首页
            </button>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-2 sm:px-3 py-1 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一页
            </button>

            <div className="flex items-center gap-0.5 sm:gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`px-2 sm:px-3 py-1 text-xs sm:text-sm border rounded-md ${currentPage === pageNum
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-2 sm:px-3 py-1 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一页
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="px-2 sm:px-3 py-1 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              末页
            </button>

            <span className="text-xs sm:text-sm text-gray-700 ml-1 sm:ml-2 whitespace-nowrap">
              第 {currentPage} / {totalPages} 页
            </span>
          </div>
        </div>
      )}
    </div>
  );
};


