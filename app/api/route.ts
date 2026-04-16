import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    service: 'Polymarket 用户活动 API',
    version: '1.0.0',
    endpoints: {
      '/api/activity': '获取用户活动（分页，数据来自 Polymarket Data API）',
      '/api/health': '健康检查',
    },
  });
}

