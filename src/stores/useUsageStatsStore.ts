import { create } from 'zustand';
import { usageApi } from '@/services/api';
import { autoPersistService } from '@/services/autoPersist';
import { useAuthStore } from '@/stores/useAuthStore';
import { CacheLayer } from '@/services/cache';
import {
  collectUsageDetails,
  computeKeyStatsFromDetails,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import i18n from '@/i18n';
import { buildScopeKey } from '@/utils/helpers';
import { getErrorMessage, isCanceledRequestError } from '@/utils/error';

export const USAGE_STATS_STALE_TIME_MS = 120_000;
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

const getUsageStatsErrorMessage = (error: unknown) =>
  getErrorMessage(error, i18n.t('usage_stats.loading_error'));

type PersistedUsageStatsCache = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  lastRefreshedAt: number | null;
  detailCount: number;
  scopeKey: string;
};

const toPersistedUsageStatsCache = (
  scopeKey: string,
  snapshot: Partial<PersistedUsageStatsCache> | null | undefined
): PersistedUsageStatsCache | null => {
  if (!snapshot) {
    return null;
  }

  return {
    usage:
      snapshot.usage && typeof snapshot.usage === 'object'
        ? (snapshot.usage as UsageStatsSnapshot)
        : null,
    keyStats:
      snapshot.keyStats && typeof snapshot.keyStats === 'object'
        ? snapshot.keyStats
        : createEmptyKeyStats(),
    usageDetails: Array.isArray(snapshot.usageDetails)
      ? (snapshot.usageDetails as UsageDetail[])
      : [],
    detailCount:
      typeof snapshot.detailCount === 'number' && Number.isFinite(snapshot.detailCount)
        ? Math.max(0, snapshot.detailCount)
        : Array.isArray(snapshot.usageDetails)
          ? snapshot.usageDetails.length
          : 0,
    lastRefreshedAt:
      typeof snapshot.lastRefreshedAt === 'number' && Number.isFinite(snapshot.lastRefreshedAt)
        ? snapshot.lastRefreshedAt
        : null,
    scopeKey,
  };
};

const createCacheStorageKey = (scopeKey: string) =>
  `${USAGE_STATS_CACHE_PREFIX}:${encodeURIComponent(scopeKey)}`;

const pickRicherUsageSnapshot = (
  primary: PersistedUsageStatsCache | null,
  secondary: PersistedUsageStatsCache | null
): PersistedUsageStatsCache | null => {
  if (!primary) return secondary;
  if (!secondary) return primary;

  if (secondary.detailCount !== primary.detailCount) {
    return secondary.detailCount > primary.detailCount ? secondary : primary;
  }

  return (secondary.lastRefreshedAt ?? 0) > (primary.lastRefreshedAt ?? 0) ? secondary : primary;
};

const hasMeaningfulUsageSnapshot = (
  snapshot: PersistedUsageStatsCache | null
): snapshot is PersistedUsageStatsCache =>
  Boolean(snapshot && (snapshot.usage !== null || snapshot.detailCount > 0));

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
      detailCount:
        typeof parsed.detailCount === 'number' && Number.isFinite(parsed.detailCount)
          ? Math.max(0, parsed.detailCount)
          : Array.isArray(parsed.usageDetails)
            ? parsed.usageDetails.length
            : 0,
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
    CacheLayer.prune();
  }

  try {
    localStorage.setItem(createCacheStorageKey(cache.scopeKey), JSON.stringify(cache));
  } catch {
    const liteCache: PersistedUsageStatsCache = {
      ...cache,
      usage: null,
      usageDetails: [],
      detailCount: 0,
    };
    try {
      localStorage.setItem(createCacheStorageKey(cache.scopeKey), JSON.stringify(liteCache));
    } catch {
      // Ignore final persistence failures.
    }
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
    const scopeKey = buildScopeKey(apiBase, managementKey);
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
    const activeAbortController = new AbortController();
    usageAbortController = activeAbortController;

    const persistedCache = readPersistedUsageStats(scopeKey);
    const rawAutoPersistCache = toPersistedUsageStatsCache(
      scopeKey,
      autoPersistService.readBootstrapSnapshot(scopeKey)
    );
    const autoPersistCache = hasMeaningfulUsageSnapshot(rawAutoPersistCache)
      ? rawAutoPersistCache
      : null;

    const cachedLastRefreshedAt = scopeChanged
      ? (autoPersistCache?.lastRefreshedAt ?? persistedCache?.lastRefreshedAt ?? null)
      : (state.lastRefreshedAt ?? autoPersistCache?.lastRefreshedAt ?? persistedCache?.lastRefreshedAt ?? null);
    const fresh = cachedLastRefreshedAt !== null && now - cachedLastRefreshedAt < staleTimeMs;

    // 只有在需要显示历史数据时才选择更丰富的缓存源，避免不必要的状态抖动
    const bootstrapCache = scopeChanged || !fresh
      ? pickRicherUsageSnapshot(persistedCache, autoPersistCache)
      : autoPersistCache ?? pickRicherUsageSnapshot(persistedCache, autoPersistCache);

    if (scopeChanged) {
      if (bootstrapCache) {
        set({
          usage: bootstrapCache.usage,
          keyStats: bootstrapCache.keyStats,
          usageDetails: bootstrapCache.usageDetails,
          error: null,
          lastRefreshedAt: bootstrapCache.lastRefreshedAt,
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
    } else if (!state.usage && bootstrapCache) {
      set({
        usage: bootstrapCache.usage,
        keyStats: bootstrapCache.keyStats,
        usageDetails: bootstrapCache.usageDetails,
        error: null,
        lastRefreshedAt: bootstrapCache.lastRefreshedAt,
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
        const usageResponse = await usageApi.getUsage({ signal: activeAbortController.signal });
        const rawUsage = usageResponse?.usage ?? usageResponse;
        const usage =
          rawUsage && typeof rawUsage === 'object' ? (rawUsage as UsageStatsSnapshot) : null;

        if (requestId !== usageRequestToken) return;

        const usageDetails = collectUsageDetails(usage);
        const keyStats = computeKeyStatsFromDetails(usageDetails);
        const lastRefreshedAt = Date.now();
        const nextSnapshot = {
          usage,
          keyStats,
          usageDetails,
          lastRefreshedAt,
          detailCount: usageDetails.length,
          scopeKey,
        };

        autoPersistService.onUsageRefreshed({
          scopeKey,
          usage,
          keyStats,
          usageDetails,
          lastRefreshedAt,
        });

        writePersistedUsageStats(nextSnapshot);

        set({
          usage: nextSnapshot.usage,
          keyStats: nextSnapshot.keyStats,
          usageDetails: nextSnapshot.usageDetails,
          loading: false,
          error: null,
          lastRefreshedAt: nextSnapshot.lastRefreshedAt,
          scopeKey,
        });
      } catch (error: unknown) {
        // Ignore AbortError — it means the request was intentionally cancelled (StrictMode or logout)
        if (isCanceledRequestError(error)) {
          return;
        }
        if (requestId !== usageRequestToken) return;
        const message = getUsageStatsErrorMessage(error);
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
        if (usageAbortController === activeAbortController) {
          usageAbortController = null;
        }
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
    autoPersistService.clearRuntimeState(scopeKey, { removePersisted: true });
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
