/**
 * 文件访问链接缓存工具
 * 用于缓存后端返回的临时访问链接，并支持设置过期时间
 */

interface CacheItem<T> {
  value: T;
  expireAt: number; // 过期时间戳 (ms)
}

class FileCache {
  private prefix = 'file_link_cache_';
  private defaultExpireMinutes = 30;

  /**
   * 生成缓存键名
   * @param nodeId 节点ID
   * @param libraryId 仓库ID
   */
  private getCacheKey(nodeId: number | string, libraryId: number | string): string {
    return `${this.prefix}${libraryId}_${nodeId}`;
  }

  /**
   * 存储链接
   * @param nodeId 节点ID
   * @param libraryId 仓库ID
   * @param url 文件访问链接
   * @param expireMinutes 过期时间（分钟），默认30分钟
   */
  setLink(nodeId: number | string, libraryId: number | string, url: string, expireMinutes: number = this.defaultExpireMinutes): void {
    const key = this.getCacheKey(nodeId, libraryId);
    const expireAt = Date.now() + expireMinutes * 60 * 1000;
    
    const cacheItem: CacheItem<string> = {
      value: url,
      expireAt
    };

    try {
      localStorage.setItem(key, JSON.stringify(cacheItem));
    } catch (e) {
      console.warn('FileCache: Failed to save to localStorage', e);
      // 如果 localStorage 满了，可以尝试清理过期的
      this.clearExpired();
    }
  }

  /**
   * 获取缓存的链接
   * @param nodeId 节点ID
   * @param libraryId 仓库ID
   * @returns 有效链接或 null
   */
  getLink(nodeId: number | string, libraryId: number | string): string | null {
    const key = this.getCacheKey(nodeId, libraryId);
    const cached = localStorage.getItem(key);

    if (!cached) return null;

    try {
      const item: CacheItem<string> = JSON.parse(cached);
      
      // 检查是否过期
      if (Date.now() > item.expireAt) {
        localStorage.removeItem(key);
        return null;
      }

      return item.value;
    } catch (e) {
      localStorage.removeItem(key);
      return null;
    }
  }

  /**
   * 手动移除某个缓存
   */
  removeLink(nodeId: number | string, libraryId: number | string): void {
    const key = this.getCacheKey(nodeId, libraryId);
    localStorage.removeItem(key);
  }

  /**
   * 清理所有过期的缓存
   */
  clearExpired(): void {
    const now = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) {
        try {
          const item: CacheItem<any> = JSON.parse(localStorage.getItem(key) || '');
          if (now > item.expireAt) {
            localStorage.removeItem(key);
          }
        } catch (e) {
          localStorage.removeItem(key);
        }
      }
    }
  }

  /**
   * 清空所有文件链接缓存
   */
  clearAll(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
}

export const fileCache = new FileCache();

