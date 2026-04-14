import { create } from 'zustand';
import { usageApi } from '@/services/api';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  collectUsageDetails,
  computeKeyStatsFromDetails,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import i18n from '@/i18n';

export const USAGE_STATS_STALE_TIME_MS = 240_000;
const USAGE_STATS_CACHE_PREFIX = 'cli-proxy-usage-stats-cache-v1';

export type LoadUsageStatsOptions = {
  force?: boolean;
  staleTimeMs?: number;
};

type UsageStatsSnapshot = Record<string, unknown>;

type UsageStatsState = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  scopeKey: string;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  clearUsageStats: () => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

let usageRequestToken = 0;
let inFlightUsageRequest: { id: number; scopeKey: string; promise: Promise<void> } | null = null;
let usageAbortController: AbortController | null = null;

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : i18n.t('usage_stats.loading_error');

type PersistedUsageStatsCache = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  lastRefreshedAt: number | null;
  scopeKey: string;
};

const hashScopeSegment = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const createScopeKey = (apiBase: string, managementKey: string) =>
  `${apiBase}::${hashScopeSegment(managementKey)}`;

const createCacheStorageKey = (scopeKey: string) =>
  `${USAGE_STATS_CACHE_PREFIX}:${encodeURIComponent(scopeKey)}`;

const readPersistedUsageStats = (scopeKey: string): PersistedUsageStatsCache | null => {
  if (typeof localStorage === 'undefined' || !scopeKey) {
    return null;
  }

  try {
    const raw = localStorage.getItem(createCacheStorageKey(scopeKey));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedUsageStatsCache> | null;
    if (!parsed || parsed.scopeKey !== scopeKey) {
      return null;
    }

    return {
      usage:
        parsed.usage && typeof parsed.usage === 'object'
          ? (parsed.usage as UsageStatsSnapshot)
          : null,
      keyStats:
        parsed.keyStats && typeof parsed.keyStats === 'object'
          ? {
              bySource:
                parsed.keyStats.bySource && typeof parsed.keyStats.bySource === 'object'
                  ? parsed.keyStats.bySource
                  : {},
              byAuthIndex:
                parsed.keyStats.byAuthIndex && typeof parsed.keyStats.byAuthIndex === 'object'
                  ? parsed.keyStats.byAuthIndex
                  : {},
            }
          : createEmptyKeyStats(),
      usageDetails: Array.isArray(parsed.usageDetails)
        ? (parsed.usageDetails as UsageDetail[])
        : [],
      lastRefreshedAt:
        typeof parsed.lastRefreshedAt === 'number' && Number.isFinite(parsed.lastRefreshedAt)
          ? parsed.lastRefreshedAt
          : null,
      scopeKey,
    };
  } catch {
    return null;
  }
};

const writePersistedUsageStats = (cache: PersistedUsageStatsCache) => {
  if (typeof localStorage === 'undefined' || !cache.scopeKey) {
    return;
  }

  try {
    localStorage.setItem(createCacheStorageKey(cache.scopeKey), JSON.stringify(cache));
  } catch {
    // Ignore persistence failures and fall back to in-memory cache only.
  }
};

const removePersistedUsageStats = (scopeKey: string) => {
  if (typeof localStorage === 'undefined' || !scopeKey) {
    return;
  }

  try {
    localStorage.removeItem(createCacheStorageKey(scopeKey));
  } catch {
    // Ignore storage cleanup failures.
  }
};

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  usage: null,
  keyStats: createEmptyKeyStats(),
  usageDetails: [],
  loading: false,
  error: null,
  lastRefreshedAt: null,
  scopeKey: '',

  loadUsageStats: async (options = {}) => {
    const force = options.force === true;
    const staleTimeMs = options.staleTimeMs ?? USAGE_STATS_STALE_TIME_MS;
    const { apiBase = '', managementKey = '' } = useAuthStore.getState();
    const scopeKey = createScopeKey(apiBase, managementKey);
    const state = get();
    const scopeChanged = state.scopeKey !== scopeKey;
    const now = Date.now();

    // 先复用同源 in-flight 请求，避免多个页面同时发起重复 /usage。
    if (inFlightUsageRequest && inFlightUsageRequest.scopeKey === scopeKey) {
      await inFlightUsageRequest.promise;
      return;
    }

    // 连接目标变化时，旧请求结果必须失效。Abort 旧请求以释放资源。
    if (inFlightUsageRequest && inFlightUsageRequest.scopeKey !== scopeKey) {
      usageRequestToken += 1;
      inFlightUsageRequest = null;
      if (usageAbortController) {
        usageAbortController.abort();
        usageAbortController = null;
      }
    }

    // Abort any previous in-flight request before starting a new one (StrictMode protection)
    if (usageAbortController) {
      usageAbortController.abort();
      usageAbortController = null;
    }
    usageAbortController = new AbortController();

    const persistedCache = readPersistedUsageStats(scopeKey);
    const cachedLastRefreshedAt = scopeChanged
      ? (persistedCache?.lastRefreshedAt ?? null)
      : (state.lastRefreshedAt ?? persistedCache?.lastRefreshedAt ?? null);
    const fresh = cachedLastRefreshedAt !== null && now - cachedLastRefreshedAt < staleTimeMs;

    if (scopeChanged) {
      if (persistedCache) {
        set({
          usage: persistedCache.usage,
          keyStats: persistedCache.keyStats,
          usageDetails: persistedCache.usageDetails,
          error: null,
          lastRefreshedAt: persistedCache.lastRefreshedAt,
          scopeKey,
          loading: false,
        });
      } else {
        set({
          usage: null,
          keyStats: createEmptyKeyStats(),
          usageDetails: [],
          error: null,
          lastRefreshedAt: null,
          scopeKey,
          loading: false,
        });
      }
    } else if (!state.usage && persistedCache) {
      set({
        usage: persistedCache.usage,
        keyStats: persistedCache.keyStats,
        usageDetails: persistedCache.usageDetails,
        error: null,
        lastRefreshedAt: persistedCache.lastRefreshedAt,
        scopeKey,
        loading: false,
      });
    }

    if (!force && fresh) {
      return;
    }

    const requestId = (usageRequestToken += 1);
    set({ loading: true, error: null, scopeKey });

    const requestPromise = (async () => {
      try {
        const usageResponse = await usageApi.getUsage();
        const rawUsage = usageResponse?.usage ?? usageResponse;
        const usage =
          rawUsage && typeof rawUsage === 'object' ? (rawUsage as UsageStatsSnapshot) : null;

        if (requestId !== usageRequestToken) return;

        const usageDetails = collectUsageDetails(usage);
        const keyStats = computeKeyStatsFromDetails(usageDetails);
        const lastRefreshedAt = Date.now();

        writePersistedUsageStats({
          usage,
          keyStats,
          usageDetails,
          lastRefreshedAt,
          scopeKey,
        });

        set({
          usage,
          keyStats,
          usageDetails,
          loading: false,
          error: null,
          lastRefreshedAt,
          scopeKey,
        });
      } catch (error: unknown) {
        // Ignore AbortError — it means the request was intentionally cancelled (StrictMode or logout)
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        if (requestId !== usageRequestToken) return;
        const message = getErrorMessage(error);
        set({
          loading: false,
          error: message,
          scopeKey,
        });
        throw new Error(message);
      } finally {
        if (inFlightUsageRequest?.id === requestId) {
          inFlightUsageRequest = null;
        }
        usageAbortController = null;
      }
    })();

    inFlightUsageRequest = { id: requestId, scopeKey, promise: requestPromise };
    await requestPromise;
  },

  clearUsageStats: () => {
    const { scopeKey } = get();
    usageRequestToken += 1;
    inFlightUsageRequest = null;
    if (usageAbortController) {
      usageAbortController.abort();
      usageAbortController = null;
    }
    removePersistedUsageStats(scopeKey);
    set({
      usage: null,
      keyStats: createEmptyKeyStats(),
      usageDetails: [],
      loading: false,
      error: null,
      lastRefreshedAt: null,
      scopeKey: '',
    });
  },
}));
