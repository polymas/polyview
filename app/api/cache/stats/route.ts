import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '../../../../lib/cache';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const user = searchParams.get('user');

    const stats = cacheManager.getCacheStats(user || undefined);

    if (stats.oldest_timestamp) {
      stats.oldest_datetime = new Date(stats.oldest_timestamp * 1000).toISOString();
    }
    if (stats.newest_timestamp) {
      stats.newest_datetime = new Date(stats.newest_timestamp * 1000).toISOString();
    }

    return NextResponse.json({
      success: true,
      stats,
      message: `缓存统计信息（${user ? '用户' : '全局'}）`,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: '获取缓存统计失败',
        detail: error.message || String(error),
      },
      { status: 500 }
    );
  }
}

