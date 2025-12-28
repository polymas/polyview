import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    service: 'Polymarket 用户活动 API',
    version: '1.0.0',
    endpoints: {
      '/api/activity': '获取用户活动（分页）',
      '/api/health': '健康检查',
      '/api/cache/stats': '查看缓存统计',
      '/api/cache/clear': '清除用户缓存',
      '/api/cache/clean': '清理半年前的旧数据',
    },
  });
}

