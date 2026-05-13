/**
 * 配置状态管理
 * 从原项目 src/core/config-service.js 迁移
 */

import { create } from 'zustand';
import type { Config } from '@/types';
import type { RawConfigSection } from '@/types/config';
import { configApi } from '@/services/api/config';
import { normalizeConfigResponse } from '@/services/api/transformers';
import { CACHE_EXPIRY_MS } from '@/utils/constants';
import { CacheLayer } from '@/services/cache';
import { getErrorMessage, isCanceledRequestError } from '@/utils/error';

type ConfigSectionMeta = {
  key: keyof Config;
  validator: (value: unknown) => boolean;
};

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isQuotaExceededConfig = (value: unknown): value is Config['quotaExceeded'] =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isGeminiKeyConfigArray = (value: unknown): value is Config['geminiApiKeys'] =>
  Array.isArray(value);
const isProviderKeyConfigArray = (value: unknown): value is Config['codexApiKeys'] =>
  Array.isArray(value);
const isOpenAIProviderConfigArray = (value: unknown): value is Config['openaiCompatibility'] =>
  Array.isArray(value);
const isAmpcodeConfig = (value: unknown): value is Config['ampcode'] =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isOauthExcludedModels = (value: unknown): value is Config['oauthExcludedModels'] =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const CONFIG_SECTION_META: Record<string, ConfigSectionMeta> = {
  'debug': { key: 'debug', validator: isBoolean },
  'proxy-url': { key: 'proxyUrl', validator: isString },
  'request-retry': { key: 'requestRetry', validator: isNumber },
  'quota-exceeded': { key: 'quotaExceeded', validator: isQuotaExceededConfig },
  'usage-statistics-enabled': { key: 'usageStatisticsEnabled', validator: isBoolean },
  'request-log': { key: 'requestLog', validator: isBoolean },
  'logging-to-file': { key: 'loggingToFile', validator: isBoolean },
  'logs-max-total-size-mb': { key: 'logsMaxTotalSizeMb', validator: isNumber },
  'ws-auth': { key: 'wsAuth', validator: isBoolean },
  'force-model-prefix': { key: 'forceModelPrefix', validator: isBoolean },
  'routing/strategy': { key: 'routingStrategy', validator: isString },
  'api-keys': { key: 'apiKeys', validator: isStringArray },
  'ampcode': { key: 'ampcode', validator: isAmpcodeConfig },
  'gemini-api-key': { key: 'geminiApiKeys', validator: isGeminiKeyConfigArray },
  'codex-api-key': { key: 'codexApiKeys', validator: isProviderKeyConfigArray },
  'claude-api-key': { key: 'claudeApiKeys', validator: isProviderKeyConfigArray },
  'vertex-api-key': { key: 'vertexApiKeys', validator: isProviderKeyConfigArray },
  'openai-compatibility': { key: 'openaiCompatibility', validator: isOpenAIProviderConfigArray },
  'oauth-excluded-models': { key: 'oauthExcludedModels', validator: isOauthExcludedModels },
};

const SECTION_KEYS = Object.keys(CONFIG_SECTION_META) as RawConfigSection[];

interface ConfigCache {
  data: unknown;
  timestamp: number;
}

interface ConfigState {
  config: Config | null;
  cache: Map<string, ConfigCache>;
  loading: boolean;
  error: string | null;

  fetchConfig: {
    (section?: undefined, forceRefresh?: boolean, scopeKey?: string): Promise<Config>;
    (section: RawConfigSection, forceRefresh?: boolean, scopeKey?: string): Promise<unknown>;
  };
  updateConfigValue: (section: RawConfigSection, value: unknown) => void;
  clearCache: (section?: RawConfigSection) => void;
  isCacheValid: (section?: RawConfigSection) => boolean;
  restoreFromPersistence: (scopeKey: string) => void;
}

let configRequestToken = 0;
let inFlightConfigRequest: { id: number; promise: Promise<Config> } | null = null;
let configAbortController: AbortController | null = null;

const extractSectionValue = (config: Config | null, section?: RawConfigSection) => {
  if (!config) return undefined;

  const meta = section ? CONFIG_SECTION_META[section] : undefined;
  if (meta) {
    return config[meta.key];
  }

  if (!section) return undefined;
  return config.raw?.[section];
};

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  cache: new Map(),
  loading: false,
  error: null,

  fetchConfig: (async (section?: RawConfigSection, forceRefresh: boolean = false, scopeKey?: string) => {
    const { cache, isCacheValid } = get();

    // 检查缓存
    const cacheKey = section || '__full__';
    if (!forceRefresh && isCacheValid(section)) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached.data;
      }
    }

    // section 缓存未命中但 full 缓存可用时，直接复用已获取到的配置，避免重复 /config 请求
    if (!forceRefresh && section && isCacheValid()) {
      const fullCached = cache.get('__full__');
      if (fullCached?.data) {
        return extractSectionValue(fullCached.data as Config, section);
      }
    }

    // 同一时刻合并多个 /config 请求（如 StrictMode 或多个页面同时触发）
    if (inFlightConfigRequest) {
      const data = await inFlightConfigRequest.promise;
      return section ? extractSectionValue(data, section) : data;
    }

    // Abort any previous in-flight request before starting a new one
    if (configAbortController) {
      configAbortController.abort();
      configAbortController = null;
    }
    const activeAbortController = new AbortController();
    configAbortController = activeAbortController;

    // 获取新数据
    set({ loading: true, error: null });

    const requestId = (configRequestToken += 1);
    try {
      const requestPromise = configApi.getConfig({ signal: activeAbortController.signal });
      inFlightConfigRequest = { id: requestId, promise: requestPromise };
      const data = await requestPromise;
      const now = Date.now();

      // 如果在请求过程中连接已被切换/登出，则忽略旧请求的结果，避免覆盖新会话的状态
      if (requestId !== configRequestToken) {
        return section ? extractSectionValue(data, section) : data;
      }

      // 更新缓存
      const newCache = new Map(cache);
      newCache.set('__full__', { data, timestamp: now });
      SECTION_KEYS.forEach((key) => {
        const value = extractSectionValue(data, key);
        if (value !== undefined) {
          newCache.set(key, { data: value, timestamp: now });
        }
      });

      // 持久化到 CacheLayer
      if (scopeKey) {
        CacheLayer.set('config', data, { scopeKey, maxAgeMs: CACHE_EXPIRY_MS });
      }

      set({
        config: data,
        cache: newCache,
        loading: false,
      });

      return section ? extractSectionValue(data, section) : data;
    } catch (error: unknown) {
      // Ignore AbortError — it means the request was intentionally cancelled (e.g., StrictMode double-invoke or logout)
      if (error && isCanceledRequestError(error)) {
        return section
          ? get().config
            ? extractSectionValue(get().config, section)
            : undefined
          : (get().config ?? ({} as Config));
      }
      const message = getErrorMessage(error, 'Failed to fetch config');
      if (requestId === configRequestToken) {
        set({
          error: message || 'Failed to fetch config',
          loading: false,
        });
      }
      throw error;
    } finally {
      if (inFlightConfigRequest?.id === requestId) {
        inFlightConfigRequest = null;
      }
      if (configAbortController === activeAbortController) {
        configAbortController = null;
      }
    }
  }) as ConfigState['fetchConfig'],

  updateConfigValue: (section, value) => {
    set((state) => {
      const raw = { ...(state.config?.raw || {}) };
      raw[section] = value;
      const nextConfig: Config = { ...(state.config || {}), raw };

      const meta = CONFIG_SECTION_META[section];
      if (meta && meta.validator(value)) {
        (nextConfig[meta.key] as unknown) = value;
      }

      return { config: nextConfig };
    });

    get().clearCache(section);
  },

  clearCache: (section) => {
    const { cache } = get();
    const newCache = new Map(cache);

    if (section) {
      newCache.delete(section);
      // 同时清除完整配置缓存
      newCache.delete('__full__');

      // Section-level invalidation usually follows an optimistic write path. Invalidate any in-flight
      // full fetch so stale responses can't overwrite newer local changes.
      configRequestToken += 1;
      inFlightConfigRequest = null;
      if (configAbortController) {
        configAbortController.abort();
        configAbortController = null;
      }

      set({ cache: newCache, loading: false, error: null });
      return;
    } else {
      newCache.clear();
    }

    // 清除全部缓存一般代表”切换连接/登出/全量刷新”，需要让 in-flight 的旧请求失效
    configRequestToken += 1;
    inFlightConfigRequest = null;
    if (configAbortController) {
      configAbortController.abort();
      configAbortController = null;
    }

    set({ config: null, cache: newCache, loading: false, error: null });
  },

  isCacheValid: (section) => {
    const { cache } = get();
    const cacheKey = section || '__full__';
    const cached = cache.get(cacheKey);

    if (!cached) return false;

    return Date.now() - cached.timestamp < CACHE_EXPIRY_MS;
  },

  restoreFromPersistence: (scopeKey: string) => {
    if (!scopeKey) return;

    const entry = CacheLayer.get<unknown>('config', scopeKey);
    if (!entry) return;

    const data = normalizeConfigResponse(entry.data);
    const now = Date.now();
    const newCache = new Map<string, ConfigCache>();

    newCache.set('__full__', { data, timestamp: now });
    SECTION_KEYS.forEach((key) => {
      const value = extractSectionValue(data, key);
      if (value !== undefined) {
        newCache.set(key, { data: value, timestamp: now });
      }
    });

    set({ config: data, cache: newCache, loading: false, error: null });
  },
}));
