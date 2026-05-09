/**
 * 统一缓存层
 * 基于 localStorage 实现，支持 TTL、体积限制、scope 隔离
 */

import { CACHE_EXPIRY_MS } from '@/utils/constants';

const CACHE_PREFIX = 'cli-proxy-cache';
const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface CacheOptions {
  /** TTL，默认 CACHE_EXPIRY_MS (30s) */
  maxAgeMs?: number;
  /** 体积限制，默认 5MB */
  maxSizeBytes?: number;
  /** 隔离域，如 apiBase::managementKey */
  scopeKey?: string;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  scopeKey: string;
  maxAgeMs: number;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 构建完整 localStorage key */
function buildKey(scopeKey: string, key: string): string {
  return `${CACHE_PREFIX}:${scopeKey}:${key}`;
}

/** 估算 JSON 字符串字节大小（近似值） */
function estimateBytes(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

/** 安全地估算缓存条目大小，返回保守值 */
function estimateCacheEntrySize(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as { _size?: number; data?: unknown };
    if (parsed._size !== undefined) {
      return parsed._size;
    }
    if (parsed.data !== undefined) {
      return estimateBytes(parsed.data);
    }
  } catch {
    // 解析失败时使用字符串大小作为近似
  }
  return estimateBytes(raw);
}

function formatDebugKey(scopeKey: string, key: string): string {
  return scopeKey ? `${key} [scope redacted]` : `${key} [global]`;
}

/** 获取所有属于某个 scopeKey 的缓存 key */
function collectScopeKeys(scopeKey: string): string[] {
  const prefix = buildKey(scopeKey, '');
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      keys.push(k);
    }
  }
  return keys;
}

/** 获取所有缓存条目元数据（用于 LRU 淘汰） */
function collectAllCacheEntries(): Array<{ fullKey: string; timestamp: number; size: number }> {
  const entries: Array<{ fullKey: string; timestamp: number; size: number }> = [];
  const prefix = CACHE_PREFIX + ':';
  for (let i = 0; i < localStorage.length; i++) {
    const fullKey = localStorage.key(i);
    if (!fullKey || !fullKey.startsWith(prefix)) continue;
    try {
      const raw = localStorage.getItem(fullKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { timestamp: number; _size?: number };
      entries.push({
        fullKey,
        timestamp: parsed.timestamp,
        size: parsed._size ?? estimateBytes(raw),
      });
    } catch {
      // 跳过无效数据
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// CacheLayer 单例
// ---------------------------------------------------------------------------

class CacheLayerImpl {
  private subscribers = new Map<string, Set<() => void>>();
  private globalSubscribers = new Set<(key: string, scopeKey: string) => void>();
  private estimatedTotalBytes: number | null = null;

  /**
   * 订阅缓存变更事件
   */
  subscribe(key: string, callback: () => void, scopeKey?: string): () => void {
    const fullKey = buildKey(scopeKey ?? '', key);
    if (!this.subscribers.has(fullKey)) {
      this.subscribers.set(fullKey, new Set());
    }
    const set = this.subscribers.get(fullKey)!;
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.subscribers.delete(fullKey);
      }
    };
  }

  /**
   * 订阅所有缓存变更
   */
  subscribeGlobal(callback: (key: string, scopeKey: string) => void): () => void {
    this.globalSubscribers.add(callback);
    return () => this.globalSubscribers.delete(callback);
  }

  /**
   * 通知订阅者缓存已更新
   * 异步微任务执行，避免同步递归死锁
   */
  private notifyUpdated(key: string, scopeKey: string): void {
    const fullKey = buildKey(scopeKey, key);
    const keySubscribers = this.subscribers.get(fullKey);
    const globalSubs = Array.from(this.globalSubscribers);

    queueMicrotask(() => {
      keySubscribers?.forEach((cb) => {
        try {
          cb();
        } catch (e) {
          console.error('Cache subscriber error:', e);
        }
      });
      globalSubs.forEach((cb) => {
        try {
          cb(key, scopeKey);
        } catch (e) {
          console.error('Global cache subscriber error:', e);
        }
      });
    });
  }

  /**
   * 读取缓存条目
   * - 自动检查 TTL 是否过期，过期返回 null
   */
  get<T>(key: string, scopeKey?: string): CacheEntry<T> | null {
    const resolvedScope = scopeKey ?? '';
    const fullKey = buildKey(resolvedScope, key);
    const debugKey = formatDebugKey(resolvedScope, key);

    try {
      const raw = localStorage.getItem(fullKey);
      if (!raw) {
        if (import.meta.env.DEV) {
          console.debug(`[CacheLayer] MISS: ${debugKey}`);
        }
        return null;
      }

      const entry = JSON.parse(raw) as CacheEntry<T>;
      const now = Date.now();

      // TTL 过期检查
      if (entry.maxAgeMs > 0 && now - entry.timestamp > entry.maxAgeMs) {
        const removedSize = (entry as CacheEntry<unknown> & { _size?: number })._size ?? estimateBytes(raw);
        if (this.estimatedTotalBytes !== null) {
          this.estimatedTotalBytes = Math.max(0, this.estimatedTotalBytes - removedSize);
        }
        localStorage.removeItem(fullKey);
        if (import.meta.env.DEV) {
          console.debug(`[CacheLayer] EXPIRED: ${debugKey}`);
        }
        return null;
      }

      if (import.meta.env.DEV) {
        console.debug(`[CacheLayer] HIT: ${debugKey}`);
      }
      return entry;
    } catch {
      return null;
    }
  }

  /**
   * 写入缓存条目
   * - set 前自动检查总体积，超限时 LRU 淘汰最旧条目
   */
  set<T>(key: string, data: T, options?: CacheOptions): void {
    const resolvedScope = options?.scopeKey ?? '';
    const fullKey = buildKey(resolvedScope, key);
    const debugKey = formatDebugKey(resolvedScope, key);
    const maxAgeMs = options?.maxAgeMs ?? CACHE_EXPIRY_MS;
    const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

    const entry: CacheEntry<T> & { _size: number } = {
      data,
      timestamp: Date.now(),
      scopeKey: resolvedScope,
      maxAgeMs,
      _size: estimateBytes(data),
    };

    // 如果 key 已存在，先减去旧值的大小以避免重复计算
    if (this.estimatedTotalBytes !== null) {
      const existingRaw = localStorage.getItem(fullKey);
      if (existingRaw) {
        const existingSize = estimateCacheEntrySize(existingRaw);
        this.estimatedTotalBytes = Math.max(0, this.estimatedTotalBytes - existingSize);
      }
      this.estimatedTotalBytes += entry._size;
    }

    if (this.estimatedTotalBytes !== null && this.estimatedTotalBytes <= maxSizeBytes) {
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));
        if (import.meta.env.DEV) {
          console.debug(`[CacheLayer] SET: ${debugKey}`);
        }
        this.notifyUpdated(key, resolvedScope);
        return;
      } catch {
        this.estimatedTotalBytes = null;
      }
    }

    this.prune(maxSizeBytes - entry._size);

    try {
      localStorage.setItem(fullKey, JSON.stringify(entry));
      if (import.meta.env.DEV) {
        console.debug(`[CacheLayer] SET: ${debugKey}`);
      }
      this.notifyUpdated(key, resolvedScope);
    } catch {
      // 体积写入失败，尝试清理后重试
      this.prune(0);
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));
        this.notifyUpdated(key, resolvedScope);
      } catch {
        // 无法写入，忽略
      }
    }
  }

  /**
   * 失效指定 key（可指定 scopeKey，不指定则匹配所有 scope）
   */
  invalidate(key: string, scopeKey?: string): void {
    if (scopeKey !== undefined) {
      const fullKey = buildKey(scopeKey, key);
      const raw = localStorage.getItem(fullKey);
      if (raw && this.estimatedTotalBytes !== null) {
        this.estimatedTotalBytes = Math.max(0, this.estimatedTotalBytes - estimateBytes(raw));
      }
      localStorage.removeItem(fullKey);
    } else {
      const prefix = `${CACHE_PREFIX}:`;
      const suffix = `:${key}`;
      const toRemove: Array<{ fullKey: string; size: number }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i);
        if (!fullKey || !fullKey.startsWith(prefix) || !fullKey.endsWith(suffix)) continue;
        const raw = localStorage.getItem(fullKey);
        toRemove.push({ fullKey, size: raw ? estimateBytes(raw) : 0 });
      }
      if (this.estimatedTotalBytes !== null) {
        const totalRemoved = toRemove.reduce((sum, e) => sum + e.size, 0);
        this.estimatedTotalBytes = Math.max(0, this.estimatedTotalBytes - totalRemoved);
      }
      toRemove.forEach((e) => localStorage.removeItem(e.fullKey));
    }
  }

  /**
   * 失效整个 scope 域（换账号时调用）
   */
  invalidateScope(scopeKey: string): void {
    const keys = collectScopeKeys(scopeKey);
    if (keys.length > 0 && this.estimatedTotalBytes !== null) {
      let totalRemoved = 0;
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw) totalRemoved += estimateBytes(raw);
      }
      this.estimatedTotalBytes = Math.max(0, this.estimatedTotalBytes - totalRemoved);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }

  /**
   * LRU 淘汰：删除最旧的条目直到总体积降到 targetBytes 以下
   */
  prune(maxBytes?: number): void {
    const targetBytes = maxBytes ?? DEFAULT_MAX_SIZE_BYTES;

    const entries = collectAllCacheEntries();
    if (entries.length === 0) {
      this.estimatedTotalBytes = 0;
      return;
    }

    entries.sort((a, b) => a.timestamp - b.timestamp);

    let totalSize = entries.reduce((sum, e) => sum + e.size, 0);

    for (const entry of entries) {
      if (totalSize <= targetBytes) break;
      localStorage.removeItem(entry.fullKey);
      totalSize -= entry.size;
    }

    this.estimatedTotalBytes = totalSize;
  }
}

export const CacheLayer = new CacheLayerImpl();
