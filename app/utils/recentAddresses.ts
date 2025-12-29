const STORAGE_KEY = 'polyview_recent_addresses';
const FAVORITES_KEY = 'polyview_favorite_addresses';
const MAX_RECENT = 5;

export interface RecentAddress {
  address: string;
  timestamp: number;
  note?: string; // 收藏备注
  isFavorite?: boolean; // 是否收藏
}

/**
 * 获取收藏的地址列表
 */
export function getFavoriteAddresses(): RecentAddress[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    if (!stored) return [];
    
    const favorites: Record<string, { note: string; timestamp: number }> = JSON.parse(stored);
    return Object.entries(favorites).map(([address, data]) => ({
      address,
      timestamp: data.timestamp,
      note: data.note,
      isFavorite: true,
    }));
  } catch (e) {
    return [];
  }
}

/**
 * 获取最近查询的地址列表（包含收藏信息）
 */
export function getRecentAddresses(): RecentAddress[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const favorites = getFavoriteAddresses();
    const favoritesMap = new Map(favorites.map(f => [f.address.toLowerCase(), f]));
    
    if (!stored) {
      // 如果没有最近查询，但有收藏，返回收藏列表（按备注名称排序）
      return favorites.sort((a, b) => {
        const aNote = (a.note || '').toLowerCase();
        const bNote = (b.note || '').toLowerCase();
        return aNote.localeCompare(bNote, 'zh-CN');
      });
    }
    
    const addresses: RecentAddress[] = JSON.parse(stored);
    
    // 合并收藏信息
    const addressesWithFavorites = addresses.map(addr => {
      const favorite = favoritesMap.get(addr.address.toLowerCase());
      if (favorite) {
        return {
          ...addr,
          note: favorite.note,
          isFavorite: true,
        };
      }
      return addr;
    });
    
    // 排序：收藏的按备注名称排序，非收藏的按时间戳降序排序，非收藏的排最后
    return addressesWithFavorites.sort((a, b) => {
      const aIsFavorite = a.isFavorite || false;
      const bIsFavorite = b.isFavorite || false;
      
      // 如果一个是收藏，一个不是，收藏的排在前面
      if (aIsFavorite && !bIsFavorite) return -1;
      if (!aIsFavorite && bIsFavorite) return 1;
      
      // 如果都是收藏，按备注名称排序
      if (aIsFavorite && bIsFavorite) {
        const aNote = (a.note || '').toLowerCase();
        const bNote = (b.note || '').toLowerCase();
        return aNote.localeCompare(bNote, 'zh-CN');
      }
      
      // 如果都不是收藏，按时间戳降序排序（最新的在前）
      return b.timestamp - a.timestamp;
    });
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
 * 添加收藏
 */
export function addFavorite(address: string, note: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const normalizedAddress = address.toLowerCase().trim();
    if (!normalizedAddress.startsWith('0x') || normalizedAddress.length !== 42) {
      return;
    }

    const stored = localStorage.getItem(FAVORITES_KEY);
    const favorites: Record<string, { note: string; timestamp: number }> = stored 
      ? JSON.parse(stored) 
      : {};
    
    favorites[normalizedAddress] = {
      note: note.trim(),
      timestamp: Date.now(),
    };
    
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    
    // 同时更新最近查询列表中的收藏状态
    const recentStored = localStorage.getItem(STORAGE_KEY);
    if (recentStored) {
      const recentAddresses: RecentAddress[] = JSON.parse(recentStored);
      const updated = recentAddresses.map(addr => 
        addr.address.toLowerCase() === normalizedAddress
          ? { ...addr, note: note.trim(), isFavorite: true }
          : addr
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  } catch (e) {
    // 忽略错误
  }
}

/**
 * 移除收藏
 */
export function removeFavorite(address: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const normalizedAddress = address.toLowerCase().trim();
    
    const stored = localStorage.getItem(FAVORITES_KEY);
    if (stored) {
      const favorites: Record<string, { note: string; timestamp: number }> = JSON.parse(stored);
      delete favorites[normalizedAddress];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    }
    
    // 同时更新最近查询列表中的收藏状态
    const recentStored = localStorage.getItem(STORAGE_KEY);
    if (recentStored) {
      const recentAddresses: RecentAddress[] = JSON.parse(recentStored);
      const updated = recentAddresses.map(addr => 
        addr.address.toLowerCase() === normalizedAddress
          ? { ...addr, note: undefined, isFavorite: false }
          : addr
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  } catch (e) {
    // 忽略错误
  }
}

/**
 * 检查地址是否已收藏
 */
export function isFavorite(address: string): boolean {
  if (typeof window === 'undefined') return false;
  
  try {
    const normalizedAddress = address.toLowerCase().trim();
    const stored = localStorage.getItem(FAVORITES_KEY);
    if (!stored) return false;
    
    const favorites: Record<string, { note: string; timestamp: number }> = JSON.parse(stored);
    return !!favorites[normalizedAddress];
  } catch (e) {
    return false;
  }
}

/**
 * 获取收藏备注
 */
export function getFavoriteNote(address: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  
  try {
    const normalizedAddress = address.toLowerCase().trim();
    const stored = localStorage.getItem(FAVORITES_KEY);
    if (!stored) return undefined;
    
    const favorites: Record<string, { note: string; timestamp: number }> = JSON.parse(stored);
    return favorites[normalizedAddress]?.note;
  } catch (e) {
    return undefined;
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

