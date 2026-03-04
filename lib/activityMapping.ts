/**
 * polyking.site 活动条目的统一映射（服务端与前端共用，无 Node 专有逻辑）
 * 将 snake_case 转为 camelCase，与 pnlCalculator / 前端展示一致。
 */
export function mapItemToLegacyShape(item: Record<string, unknown>): Record<string, unknown> {
  const ts = Number(item.ts ?? item.timestamp ?? 0);
  const timestamp = ts > 1e10 ? Math.floor(ts / 1000) : ts;
  const typeRaw = String(item.type ?? item.side ?? 'TRADE').toUpperCase();
  const isRedeem = typeRaw === 'REDEEM';
  const type = isRedeem ? 'REDEEM' : 'TRADE';
  const side = !isRedeem && (typeRaw === 'BUY' || typeRaw === 'SELL') ? typeRaw : undefined;
  const share = Number(item.share ?? item.size ?? 0);
  return {
    timestamp,
    type,
    ...(side && { side }),
    size: share,
    usdcSize: item.usdc_size ?? item.usdcSize,
    price: item.price ?? 0,
    title: item.title ?? item.question ?? '',
    outcome: item.outcome ?? '',
    conditionId: item.condition_id ?? item.conditionId ?? '',
    tokenId: item.token_id ?? item.tokenId ?? item.asset ?? '',
    transactionHash: item.transaction_hash ?? item.transactionHash ?? '',
    user: item.user ?? '',
  };
}

/** 上个月1号 00:00:00 UTC 的 Unix 秒时间戳（与 API route 一致） */
export function getLastMonthFirstUtcSeconds(): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1, 0, 0, 0, 0));
  return Math.floor(first.getTime() / 1000);
}
