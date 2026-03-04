import { NextResponse } from 'next/server';

const POLY_ACTIVITY_BASE = (process.env.POLY_ACTIVITY_BASE || 'https://www.polyking.site/activity').replace(
  /\/$/,
  ''
);

export async function GET() {
  try {
    const res = await fetch(`${POLY_ACTIVITY_BASE}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return NextResponse.json({
      status: 'healthy',
      poly_activity: res.ok ? 'accessible' : 'unavailable',
    });
  } catch {
    return NextResponse.json({
      status: 'healthy',
      poly_activity: 'unavailable',
    });
  }
}
