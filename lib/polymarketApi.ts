import axios, { AxiosInstance } from 'axios';

const BASE_URL = 'https://data-api.polymarket.com';

const BATCH_SIZE_DEFAULT = 500;
const BATCH_SIZE_MAX = 500; // 官方文档 limit 最大 500
const API_REQUEST_LIMIT_MAX = 500; // 单次请求上限，与官方 limit 最大 500 一致；若某环境 4xx 可改回 100
const ACTIVITY_PATHS = ['/activity', '/v1/activity'] as const; // 先试文档路径，再回退 v1
const MAX_ACTIVITY_OFFSET = 3000; // Polymarket API：offset 超过 3000 会返回 400
const ACTIVITY_WINDOW_DAYS = 7; // 按时间窗口拉取；7 天 + limit=500 时单窗通常一页拉完，30 天约 5 窗 ≈ 5–10 次请求
const SIX_MONTHS_DAYS = 180; // 6个月

let _polyRequestIndex = 0;

function createSession(): AxiosInstance {
  const instance = axios.create({
    timeout: 60000, // 增加到60秒，因为可能需要获取大量数据
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });

  // 添加重试逻辑
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config || !config.retry) {
        config.retry = 0;
      }
      config.retry += 1;

      const status = error.response?.status;
      const isRetryable = status >= 500 || error.code === 'ECONNRESET';
      const maxRetries = status === 502 || status === 503 ? 5 : 3;
      if (config.retry <= maxRetries && isRetryable) {
        const delay = (status === 502 || status === 503 ? 2000 : 1000) * config.retry;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return instance(config);
      }

      return Promise.reject(error);
    }
  );

  return instance;
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp > 1e10 ? Math.floor(timestamp / 1000) : timestamp;
}

export async function fetchUserActivityFromAPI(
  user: string,
  limit: number = BATCH_SIZE_DEFAULT,
  offset: number = 0,
  sortBy: string = 'TIMESTAMP',
  sortDirection: string = 'DESC',
  excludeDepositsWithdrawals: boolean = true,
  start?: number,
  end?: number
): Promise<any[]> {
  const requestLimit = Math.min(Math.max(1, limit), API_REQUEST_LIMIT_MAX);
  const params: Record<string, string | number> = {
    user,
    limit: requestLimit,
    offset,
    sortBy,
    sortDirection,
    excludeDepositsWithdrawals: String(excludeDepositsWithdrawals).toLowerCase(),
  };
  if (start != null && start >= 0) params.start = start;
  if (end != null && end >= 0) params.end = end;

  const session = createSession();
  let lastError: any;

  for (const activityPath of ACTIVITY_PATHS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        _polyRequestIndex += 1;
        const url = `${BASE_URL}${activityPath}`;
        const query = new URLSearchParams(
          Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
        ).toString();
        const fullUrl = query ? `${url}?${query}` : url;
        console.log(`[Polymarket #${_polyRequestIndex}]`, fullUrl);
        const response = await session.get(`${BASE_URL}${activityPath}`, { params });
        let data = response.data;
        const count = Array.isArray(data) ? data.length : 0;
        console.log(`[Polymarket #${_polyRequestIndex}]`, '←', count, '条');

        if (!Array.isArray(data)) {
          const msg = typeof data?.error === 'string' ? data.error : '接口返回非列表';
          throw new Error(msg || 'Invalid response');
        }

        const conditionIdsEnv = process.env.FILTER_CONDITION_IDS;
        if (conditionIdsEnv) {
          const excludeConditionIds = conditionIdsEnv
            .split(',')
            .map(id => id.trim().toLowerCase())
            .filter(id => id.length > 0);
          if (excludeConditionIds.length > 0) {
            data = data.filter((item: any) => {
              const itemConditionId = item.conditionId;
              if (!itemConditionId) return true;
              return !excludeConditionIds.includes(String(itemConditionId).toLowerCase());
            });
          }
        }

        return data;
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        if (status === 404 && activityPath === '/activity') {
          break; // 换下一个路径
        }
        if (attempt < 2 && (status >= 500 || error.code === 'ECONNRESET')) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        if (activityPath === ACTIVITY_PATHS[ACTIVITY_PATHS.length - 1]) {
          const status = lastError?.response?.status;
          const body = lastError?.response?.data;
          const detail = status ? ` [${status}] ${typeof body?.error === 'string' ? body.error : ''}` : '';
          if (status === 502 || status === 503) {
            throw new Error(`Polymarket 服务暂时不可用(${status})，请稍后重试。${detail}`.trim());
          }
          throw new Error(`Polymarket API 请求失败: ${lastError?.message || '未知错误'}${detail}`.trim());
        }
        break;
      }
    }
  }

  const status = lastError?.response?.status;
  const body = lastError?.response?.data;
  const detail = status ? ` [${status}] ${typeof body?.error === 'string' ? body.error : ''}` : '';
  if (status === 502 || status === 503) {
    throw new Error(`Polymarket 服务暂时不可用(${status})，请稍后重试。${detail}`.trim());
  }
  throw new Error(`Polymarket API 请求失败: ${lastError?.message || '未知错误'}${detail}`.trim());
}

export function filterRecentData(data: any[], days: number = SIX_MONTHS_DAYS): any[] {
  if (!Array.isArray(data)) return [];
  const cutoffTimestamp = Math.floor((Date.now() / 1000) - days * 24 * 60 * 60);
  const filtered: any[] = [];

  for (const item of data) {
    const timestamp = normalizeTimestamp(item.timestamp || 0);
    if (timestamp >= cutoffTimestamp) {
      filtered.push(item);
    }
  }

  return filtered;
}

export function deduplicateByKey(data: any[]): any[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const item of data) {
    const key = `${item.transactionHash || ''}_${item.conditionId || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}

/**
 * 根据 conditionId 列表排除活动数据（排除模式）
 * 支持多个 conditionId，如果匹配任何一个则排除
 */
export function filterByConditionIds(data: any[], conditionIds?: string[] | null): any[] {
  if (!conditionIds || conditionIds.length === 0) {
    return data;
  }

  // 标准化 conditionId 列表（转为小写）
  const normalizedConditionIds = conditionIds
    .map(id => id.trim().toLowerCase())
    .filter(id => id.length > 0);

  if (normalizedConditionIds.length === 0) {
    return data;
  }

  const filtered: any[] = [];

  for (const item of data) {
    const itemConditionId = item.conditionId;
    if (!itemConditionId) {
      // 如果没有 conditionId，保留该项
      filtered.push(item);
      continue;
    }

    // 检查是否匹配任何一个 conditionId，如果匹配则排除
    const normalizedItemConditionId = String(itemConditionId).toLowerCase();
    if (!normalizedConditionIds.includes(normalizedItemConditionId)) {
      // 不匹配列表中的任何 conditionId，保留该项
      filtered.push(item);
    }
    // 如果匹配，则排除（不添加到 filtered 中）
  }

  return filtered;
}

// 辅助函数：从环境变量读取并过滤 conditionId
function filterByConditionIdsFromEnv(data: any[]): any[] {
  const conditionIdsEnv = process.env.FILTER_CONDITION_IDS;
  if (!conditionIdsEnv) {
    return data;
  }

  const excludeConditionIds = conditionIdsEnv
    .split(',')
    .map(id => id.trim().toLowerCase())
    .filter(id => id.length > 0);

  if (excludeConditionIds.length === 0) {
    return data;
  }

  return data.filter((item: any) => {
    const itemConditionId = item.conditionId;
    if (!itemConditionId) return true; // 保留没有 conditionId 的记录
    return !excludeConditionIds.includes(String(itemConditionId).toLowerCase());
  });
}

