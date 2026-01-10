import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '../../../lib/cache';
import { getUserActivity, getAllUserActivity } from '../../../lib/polymarketApi';

const BATCH_SIZE_DEFAULT = 100;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const user = searchParams.get('user');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const sortBy = searchParams.get('sort_by') || 'TIMESTAMP';
    const sortDirection = searchParams.get('sort_direction') || 'DESC';
    const useCacheParam = searchParams.get('use_cache');
    const excludeDepositsWithdrawalsParam = searchParams.get('excludeDepositsWithdrawals');
    const daysParam = searchParams.get('days'); // 新增：按天数限制

    if (!user) {
      return NextResponse.json(
        { success: false, error: '缺少必需参数: user' },
        { status: 400 }
      );
    }

    if (!user.startsWith('0x') || user.length !== 42) {
      return NextResponse.json(
        { success: false, error: '无效的用户地址格式，必须是0x开头的42位十六进制字符串' },
        { status: 400 }
      );
    }

    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
    const useCache = useCacheParam !== 'false';
    const excludeDepositsWithdrawals = excludeDepositsWithdrawalsParam !== 'false';
    const days = daysParam ? parseInt(daysParam, 10) : null; // 如果指定了days，则按天数限制

    let data: any[];
    let message: string;

    if (limit === 0 || limit === -1) {
      // 获取所有记录（如果指定了days，则只获取最近N天的数据）
      data = await getAllUserActivity(
        user,
        cacheManager,
        sortBy,
        sortDirection,
        BATCH_SIZE_DEFAULT,
        null,
        useCache,
        excludeDepositsWithdrawals,
        days // 传递days参数
      );
      message = days 
        ? `成功获取最近 ${days} 天 ${data.length} 条历史活动记录`
        : `成功获取所有 ${data.length} 条历史活动记录`;
    } else {
      if (limit < 1) {
        return NextResponse.json(
          { success: false, error: 'limit 参数无效，必须大于0（或使用0/-1获取所有记录）' },
          { status: 400 }
        );
      }

      data = await getUserActivity(
        user,
        cacheManager,
        limit,
        offset,
        sortBy,
        sortDirection,
        useCache,
        excludeDepositsWithdrawals
      );
      message = `成功获取 ${data.length} 条活动记录（offset: ${offset}, limit: ${limit}）`;
    }

    return NextResponse.json({
      success: true,
      count: data.length,
      data,
      message,
    });
  } catch (error: any) {
    // 检查是否是超时错误
    const isTimeoutError = 
      error.code === 'ECONNABORTED' || 
      error.message?.includes('timeout') || 
      error.message?.includes('超时') ||
      error.message?.includes('timed out');
    
    const errorMessage = isTimeoutError
      ? '获取用户活动数据超时，数据量可能较大。请稍后重试，或尝试使用缓存数据。'
      : '获取用户活动失败';
    
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        detail: error.message || String(error),
        isTimeout: isTimeoutError,
      },
      { status: isTimeoutError ? 504 : 500 } // 超时错误返回504状态码
    );
  }
}

