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

/** 解析 cache:${scopeKey}:${key} 格式的 key，还原 scopeKey 和 dataKey */
function parseFullKey(fullKey: string): { scopeKey: string; dataKey: string } | null {
  const prefix = CACHE_PREFIX + ':';
  if (!fullKey.startsWith(prefix)) return null;
  const remainder = fullKey.slice(prefix.length);
  const firstColon = remainder.indexOf(':');
  if (firstColon === -1) return null;
  return {
    scopeKey: remainder.slice(0, firstColon),
    dataKey: remainder.slice(firstColon + 1),
  };
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
  /**
   * 读取缓存条目
   * - 自动检查 TTL 是否过期，过期返回 null
   */
  get<T>(key: string, scopeKey?: string): CacheEntry<T> | null {
    const resolvedScope = scopeKey ?? '';
    const fullKey = buildKey(resolvedScope, key);

    try {
      const raw = localStorage.getItem(fullKey);
      if (!raw) return null;

      const entry = JSON.parse(raw) as CacheEntry<T>;
      const now = Date.now();

      // TTL 过期检查
      if (entry.maxAgeMs > 0 && now - entry.timestamp > entry.maxAgeMs) {
        localStorage.removeItem(fullKey);
        return null;
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
    const maxAgeMs = options?.maxAgeMs ?? CACHE_EXPIRY_MS;
    const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

    const entry: CacheEntry<T> & { _size: number } = {
      data,
      timestamp: Date.now(),
      scopeKey: resolvedScope,
      maxAgeMs,
      _size: estimateBytes(data),
    };

    // 写入前检查体积（允许本次写入量后再淘汰）
    this.prune(maxSizeBytes - entry._size);

    try {
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch {
      // 体积写入失败，尝试清理后重试
      this.prune(0);
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));
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
      localStorage.removeItem(buildKey(scopeKey, key));
    } else {
      // 全局匹配：遍历所有缓存 key，删除 dataKey 匹配的条目
      const prefix = `${CACHE_PREFIX}:`;
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i);
        if (!fullKey || !fullKey.startsWith(prefix)) continue;
        const parsed = parseFullKey(fullKey);
        if (parsed && parsed.dataKey === key) {
          toRemove.push(fullKey);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    }
  }

  /**
   * 失效整个 scope 域（换账号时调用）
   */
  invalidateScope(scopeKey: string): void {
    collectScopeKeys(scopeKey).forEach((k) => localStorage.removeItem(k));
  }

  /**
   * LRU 淘汰：删除最旧的条目直到总体积降到 targetBytes 以下
   */
  prune(maxBytes?: number): void {
    const targetBytes = maxBytes ?? DEFAULT_MAX_SIZE_BYTES;

    let entries = collectAllCacheEntries();
    if (entries.length === 0) return;

    // 按时间从旧到新排序（LRU）
    entries.sort((a, b) => a.timestamp - b.timestamp);

    let totalSize = entries.reduce((sum, e) => sum + e.size, 0);

    for (const entry of entries) {
      if (totalSize <= targetBytes) break;
      localStorage.removeItem(entry.fullKey);
      totalSize -= entry.size;
    }
  }
}

export const CacheLayer = new CacheLayerImpl();
