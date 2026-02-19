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

export async function getUserActivity(
  user: string,
  cacheManager: any,
  limit: number = BATCH_SIZE_DEFAULT,
  offset: number = 0,
  sortBy: string = 'TIMESTAMP',
  sortDirection: string = 'DESC',
  useCache: boolean = true,
  excludeDepositsWithdrawals: boolean = true
): Promise<any[]> {
  _polyRequestIndex = 0;
  if (!useCache) {
    return fetchUserActivityFromAPI(user, limit, offset, sortBy, sortDirection, excludeDepositsWithdrawals);
  }

  // 优先检查缓存是否足够新且有数据（5分钟内）
  const CACHE_MAX_AGE_SECONDS = 300; // 5分钟
  const isCacheFreshAndHasData = cacheManager.isCacheFreshAndHasData
    ? cacheManager.isCacheFreshAndHasData(user, CACHE_MAX_AGE_SECONDS)
    : false;

  // 如果缓存足够新且有数据，直接返回缓存数据，完全跳过API调用
  if (isCacheFreshAndHasData) {
    try {
      const cachedData = cacheManager.getCachedActivities(user, limit, offset, sortBy, sortDirection);
      if (cachedData && cachedData.length > 0) {
        // 对从缓存读取的数据也应用过滤
        return filterByConditionIdsFromEnv(cachedData);
      }
    } catch (e) {
      // 缓存读取失败，继续执行API调用
      console.warn('缓存读取失败，继续执行API调用:', e);
    }
  }

  // 缓存过期或不存在，调用API更新缓存
  const cacheUpdateLimit = Math.max(limit + offset, 100);

  try {
    const latestData = await fetchUserActivityFromAPI(
      user,
      cacheUpdateLimit,
      0,
      sortBy,
      sortDirection,
      excludeDepositsWithdrawals
    );

    if (latestData && latestData.length > 0) {
      cacheManager.saveActivities(user, latestData);
    }

    const cachedData = cacheManager.getCachedActivities(user, limit, offset, sortBy, sortDirection);
    // 对从缓存读取的数据也应用过滤
    return filterByConditionIdsFromEnv(cachedData);
  } catch (error: any) {
    // 如果是超时错误，尝试返回缓存数据
    const isTimeoutError =
      error.code === 'ECONNABORTED' ||
      error.message?.includes('timeout') ||
      error.message?.includes('超时') ||
      error.message?.includes('timed out');

    try {
      const cachedData = cacheManager.getCachedActivities(user, limit, offset, sortBy, sortDirection);
      if (cachedData && cachedData.length > 0) {
        // 对从缓存读取的数据也应用过滤
        if (isTimeoutError) {
          console.warn('API请求超时，返回缓存数据');
        }
        return filterByConditionIdsFromEnv(cachedData);
      }
    } catch (e) {
      // 忽略缓存错误
    }

    // 如果是超时错误且没有缓存数据，抛出更友好的错误信息
    if (isTimeoutError) {
      throw new Error(`获取用户活动数据超时，请稍后重试或检查网络连接`);
    }

    throw error;
  }
}

export async function getAllUserActivity(
  user: string,
  cacheManager: any,
  sortBy: string = 'TIMESTAMP',
  sortDirection: string = 'DESC',
  batchSize: number = BATCH_SIZE_DEFAULT,
  maxRecords?: number | null,
  useCache: boolean = true,
  excludeDepositsWithdrawals: boolean = true,
  days?: number | null, // 按天数限制，只获取最近 N 天
  startTimestamp?: number | null // 若指定，则从该时间戳（含）拉取到当天，忽略 days
): Promise<any[]> {
  _polyRequestIndex = 0; // 本轮请求序号从 1 开始
  const actualBatchSize = Math.min(batchSize, BATCH_SIZE_MAX);
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffTimestamp =
    startTimestamp != null && startTimestamp > 0
      ? startTimestamp
      : Math.floor(nowSec - (days ?? SIX_MONTHS_DAYS) * 24 * 60 * 60);
  const daysToFetch = days ?? SIX_MONTHS_DAYS; // 仅用于 filterRecentData 与缓存语义

  // 总体超时控制：最大执行时间5分钟（300秒）
  const MAX_EXECUTION_TIME_MS = 300000; // 5分钟
  const startTime = Date.now();

  // 优先检查缓存是否足够新且有数据（5分钟内）- 先检查，避免不必要的缓存读取
  const CACHE_MAX_AGE_SECONDS = 300; // 5分钟
  const isCacheFreshAndHasData = useCache && cacheManager.isCacheFreshAndHasData
    ? cacheManager.isCacheFreshAndHasData(user, CACHE_MAX_AGE_SECONDS)
    : false;

  // 如果缓存足够新且有数据，直接读取并返回缓存数据，完全跳过API调用
  if (isCacheFreshAndHasData && useCache) {
    try {
      // 如果指定了days，使用按天数读取的方法（更快）
      const cachedData = days && cacheManager.getCachedActivitiesByDays
        ? filterByConditionIdsFromEnv(
          cacheManager.getCachedActivitiesByDays(user, days, sortBy, sortDirection)
        )
        : filterByConditionIdsFromEnv(
          cacheManager.getAllCachedActivities(user, sortBy, sortDirection)
        );

      if (cachedData && cachedData.length > 0) {
        if (maxRecords) {
          return cachedData.slice(0, maxRecords);
        }
        return cachedData;
      }
    } catch (e) {
      // 缓存读取失败，继续执行API调用
      console.warn('缓存读取失败，继续执行API调用:', e);
    }
  }

  // 缓存过期或不存在，需要调用API；先尝试读取已有缓存用于合并
  let cachedData: any[] = [];
  if (useCache) {
    try {
      const raw = days && cacheManager.getCachedActivitiesByDays
        ? cacheManager.getCachedActivitiesByDays(user, days, sortBy, sortDirection)
        : cacheManager.getAllCachedActivities(user, sortBy, sortDirection);
      cachedData = Array.isArray(raw) ? filterByConditionIdsFromEnv(raw) : [];
    } catch (e) {
      console.warn('读取缓存失败，将仅使用 API 数据:', (e as Error)?.message);
    }
  }

  const allActivities: any[] = [];
  const windowSeconds = ACTIVITY_WINDOW_DAYS * 24 * 60 * 60;

  // 按时间窗口分页拉取，避免单次 offset 超过 3000 导致漏掉较早的 REDEEM（平仓），从而误判为未平仓
  for (let windowStart = cutoffTimestamp; windowStart < nowSec; windowStart += windowSeconds) {
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > MAX_EXECUTION_TIME_MS) {
      console.warn(`获取用户活动数据超时（已执行 ${Math.floor(elapsedTime / 1000)} 秒），返回已获取的数据`);
      break;
    }

    const windowEnd = Math.min(windowStart + windowSeconds, nowSec);
    let windowOffset = 0;

    while (windowOffset < MAX_ACTIVITY_OFFSET) {
      try {
        if (windowOffset > 0) {
          console.log(`[Polymarket] 窗口内分页 offset=${windowOffset}`);
        }
        const batch = await fetchUserActivityFromAPI(
          user,
          actualBatchSize,
          windowOffset,
          sortBy,
          sortDirection,
          excludeDepositsWithdrawals,
          windowStart,
          windowEnd
        );

        if (!batch || batch.length === 0) break;

        const filteredBatch = filterRecentData(batch, daysToFetch);
        const uniqueBatch = deduplicateByKey(filteredBatch);
        if (uniqueBatch.length > 0) {
          allActivities.push(...uniqueBatch);
          if (useCache) {
            try {
              cacheManager.saveActivities(user, uniqueBatch);
            } catch (e) {
              /* 忽略 */
            }
          }
        }

        if (batch.length < actualBatchSize) break;
        windowOffset += batch.length;
        // 若 API 在 start/end 下忽略 offset，会一直拿到同一页；用 1 天窗口降低单窗条数，减少漏数
        if (maxRecords && allActivities.length >= maxRecords) break;
        await new Promise((r) => setTimeout(r, 300));
      } catch (error: any) {
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout') || error.message?.includes('超时')) {
          console.warn('窗口请求超时，继续下一窗口');
          break;
        }
        throw error;
      }
    }

    if (maxRecords && allActivities.length >= maxRecords) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // 若 API 忽略 start/end，按窗口拉取可能只得到同一批数据；补拉「最旧」3000 条（ASC）并合并，减少漏平仓
  if (allActivities.length > 0 && allActivities.length <= MAX_ACTIVITY_OFFSET) {
    try {
      let ascOffset = 0;
      const ascActivities: any[] = [];
      while (ascOffset < MAX_ACTIVITY_OFFSET) {
        if (ascOffset > 0) {
          console.log(`[Polymarket] ASC 补充拉取 下一页 offset=${ascOffset}`);
        }
        const batch = await fetchUserActivityFromAPI(
          user,
          actualBatchSize,
          ascOffset,
          sortBy,
          'ASC',
          excludeDepositsWithdrawals,
          cutoffTimestamp,
          nowSec
        );
        if (!batch || batch.length === 0) {
          if (ascOffset > 0) {
            console.log(`[Polymarket] ASC 结束: 本页 0 条，已共补拉 ${ascActivities.length} 条`);
          }
          break;
        }
        const filtered = filterRecentData(batch, daysToFetch);
        ascActivities.push(...filtered);
        if (batch.length < actualBatchSize) {
          console.log(`[Polymarket] ASC 结束: 本页 ${batch.length} 条（不足一页），已共补拉 ${ascActivities.length} 条`);
          break;
        }
        ascOffset += batch.length;
        await new Promise((r) => setTimeout(r, 300));
      }
      if (ascActivities.length > 0) {
        const keys = new Set(allActivities.map((item) => `${item.transactionHash || ''}_${item.conditionId || ''}`));
        for (const item of ascActivities) {
          const key = `${item.transactionHash || ''}_${item.conditionId || ''}`;
          if (!keys.has(key)) {
            allActivities.push(item);
            keys.add(key);
          }
        }
      }
    } catch (e) {
      const err = e as Error;
      console.warn('ASC 补充拉取失败，已忽略:', err?.message);
      // 若为 offset 超限等 4xx，不再重试，避免刷屏
      if (err?.message?.includes('400') || err?.message?.includes('offset')) {
        console.log('[Polymarket] ASC 因 API 限制终止，已合并此前补拉数据');
      }
    }
  }

  let result = deduplicateByKey(allActivities);
  result.sort((a, b) => {
    const aTime = normalizeTimestamp(a.timestamp || 0);
    const bTime = normalizeTimestamp(b.timestamp || 0);
    return sortDirection === 'DESC' ? bTime - aTime : aTime - bTime;
  });
  if (maxRecords) result = result.slice(0, maxRecords);

  // 强制刷新（use_cache=false）时也写回缓存，下次查询即可用新数据
  if (!useCache && result.length > 0) {
    try {
      cacheManager.saveActivities(user, result);
    } catch (e) {
      /* 忽略 */
    }
  }

  // 合并缓存中可能存在的额外记录（避免漏掉）
  if (cachedData && cachedData.length > 0) {
    const resultKeys = new Set(result.map((item) => `${item.transactionHash || ''}_${item.conditionId || ''}`));
    const cachedRecent = filterRecentData(cachedData, daysToFetch);
    for (const item of cachedRecent) {
      const key = `${item.transactionHash || ''}_${item.conditionId || ''}`;
      if (!resultKeys.has(key)) {
        result.push(item);
        resultKeys.add(key);
      }
    }
    result.sort((a, b) => {
      const aTime = normalizeTimestamp(a.timestamp || 0);
      const bTime = normalizeTimestamp(b.timestamp || 0);
      return sortDirection === 'DESC' ? bTime - aTime : aTime - bTime;
    });
    if (maxRecords) result = result.slice(0, maxRecords);
  }

  return filterByConditionIdsFromEnv(result);
}

