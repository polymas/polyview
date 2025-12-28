import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '../../../../lib/cache';

export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get('days');
    
    // 默认清理180天（6个月）前的数据
    const days = daysParam ? parseInt(daysParam, 10) : 180;
    
    if (isNaN(days) || days < 0) {
      return NextResponse.json(
        { success: false, error: '无效的天数参数，必须是非负整数' },
        { status: 400 }
      );
    }

    const deletedCount = cacheManager.cleanOldData(days);

    return NextResponse.json({
      success: true,
      message: `已清理 ${days} 天前的数据`,
      deletedCount,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: '清理缓存失败',
        detail: error.message || String(error),
      },
      { status: 500 }
    );
  }
}

