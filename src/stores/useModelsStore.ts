/**
 * 模型列表状态管理（带缓存和持久化）
 */

import { create } from 'zustand';
import { modelsApi } from '@/services/api/models';
import { CacheLayer } from '@/services/cache';
import { buildScopeKey } from '@/utils/helpers';
import type { ModelInfo } from '@/utils/models';
import { useAuthStore } from './useAuthStore';

interface ModelsCache {
  data: ModelInfo[];
  timestamp: number;
  apiBase: string;
}

interface ModelsState {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  cache: Map<string, ModelsCache>;

  fetchModels: (apiBase: string, apiKey?: string, forceRefresh?: boolean) => Promise<ModelInfo[]>;
  clearCache: (apiBase?: string) => void;
  isCacheValid: (cacheKey: string) => boolean;
  restoreFromPersistence: (apiBase: string) => ModelInfo[] | null;
}

let modelsRequestToken = 0;
let inFlightModelsRequest: { id: number; cacheKey: string; promise: Promise<ModelInfo[]> } | null =
  null;

// 5分钟缓存，模型列表相对稳定
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

const isValidModelInfo = (item: unknown): item is ModelInfo => {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return typeof obj.name === 'string' && obj.name.trim() !== '';
};

const normalizeModelInfoArray = (data: unknown): ModelInfo[] => {
  if (!Array.isArray(data)) return [];
  return data.filter(isValidModelInfo);
};

const resolveModelsScopeKey = (apiBase: string): string => {
  const { apiBase: authBase, managementKey } = useAuthStore.getState();
  if (!authBase || !managementKey || authBase !== apiBase) {
    return '';
  }
  return buildScopeKey(authBase, managementKey);
};

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  loading: false,
  error: null,
  cache: new Map(),

  restoreFromPersistence: (apiBase) => {
    const scopeKey = resolveModelsScopeKey(apiBase);
    if (!scopeKey) return null;

    const entry = CacheLayer.get<unknown>('models', scopeKey);
    if (entry) {
      const cached = normalizeModelInfoArray(entry.data);
      if (cached.length === 0) return null;
      const cacheEntry: ModelsCache = { data: cached, timestamp: Date.now(), apiBase };
      set((state) => {
        const nextCache = new Map(state.cache);
        nextCache.set(scopeKey, cacheEntry);
        return { models: cached, error: null, cache: nextCache };
      });
      return cached;
    }
    return null;
  },

  fetchModels: async (apiBase, apiKey, forceRefresh = false) => {
    const scopeKey = resolveModelsScopeKey(apiBase);
    const cacheKey = scopeKey || apiBase;
    const { cache, isCacheValid } = get();

    // 检查内存缓存
    if (!forceRefresh && isCacheValid(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (cached) {
        set({ models: cached.data, error: null });
        return cached.data;
      }
    }

    // 尝试从持久化缓存恢复
    if (!forceRefresh) {
      const persisted = get().restoreFromPersistence(apiBase);
      if (persisted) {
        return persisted;
      }
    }

    // 复用同 scope 的 in-flight 请求
    if (inFlightModelsRequest && inFlightModelsRequest.cacheKey === cacheKey) {
      const list = await inFlightModelsRequest.promise;
      return list;
    }

    // scope 变化时，让旧请求失效
    if (inFlightModelsRequest && inFlightModelsRequest.cacheKey !== cacheKey) {
      modelsRequestToken += 1;
      inFlightModelsRequest = null;
    }

    set({ loading: true, error: null });

    const requestId = (modelsRequestToken += 1);

    const requestPromise = (async () => {
      try {
        const list = await modelsApi.fetchModels(apiBase, apiKey);

        if (requestId !== modelsRequestToken) return list;

        const now = Date.now();

        // 持久化到 CacheLayer
        if (scopeKey) {
          CacheLayer.set('models', list, { scopeKey, maxAgeMs: MODELS_CACHE_TTL_MS });
        }

        set((state) => {
          const nextCache = new Map(state.cache);
          nextCache.set(cacheKey, { data: list, timestamp: now, apiBase });
          return { models: list, loading: false, cache: nextCache };
        });

        return list;
      } catch (error: unknown) {
        if (requestId !== modelsRequestToken) return [];
        const message =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Failed to fetch models';
        set({ error: message, loading: false, models: [] });
        throw error;
      } finally {
        if (inFlightModelsRequest?.id === requestId) {
          inFlightModelsRequest = null;
        }
      }
    })();

    inFlightModelsRequest = { id: requestId, cacheKey, promise: requestPromise };
    return requestPromise;
  },

  clearCache: (apiBase) => {
    modelsRequestToken += 1;
    inFlightModelsRequest = null;
    set((state) => {
      if (apiBase !== undefined) {
        const nextCache = new Map(state.cache);
        Array.from(nextCache.entries()).forEach(([key, entry]) => {
          if (entry.apiBase === apiBase) {
            nextCache.delete(key);
          }
        });
        return { cache: nextCache };
      }
      return { cache: new Map(), models: [] };
    });
  },

  isCacheValid: (cacheKey) => {
    const { cache } = get();
    const cached = cache.get(cacheKey);
    if (!cached) return false;
    return Date.now() - cached.timestamp < MODELS_CACHE_TTL_MS;
  },
}));
