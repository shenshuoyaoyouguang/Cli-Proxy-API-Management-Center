/**
 * 模型列表状态管理（带缓存和持久化）
 */

import { create } from 'zustand';
import { modelsApi } from '@/services/api/models';
import { CacheLayer } from '@/services/cache';
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
  isCacheValid: (apiBase: string) => boolean;
  restoreFromPersistence: (apiBase: string) => ModelInfo[] | null;
}

let modelsRequestToken = 0;
let inFlightModelsRequest: { id: number; apiBase: string; promise: Promise<ModelInfo[]> } | null =
  null;

// 5分钟缓存，模型列表相对稳定
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  loading: false,
  error: null,
  cache: new Map(),

  restoreFromPersistence: (apiBase) => {
    const { apiBase: authBase, managementKey } = useAuthStore.getState();
    if (!authBase || !managementKey) return null;

    const scopeKey = `${authBase}::${managementKey}`;
    const entry = CacheLayer.get<ModelInfo[]>('models', scopeKey);
    if (entry) {
      const cached = entry.data;
      const cacheEntry: ModelsCache = { data: cached, timestamp: Date.now(), apiBase };
      set((state) => {
        const nextCache = new Map(state.cache);
        nextCache.set(apiBase, cacheEntry);
        return { models: cached, error: null };
      });
      return cached;
    }
    return null;
  },

  fetchModels: async (apiBase, apiKey, forceRefresh = false) => {
    const { cache, isCacheValid } = get();

    // 检查内存缓存
    if (!forceRefresh && isCacheValid(apiBase)) {
      const cached = cache.get(apiBase);
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

    // 复用同 apiBase 的 in-flight 请求
    if (inFlightModelsRequest && inFlightModelsRequest.apiBase === apiBase) {
      const list = await inFlightModelsRequest.promise;
      return list;
    }

    // apiBase 变化时，让旧请求失效
    if (inFlightModelsRequest && inFlightModelsRequest.apiBase !== apiBase) {
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
        const { apiBase: authBase, managementKey } = useAuthStore.getState();
        if (authBase && managementKey) {
          const scopeKey = `${authBase}::${managementKey}`;
          CacheLayer.set('models', list, { scopeKey, maxAgeMs: MODELS_CACHE_TTL_MS });
        }

        set((state) => {
          const nextCache = new Map(state.cache);
          nextCache.set(apiBase, { data: list, timestamp: now, apiBase });
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

    inFlightModelsRequest = { id: requestId, apiBase, promise: requestPromise };
    return requestPromise;
  },

  clearCache: (apiBase) => {
    modelsRequestToken += 1;
    inFlightModelsRequest = null;
    set((state) => {
      if (apiBase !== undefined) {
        const nextCache = new Map(state.cache);
        nextCache.delete(apiBase);
        return { cache: nextCache };
      }
      return { cache: new Map(), models: [] };
    });
  },

  isCacheValid: (apiBase) => {
    const { cache } = get();
    const cached = cache.get(apiBase);
    if (!cached) return false;
    return Date.now() - cached.timestamp < MODELS_CACHE_TTL_MS;
  },
}));
