import { NextResponse } from 'next/server';

const POLYMARKET_DATA_API_BASE = 'https://data-api.polymarket.com';

export async function GET() {
  try {
    const res = await fetch(`${POLYMARKET_DATA_API_BASE}/activity?limit=1`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return NextResponse.json({
      status: 'healthy',
      polymarket_data_api: res.ok ? 'accessible' : 'unavailable',
    });
  } catch {
    return NextResponse.json({
      status: 'healthy',
      polymarket_data_api: 'unavailable',
    });
  }
}
