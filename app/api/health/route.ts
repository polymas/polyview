import { NextResponse } from 'next/server';
import axios from 'axios';

const BASE_URL = 'https://data-api.polymarket.com';

export async function GET() {
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    return NextResponse.json({
      status: 'healthy',
      polymarket_api: 'accessible',
    });
  } catch (error) {
    return NextResponse.json({
      status: 'healthy',
      polymarket_api: 'unavailable',
    });
  }
}

