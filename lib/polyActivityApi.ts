/**
 * poly_activity 后端客户端（服务端用，如 /api/activity 代理；前端已直连 polyking.site）
 * 文档: https://www.polyking.site/activity/llms.txt
 */
import { mapItemToLegacyShape } from './activityMapping';

const DEFAULT_BASE = 'https://www.polyking.site/activity';
const LIMIT_MAX = 3000;

function getBase(): string {
  const base = (process.env.POLY_ACTIVITY_BASE || DEFAULT_BASE).replace(/\/$/, '');
  return base;
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

export type GetActivityResult = {
  data: Record<string, unknown>[];
  backendRequestUrl?: string;
  backendRequestElapsedSec?: string;
};

/**
 * 从 poly_activity 拉取指定钱包、时间区间的活动，返回与旧源兼容的 camelCase 数组。
 */
export async function getActivityFromPolyActivity(
  address: string,
  options: GetActivityOptions
): Promise<GetActivityResult> {
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

  const fullUrl = `${url}?${new URLSearchParams(params as Record<string, string>).toString()}`;
  console.log('[polyActivityApi] 后端请求:', fullUrl);

  const startMs = Date.now();
  const res = await fetch(
    fullUrl,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    }
  );
  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(2);
  console.log('[polyActivityApi] 后端请求耗时:', elapsedSec, '秒', 'status:', res.status);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`poly_activity ${res.status}: ${text || res.statusText}`);
  }

  const body = (await res.json()) as { data?: unknown[]; total?: number };
  const raw = Array.isArray(body?.data) ? body.data : [];
  const mapped = raw.map((item) => mapItemToLegacyShape(item as Record<string, unknown>));
  return {
    data: filterByConditionIdsFromEnv(mapped),
    backendRequestUrl: fullUrl,
    backendRequestElapsedSec: elapsedSec,
  };
}
