/**
 * 模型列表状态管理（带缓存）
 */

import { create } from 'zustand';
import { modelsApi } from '@/services/api/models';
import { CACHE_EXPIRY_MS } from '@/utils/constants';
import type { ModelInfo } from '@/utils/models';

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
}

let modelsRequestToken = 0;
let inFlightModelsRequest: { id: number; apiBase: string; promise: Promise<ModelInfo[]> } | null =
  null;

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  loading: false,
  error: null,
  cache: new Map(),

  fetchModels: async (apiBase, apiKey, forceRefresh = false) => {
    const { cache, isCacheValid } = get();

    // 检查缓存：只检查当前 apiBase 的缓存条目
    if (!forceRefresh && isCacheValid(apiBase)) {
      const cached = cache.get(apiBase);
      if (cached) {
        set({ models: cached.data, error: null });
        return cached.data;
      }
    }

    // 复用同 apiBase 的 in-flight 请求，避免 StrictMode 或快速连续调用发出多个请求
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

        // Token 检查：请求期间 scope 可能已变化，结果应被忽略
        if (requestId !== modelsRequestToken) return list;

        const now = Date.now();

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
        set({
          error: message,
          loading: false,
          models: [],
        });
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
    return Date.now() - cached.timestamp < CACHE_EXPIRY_MS;
  },
}));
