const STORAGE_KEY = 'polyview_recent_addresses';
const MAX_RECENT = 5;

export interface RecentAddress {
  address: string;
  timestamp: number;
}

/**
 * 获取最近查询的地址列表
 */
export function getRecentAddresses(): RecentAddress[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const addresses: RecentAddress[] = JSON.parse(stored);
    // 按时间戳降序排序（最新的在前）
    return addresses.sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) {
    return [];
  }
}

/**
 * 添加地址到最近查询列表
 */
export function addRecentAddress(address: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const normalizedAddress = address.toLowerCase().trim();
    if (!normalizedAddress.startsWith('0x') || normalizedAddress.length !== 42) {
      return;
    }

    let addresses = getRecentAddresses();
    
    // 去重：移除已存在的相同地址
    addresses = addresses.filter(addr => addr.address.toLowerCase() !== normalizedAddress);
    
    // 添加新地址到最前面
    addresses.unshift({
      address: normalizedAddress,
      timestamp: Date.now(),
    });
    
    // 只保留最近5个
    addresses = addresses.slice(0, MAX_RECENT);
    
    // 保存到localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
  } catch (e) {
    // 忽略错误
  }
}

/**
 * 清除所有最近查询的地址
 */
export function clearRecentAddresses(): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // 忽略错误
  }
}

