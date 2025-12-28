import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '../../../../lib/cache';

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const user = searchParams.get('user');

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

    cacheManager.clearUserCache(user);

    return NextResponse.json({
      success: true,
      message: `已清除用户 ${user} 的缓存`,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: '清除缓存失败',
        detail: error.message || String(error),
      },
      { status: 500 }
    );
  }
}

