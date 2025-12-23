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
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');

  // 排序和分页数据
  const sortedAndPaginatedData = useMemo(() => {
    // 先过滤
    let sorted = propositions.filter(prop => {
      if (filterStatus === 'ALL') return true;
      return prop.status === filterStatus;
    });

    // 排序
    if (sortField) {
      sorted.sort((a, b) => {
        let aValue: number | undefined;
        let bValue: number | undefined;

        if (sortField === 'openTime') {
          aValue = a.openTime;
          bValue = b.openTime;
        } else if (sortField === 'closeTime') {
          // 对于平仓时间，OPEN状态的排在最后
          if (a.status === 'OPEN' && b.status === 'CLOSED') {
            return sortDirection === 'asc' ? 1 : -1;
          }
          if (a.status === 'CLOSED' && b.status === 'OPEN') {
            return sortDirection === 'asc' ? -1 : 1;
          }
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
    return `$${value.toFixed(2)}`;
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const getPnLClass = (pnl: number) => {
    if (pnl > 0) return 'text-green-600';
    if (pnl < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '-';
    return format(new Date(timestamp), 'yyyy-MM-dd HH:mm', { locale: zhCN });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 过滤控件 */}
      <div className="mb-4 flex items-center gap-4">
        <span className="text-sm font-medium text-gray-700">状态过滤：</span>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setFilterStatus('ALL');
              setCurrentPage(1);
            }}
            className={`px-4 py-2 text-sm rounded-md border transition-colors ${filterStatus === 'ALL'
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
            className={`px-4 py-2 text-sm rounded-md border transition-colors ${filterStatus === 'CLOSED'
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
            className={`px-4 py-2 text-sm rounded-md border transition-colors ${filterStatus === 'OPEN'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
          >
            持仓中 ({propositions.filter(p => p.status === 'OPEN').length})
          </button>
        </div>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto min-h-0 border border-gray-200 rounded-lg">
        <table className="min-w-full bg-white">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                命题
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                结果
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <SortButton field="openTime" label="开仓时间" />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <SortButton field="closeTime" label="平仓时间" />
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                总投入
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                已收回
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                当前价值
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                盈亏
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                收益率
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                状态
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                交易次数
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedAndPaginatedData.map((prop, index) => (
              <tr key={`${prop.market}-${index}`} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900 max-w-md truncate">
                    {prop.question}
                  </div>
                  <div className="text-xs text-gray-500">{prop.market}</div>
                </td>
                <td className="px-6 py-4">
                  {prop.outcomes && prop.outcomes.length > 1 ? (
                    <div className="flex flex-wrap gap-1">
                      {prop.outcomes.map((outcome, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                        >
                          {outcome}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      {prop.outcome || 'N/A'}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {formatDate(prop.openTime)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {prop.status === 'OPEN' ? (
                    <span className="text-gray-400">持仓中</span>
                  ) : (
                    formatDate(prop.closeTime)
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                  {formatCurrency(prop.totalInvested)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                  {formatCurrency(prop.totalReturned)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                  {formatCurrency(prop.currentValue)}
                </td>
                <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-semibold ${getPnLClass(prop.pnl)}`}>
                  {formatCurrency(prop.pnl)}
                </td>
                <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-semibold ${getPnLClass(prop.pnl)}`}>
                  {formatPercent(prop.pnlPercent)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${prop.status === 'OPEN'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                    }`}>
                    {prop.status === 'OPEN' ? '持仓中' : '已平仓'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
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
        <div className="flex items-center justify-between mt-4 px-4 py-3 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-700">
              每页显示
            </span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-sm text-gray-700">
              条，共 {filteredPropositions.length} 条
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              首页
            </button>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一页
            </button>

            <div className="flex items-center gap-1">
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
                    className={`px-3 py-1 text-sm border rounded-md ${currentPage === pageNum
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
              className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一页
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              末页
            </button>

            <span className="text-sm text-gray-700 ml-2">
              第 {currentPage} / {totalPages} 页
            </span>
          </div>
        </div>
      )}
    </div>
  );
};


