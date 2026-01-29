import axios, { AxiosInstance } from 'axios';

const BASE_URL = 'https://data-api.polymarket.com';

const BATCH_SIZE_DEFAULT = 100;
const BATCH_SIZE_MAX = 100;
const SIX_MONTHS_DAYS = 180; // 6个月

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

      if (config.retry <= 3 && (error.response?.status >= 500 || error.code === 'ECONNRESET')) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * config.retry));
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
  excludeDepositsWithdrawals: boolean = true
): Promise<any[]> {
  const params = {
    user,
    limit,
    offset,
    sortBy,
    sortDirection,
    excludeDepositsWithdrawals: String(excludeDepositsWithdrawals).toLowerCase(),
  };

  const session = createSession();
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await session.get(`${BASE_URL}/v1/activity`, { params });
      let data = response.data;

      // 在内部直接排除 conditionId
      const conditionIdsEnv = process.env.FILTER_CONDITION_IDS;
      if (conditionIdsEnv) {
        const excludeConditionIds = conditionIdsEnv
          .split(',')
          .map(id => id.trim().toLowerCase())
          .filter(id => id.length > 0);

        if (excludeConditionIds.length > 0) {
          data = data.filter((item: any) => {
            const itemConditionId = item.conditionId;
            if (!itemConditionId) return true; // 保留没有 conditionId 的记录
            return !excludeConditionIds.includes(String(itemConditionId).toLowerCase());
          });
        }
      }

      return data;
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }

  throw new Error(`Polymarket API 请求失败: ${lastError?.message || '未知错误'}`);
}

export function filterRecentData(data: any[], days: number = SIX_MONTHS_DAYS): any[] {
  const cutoffTimestamp = Math.floor((Date.now() / 1000) - days * 24 * 60 * 60);
  const filtered: any[] = [];

  // 遍历所有数据，不过滤掉任何在6个月内的数据
  // 注意：不再使用 break，因为同一批次可能包含不同月份的数据
  for (const item of data) {
    const timestamp = normalizeTimestamp(item.timestamp || 0);
    if (timestamp >= cutoffTimestamp) {
      filtered.push(item);
    }
  }

  return filtered;
}

export function deduplicateByKey(data: any[]): any[] {
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
  days?: number | null // 新增：按天数限制，如果指定则只获取最近N天的数据
): Promise<any[]> {
  const actualBatchSize = Math.min(batchSize, BATCH_SIZE_MAX);
  // 如果指定了days，使用days；否则使用默认的6个月
  const daysToFetch = days || SIX_MONTHS_DAYS;
  const cutoffTimestamp = Math.floor((Date.now() / 1000) - daysToFetch * 24 * 60 * 60);

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

  // 缓存过期或不存在，需要调用API
  // 先尝试读取已有缓存（如果有），用于后续合并
  // 如果指定了days，只读取最近N天的缓存（更快）
  const cachedData = useCache
    ? (days && cacheManager.getCachedActivitiesByDays
      ? filterByConditionIdsFromEnv(
        cacheManager.getCachedActivitiesByDays(user, days, sortBy, sortDirection)
      )
      : filterByConditionIdsFromEnv(
        cacheManager.getAllCachedActivities(user, sortBy, sortDirection)
      ))
    : [];

  const allActivities: any[] = [];
  let offset = 0;

  // 如果有缓存，检查是否需要继续获取
  if (cachedData && cachedData.length > 0) {
    try {
      const firstBatch = await fetchUserActivityFromAPI(
        user,
        actualBatchSize,
        0,
        sortBy,
        sortDirection,
        excludeDepositsWithdrawals
      );

      if (firstBatch && firstBatch.length > 0) {
        const filteredBatch = filterRecentData(firstBatch, daysToFetch);
        if (filteredBatch.length > 0) {
          const cachedRecent = filterRecentData(cachedData, daysToFetch);
          const cachedKeys = new Set(
            cachedRecent.map((item) => `${item.transactionHash || ''}_${item.conditionId || ''}`)
          );
          const firstBatchKeys = new Set(
            filteredBatch.map((item) => `${item.transactionHash || ''}_${item.conditionId || ''}`)
          );

          const isSubset = Array.from(firstBatchKeys).every((key) => cachedKeys.has(key));

          if (isSubset) {
            // 返回空数组，后续会使用缓存
          } else {
            allActivities.push(...filteredBatch);
            offset += actualBatchSize;
          }
        }
      }
    } catch (error) {
      // 获取第一批数据失败，将使用缓存
    }
  }

  // 循环获取数据
  let lastBatchMinTimestamp: number | null = null;

  while (true) {
    // 检查总体执行时间是否超时
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > MAX_EXECUTION_TIME_MS) {
      console.warn(`获取用户活动数据超时（已执行 ${Math.floor(elapsedTime / 1000)} 秒），返回已获取的数据`);
      // 如果已经有数据，返回已获取的数据；否则返回缓存数据
      if (allActivities.length > 0) {
        break; // 跳出循环，返回已获取的数据
      } else if (cachedData && cachedData.length > 0) {
        // 返回缓存数据
        if (maxRecords) {
          return cachedData.slice(0, maxRecords);
        }
        return cachedData;
      } else {
        throw new Error(`获取用户活动数据超时（已执行 ${Math.floor(elapsedTime / 1000)} 秒），请稍后重试或使用缓存`);
      }
    }

    try {
      const batch = await fetchUserActivityFromAPI(
        user,
        actualBatchSize,
        offset,
        sortBy,
        sortDirection,
        excludeDepositsWithdrawals
      );

      if (!batch || batch.length === 0) {
        break;
      }

      const filteredBatch = filterRecentData(batch, daysToFetch);

      // 如果过滤后的批次为空，检查是否所有数据都超过6个月
      // 如果是，说明已经获取完所有6个月内的数据，可以停止
      // 但需要检查是否还有更早的数据需要获取
      if (filteredBatch.length === 0) {
        // 检查批次中最早的时间戳是否还在6个月内
        if (batch.length > 0) {
          const earliestInBatch = Math.min(
            ...batch.map(item => normalizeTimestamp(item.timestamp || 0))
          );
          if (earliestInBatch < cutoffTimestamp) {
            // 所有数据都超过6个月，停止获取
            break;
          }
        } else {
          break;
        }
        // 如果批次为空但可能还有数据，继续获取下一批
        offset += actualBatchSize;
        if (offset > 10000) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      // 检测时间逆序
      if (lastBatchMinTimestamp !== null && filteredBatch.length > 0) {
        const firstTimestamp = normalizeTimestamp(filteredBatch[0].timestamp || 0);
        if (firstTimestamp > lastBatchMinTimestamp) {
          break;
        }
      }

      const uniqueBatch = deduplicateByKey(filteredBatch);
      allActivities.push(...uniqueBatch);

      if (uniqueBatch.length > 0) {
        lastBatchMinTimestamp = Math.min(
          ...uniqueBatch.map((item) => normalizeTimestamp(item.timestamp || 0))
        );
      }

      // 增量保存缓存
      if (useCache && uniqueBatch.length > 0) {
        try {
          cacheManager.saveActivities(user, uniqueBatch);
        } catch (e) {
          // 保存缓存失败，忽略错误
        }
      }

      if (maxRecords && allActivities.length >= maxRecords) {
        allActivities.splice(maxRecords);
        break;
      }

      offset += actualBatchSize;
      // 增加offset限制，确保能获取更多历史数据
      if (offset > 50000) {
        break;
      }

      // 添加延迟避免请求过快
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error: any) {
      // 如果是超时错误，尝试返回已获取的数据或缓存数据
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout') || error.message?.includes('超时')) {
        console.warn('API请求超时，尝试返回已获取的数据或缓存数据');
        if (allActivities.length > 0) {
          break; // 跳出循环，返回已获取的数据
        } else if (cachedData && cachedData.length > 0) {
          // 返回缓存数据
          if (maxRecords) {
            return cachedData.slice(0, maxRecords);
          }
          return cachedData;
        }
      }
      throw error;
    }
  }

  // 合并缓存和API数据
  if (cachedData && cachedData.length > 0) {
    const mergedData = deduplicateByKey(allActivities);
    const cachedRecent = filterRecentData(cachedData, daysToFetch);
    const cachedKeys = new Set(
      mergedData.map((item) => `${item.transactionHash || ''}_${item.conditionId || ''}`)
    );

    for (const item of cachedRecent) {
      const key = `${item.transactionHash || ''}_${item.conditionId || ''}`;
      if (!cachedKeys.has(key)) {
        mergedData.push(item);
      }
    }

    mergedData.sort((a, b) => {
      const aTime = normalizeTimestamp(a.timestamp || 0);
      const bTime = normalizeTimestamp(b.timestamp || 0);
      return sortDirection === 'DESC' ? bTime - aTime : aTime - bTime;
    });

    if (maxRecords) {
      mergedData.splice(maxRecords);
    }

    // 对合并后的数据也应用过滤（确保缓存数据被过滤）
    return filterByConditionIdsFromEnv(mergedData);
  }

  // 对最终结果也应用过滤
  return filterByConditionIdsFromEnv(allActivities);
}

