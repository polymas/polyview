import { NextRequest, NextResponse } from 'next/server';
import { cacheManager } from '../../../../lib/cache';
import { getAllUserActivity } from '../../../../lib/polymarketApi';

const USER = '0x8ec4c13da685b5505399889012a57b954fb246c2';

/**
 * 调试用：看指定 conditionId 在 API 返回里的原始 activity 与转换后的 transactions。
 * GET /api/debug-activity?conditionId=0x6e757349fd02ac...
 */
export async function GET(request: NextRequest) {
  const conditionId = request.nextUrl.searchParams.get('conditionId');
  if (!conditionId || !conditionId.startsWith('0x')) {
    return NextResponse.json(
      { error: '需要 query: conditionId=0x...' },
      { status: 400 }
    );
  }

  const cidLower = conditionId.toLowerCase();

  try {
    const activities = await getAllUserActivity(
      USER,
      cacheManager,
      'TIMESTAMP',
      'DESC',
      500,
      null,
      false,
      true,
      30
    );

    const rawForMarket = activities.filter(
      (a: any) => (a.conditionId || '').toLowerCase() === cidLower
    );

    // 简单 transform 一份，和 services/polymarketApi 一致，便于看 amount 是否被补全
    const transformed = rawForMarket
      .filter((a: any) => a.type === 'TRADE' || a.type === 'REDEEM')
      .map((a: any) => {
        const size = parseFloat(a.size || '0');
        const usdcSize = parseFloat(a.usdcSize || '0');
        const price = parseFloat(a.price || '0');
        let amount = Math.abs(size || 0);
        const isRedeem = (a.type || '').toUpperCase() === 'REDEEM';
        if (isRedeem && amount === 0 && usdcSize > 0) amount = Math.abs(usdcSize);
        return {
          type: isRedeem ? 'SELL' : (a.side || '').toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
          originalType: a.type,
          amount,
          size,
          usdcSize,
          price: a.price,
          timestamp: a.timestamp,
          transactionHash: a.transactionHash,
          conditionId: a.conditionId,
        };
      });

    // 若不做 usdcSize 补全，这些记录会因 amount=0 被 pnlCalculator 滤掉
    const wouldDrop = rawForMarket.filter(
      (a: any) =>
        (a.type === 'TRADE' || a.type === 'REDEEM') &&
        Math.abs(parseFloat(a.size || '0')) === 0
    );

    return NextResponse.json({
      conditionId,
      totalActivitiesFetched: activities.length,
      rawForThisMarket: rawForMarket.length,
      raw: rawForMarket,
      transformed,
      wouldHaveBeenDroppedByAmountZero: wouldDrop.length,
      wouldDropRaw: wouldDrop,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
