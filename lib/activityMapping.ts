/**
 * 活动条目的统一映射（服务端与前端共用，无 Node 专有逻辑）
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
