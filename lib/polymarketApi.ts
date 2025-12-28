import axios, { AxiosInstance } from 'axios';

const BASE_URL = 'https://data-api.polymarket.com';

const BATCH_SIZE_DEFAULT = 100;
const BATCH_SIZE_MAX = 100;
const THREE_MONTHS_DAYS = 90;

function createSession(): AxiosInstance {
  const instance = axios.create({
    timeout: 30000,
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
      return response.data;
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }

  throw new Error(`Polymarket API 请求失败: ${lastError?.message || '未知错误'}`);
}

export function filterRecentData(data: any[], days: number = THREE_MONTHS_DAYS): any[] {
  const cutoffTimestamp = Math.floor((Date.now() / 1000) - days * 24 * 60 * 60);
  const filtered: any[] = [];
  
  for (const item of data) {
    const timestamp = normalizeTimestamp(item.timestamp || 0);
    if (timestamp >= cutoffTimestamp) {
      filtered.push(item);
    } else {
      break; // 数据已排序，遇到旧数据即可停止
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

    return cacheManager.getCachedActivities(user, limit, offset, sortBy, sortDirection);
  } catch (error: any) {
    try {
      const cachedData = cacheManager.getCachedActivities(user, limit, offset, sortBy, sortDirection);
      if (cachedData && cachedData.length > 0) {
        return cachedData;
      }
    } catch (e) {
      // 忽略缓存错误
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
  excludeDepositsWithdrawals: boolean = true
): Promise<any[]> {
  const actualBatchSize = Math.min(batchSize, BATCH_SIZE_MAX);
  const cutoffTimestamp = Math.floor((Date.now() / 1000) - THREE_MONTHS_DAYS * 24 * 60 * 60);

  // 获取缓存数据
  const cachedData = useCache
    ? cacheManager.getAllCachedActivities(user, sortBy, sortDirection)
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
        const filteredBatch = filterRecentData(firstBatch, THREE_MONTHS_DAYS);
        if (filteredBatch.length > 0) {
          const cachedRecent = filterRecentData(cachedData, THREE_MONTHS_DAYS);
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

      const filteredBatch = filterRecentData(batch, THREE_MONTHS_DAYS);
      if (filteredBatch.length === 0) {
        break;
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
      if (offset > 10000) {
        break;
      }

      // 添加延迟避免请求过快
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      throw error;
    }
  }

  // 合并缓存和API数据
  if (cachedData && cachedData.length > 0) {
    const mergedData = deduplicateByKey(allActivities);
    const cachedRecent = filterRecentData(cachedData, THREE_MONTHS_DAYS);
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

    return mergedData;
  }

  return allActivities;
}

