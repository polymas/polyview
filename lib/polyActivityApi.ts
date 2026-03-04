/**
 * poly_activity 缓存后端客户端（新源）
 * 文档: https://www.polyking.site/activity/llms.txt
 * GET /wallets/{address}/activity?from_ts=&to_ts=&limit=&type=&force_refresh=
 * 返回格式统一为与旧源兼容的 camelCase，供 /api/activity 及前端复用。
 */

const DEFAULT_BASE = 'https://www.polyking.site/activity';
const LIMIT_MAX = 3000;

function getBase(): string {
  const base = (process.env.POLY_ACTIVITY_BASE || DEFAULT_BASE).replace(/\/$/, '');
  return base;
}

/** 新源单条可能是 snake_case：ts, type, share, condition_id, token_id, transaction_hash */
function mapItemToLegacyShape(item: Record<string, unknown>): Record<string, unknown> {
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

function filterByConditionIdsFromEnv(data: Record<string, unknown>[]): Record<string, unknown>[] {
  const envIds = process.env.FILTER_CONDITION_IDS;
  if (!envIds) return data;
  const exclude = envIds
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0);
  if (exclude.length === 0) return data;
  return data.filter((row) => {
    const cid = (row.conditionId ?? row.condition_id ?? '') as string;
    if (!cid) return true;
    return !exclude.includes(String(cid).toLowerCase());
  });
}

export type GetActivityOptions = {
  from_ts: number;
  to_ts?: number;
  limit?: number;
  type?: string;
  force_refresh?: boolean;
};

/**
 * 从 poly_activity 拉取指定钱包、时间区间的活动，返回与旧源兼容的 camelCase 数组。
 */
export async function getActivityFromPolyActivity(
  address: string,
  options: GetActivityOptions
): Promise<Record<string, unknown>[]> {
  const base = getBase();
  const addr = address.toLowerCase();
  const url = `${base}/wallets/${encodeURIComponent(addr)}/activity`;
  const params: Record<string, string | number | boolean> = {
    from_ts: options.from_ts,
  };
  if (options.to_ts != null) params.to_ts = options.to_ts;
  if (options.limit != null) params.limit = Math.min(Math.max(1, options.limit), LIMIT_MAX);
  if (options.type) params.type = options.type;
  if (options.force_refresh === true) params.force_refresh = true;

  const res = await fetch(
    `${url}?${new URLSearchParams(params as Record<string, string>).toString()}`,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`poly_activity ${res.status}: ${text || res.statusText}`);
  }

  const body = (await res.json()) as { data?: unknown[]; total?: number };
  const raw = Array.isArray(body?.data) ? body.data : [];
  const mapped = raw.map((item) => mapItemToLegacyShape(item as Record<string, unknown>));
  return filterByConditionIdsFromEnv(mapped);
}
