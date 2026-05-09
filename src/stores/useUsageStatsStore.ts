import { create } from 'zustand';
import { usageApi } from '@/services/api';
import { autoPersistService } from '@/services/autoPersist';
import { useAuthStore } from '@/stores/useAuthStore';
import { CacheLayer } from '@/services/cache';
import { usageSSEService } from '@/services/sse';
import {
  createAggregateOnlyUsageSnapshot,
  collectUsageDetails,
  collectUsageDetailsFromEvents,
  computeKeyStatsFromDetails,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import { resolveCachedUsageDetailsFromUsage } from '@/utils/usage/cacheSnapshot';
import { normalizeUsageDetailTokens } from '@/atoms/usage/tokens';
import { expireUsageFailed } from '@/molecules/usage/expireUsageFailed';
import i18n from '@/i18n';
import { buildScopeKey } from '@/utils/helpers';
import { getErrorMessage, isCanceledRequestError } from '@/utils/error';
import { parseTimestampMs } from '@/utils/timestamp';
import { logger } from '@/utils/logger';
import type {
  UsageDeltaDetailItem,
  UsageDeltaEvent,
  UsageFullEvent,
  UsageModelBreakdownItem,
  UsageSnapshotDetailItem,
} from '@/types/sse';

export const USAGE_STATS_STALE_TIME_MS = 120_000;
const USAGE_STATS_CACHE_PREFIX = 'cli-proxy-usage-stats-cache-v1';
const MAX_USAGE_DETAILS_LENGTH = 5000;
const EXPIRE_FAILED_CLEANUP_INTERVAL_MS = 3 * 60 * 60 * 1000;
const EXPIRE_FAILED_CLEANUP_IDLE_THRESHOLD_MS = 10_000;

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
  lastSeq: number | null;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  clearUsageStats: () => void;
  applyDelta: (delta: UsageDeltaEvent) => void;
  applyFullSnapshot: (snapshot: UsageFullEvent) => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

const UNKNOWN_USAGE_MODEL = 'unknown';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeStringValue = (value: unknown, fallback = ''): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
};

const normalizeUsageModelName = (value: unknown): string =>
  normalizeStringValue(value, UNKNOWN_USAGE_MODEL);

const ensureUsageDetailTokens = (details: UsageSnapshotDetailItem[]): UsageDetail[] =>
  details.map((detail) => {
    const tokens =
      detail.tokens && typeof detail.tokens === 'object'
        ? detail.tokens
        : normalizeUsageDetailTokens(detail);
    const modelName = normalizeUsageModelName(detail.__modelName ?? detail.model);
    const timestampMs =
      typeof detail.__timestampMs === 'number' && Number.isFinite(detail.__timestampMs)
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);

    return {
      ...detail,
      tokens,
      __modelName: modelName,
      __timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined,
    };
  });

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const addUsageAggregate = (currentValue: unknown, deltaValue: number): number =>
  toFiniteNumber(currentValue) + deltaValue;

const createUsageDetailFromDelta = (detail: UsageDeltaDetailItem): UsageDetail => {
  const deltaTokens = detail.tokens ?? {};
  return {
    timestamp: new Date(detail.timestamp).toISOString(),
    source: detail.source,
    auth_index: null,
    tokens: {
      input_tokens: deltaTokens.prompt ?? 0,
      output_tokens: deltaTokens.completion ?? 0,
      reasoning_tokens: deltaTokens.reasoning ?? 0,
      cached_tokens: deltaTokens.cached ?? 0,
      total_tokens: deltaTokens.total ?? 0,
    },
    failed: !detail.success,
    __modelName: normalizeUsageModelName(detail.model),
    __timestampMs: detail.timestamp,
  };
};

const createEmptyApiUsageEntry = (): Record<string, unknown> => ({
  total_requests: 0,
  success_count: 0,
  failure_count: 0,
  total_tokens: 0,
  models: {},
});

const createEmptyModelUsageEntry = (): Record<string, unknown> => ({
  total_requests: 0,
  success_count: 0,
  failure_count: 0,
  total_tokens: 0,
  details: [],
});

const cloneUsageWithApis = (usage: UsageStatsSnapshot): [UsageStatsSnapshot, Record<string, unknown>] => {
  const nextUsage = { ...usage };
  const sourceApis = isRecord(nextUsage.apis)
    ? (nextUsage.apis as Record<string, unknown>)
    : null;
  const nextApis: Record<string, unknown> = {};

  if (sourceApis) {
    Object.entries(sourceApis).forEach(([endpoint, apiEntry]) => {
      if (!isRecord(apiEntry)) {
        nextApis[endpoint] = apiEntry;
        return;
      }

      const nextApiEntry: Record<string, unknown> = { ...apiEntry };
      const sourceModels = isRecord(apiEntry.models)
        ? (apiEntry.models as Record<string, unknown>)
        : null;
      const nextModels: Record<string, unknown> = {};

      if (sourceModels) {
        Object.entries(sourceModels).forEach(([modelName, modelEntry]) => {
          nextModels[modelName] = isRecord(modelEntry)
            ? { ...(modelEntry as Record<string, unknown>) }
            : modelEntry;
        });
      }

      nextApiEntry.models = nextModels;
      nextApis[endpoint] = nextApiEntry;
    });
  }

  nextUsage.apis = nextApis;
  return [nextUsage, nextApis];
};

const mergeModelBreakdown = (
  current: UsageStatsSnapshot,
  modelBreakdown: UsageModelBreakdownItem[] | undefined
): UsageStatsSnapshot => {
  if (!Array.isArray(modelBreakdown) || modelBreakdown.length === 0) {
    return current;
  }

  const [nextUsage, nextApis] = cloneUsageWithApis(current);

  modelBreakdown.forEach((item) => {
    const endpoint = normalizeStringValue(item.endpoint, UNKNOWN_USAGE_MODEL);
    const model = normalizeUsageModelName(item.model);
    const tokenDelta = item.tokenDelta ?? { totalTokens: 0 };

    const apiEntry = isRecord(nextApis[endpoint])
      ? (nextApis[endpoint] as Record<string, unknown>)
      : createEmptyApiUsageEntry();
    if (!isRecord(nextApis[endpoint])) {
      nextApis[endpoint] = apiEntry;
    }

    const models = isRecord(apiEntry.models)
      ? (apiEntry.models as Record<string, unknown>)
      : {};
    apiEntry.models = models;

    const modelEntry = isRecord(models[model])
      ? (models[model] as Record<string, unknown>)
      : createEmptyModelUsageEntry();
    if (!isRecord(models[model])) {
      models[model] = modelEntry;
    }

    modelEntry.total_requests = addUsageAggregate(modelEntry.total_requests, item.requestCount);
    modelEntry.success_count = addUsageAggregate(modelEntry.success_count, item.successCount);
    modelEntry.failure_count = addUsageAggregate(modelEntry.failure_count, item.failureCount);
    modelEntry.total_tokens = addUsageAggregate(modelEntry.total_tokens, tokenDelta.totalTokens);

    apiEntry.total_requests = addUsageAggregate(apiEntry.total_requests, item.requestCount);
    apiEntry.success_count = addUsageAggregate(apiEntry.success_count, item.successCount);
    apiEntry.failure_count = addUsageAggregate(apiEntry.failure_count, item.failureCount);
    apiEntry.total_tokens = addUsageAggregate(apiEntry.total_tokens, tokenDelta.totalTokens);
  });

  return nextUsage;
};

const mergeUsageDelta = (
  current: UsageStatsSnapshot | null,
  delta: UsageDeltaEvent
): UsageStatsSnapshot => {
  if (!current) {
    return {
      total_requests: delta.requestCount,
      success_count: delta.successCount,
      failure_count: delta.failureCount,
      total_tokens: delta.tokenDelta.totalTokens,
      prompt_tokens: delta.tokenDelta.promptTokens,
      completion_tokens: delta.tokenDelta.completionTokens,
      reasoning_tokens: delta.tokenDelta.reasoningTokens ?? 0,
      cached_tokens: delta.tokenDelta.cachedTokens ?? 0,
    };
  }

  const merged = { ...current };
  merged.total_requests = addUsageAggregate(merged.total_requests, delta.requestCount);
  merged.success_count = addUsageAggregate(merged.success_count, delta.successCount);
  merged.failure_count = addUsageAggregate(merged.failure_count, delta.failureCount);
  merged.total_tokens = addUsageAggregate(merged.total_tokens, delta.tokenDelta.totalTokens);
  merged.prompt_tokens = addUsageAggregate(merged.prompt_tokens, delta.tokenDelta.promptTokens);
  merged.completion_tokens = addUsageAggregate(merged.completion_tokens, delta.tokenDelta.completionTokens);
  merged.reasoning_tokens = addUsageAggregate(merged.reasoning_tokens, delta.tokenDelta.reasoningTokens ?? 0);
  merged.cached_tokens = addUsageAggregate(merged.cached_tokens, delta.tokenDelta.cachedTokens ?? 0);

  return merged;
};

const resolveCachedUsageDetails = (
  usage: UsageStatsSnapshot | null,
  usageDetails: UsageDetail[] | undefined
): UsageDetail[] => resolveCachedUsageDetailsFromUsage(usage, usageDetails);

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

const createPersistableUsageStatsCache = (
  cache: PersistedUsageStatsCache
): PersistedUsageStatsCache => ({
  ...cache,
  usageDetails: resolveCachedUsageDetails(cache.usage, cache.usageDetails),
  detailCount: Math.max(cache.detailCount, cache.usageDetails.length),
});

const toPersistedUsageStatsCache = (
  scopeKey: string,
  snapshot: Partial<PersistedUsageStatsCache> | null | undefined
): PersistedUsageStatsCache | null => {
  if (!snapshot) {
    return null;
  }

  const resolvedUsage =
    snapshot.usage && typeof snapshot.usage === 'object'
      ? (snapshot.usage as UsageStatsSnapshot)
      : null;
  const resolvedUsageDetails = resolveCachedUsageDetails(
    resolvedUsage,
    snapshot.usageDetails as UsageDetail[] | undefined
  );

  return {
    usage: resolvedUsage,
    keyStats:
      snapshot.keyStats && typeof snapshot.keyStats === 'object'
        ? snapshot.keyStats
        : createEmptyKeyStats(),
    usageDetails: resolvedUsageDetails,
    detailCount:
      typeof snapshot.detailCount === 'number' && Number.isFinite(snapshot.detailCount)
        ? Math.max(0, snapshot.detailCount)
        : resolvedUsageDetails.length,
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

    const resolvedUsage =
      parsed.usage && typeof parsed.usage === 'object'
        ? (parsed.usage as UsageStatsSnapshot)
        : null;
    const resolvedUsageDetails = resolveCachedUsageDetails(
      resolvedUsage,
      parsed.usageDetails as UsageDetail[] | undefined
    );

    return {
      usage: resolvedUsage,
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
      usageDetails: resolvedUsageDetails,
      detailCount:
        typeof parsed.detailCount === 'number' && Number.isFinite(parsed.detailCount)
          ? Math.max(0, parsed.detailCount)
          : resolvedUsageDetails.length,
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

  const storageKey = createCacheStorageKey(cache.scopeKey);
  const persistableCache = createPersistableUsageStatsCache(cache);
  const serializedCache = JSON.stringify(persistableCache);

  try {
    localStorage.setItem(storageKey, serializedCache);
    return;
  } catch {
    CacheLayer.prune();
  }

  try {
    localStorage.setItem(storageKey, serializedCache);
    return;
  } catch {
    const liteCache: PersistedUsageStatsCache = {
      ...persistableCache,
      usage: persistableCache.usage
        ? createAggregateOnlyUsageSnapshot(persistableCache.usage)
        : null,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(liteCache));
      return;
    } catch {
      const ultraLiteCache: PersistedUsageStatsCache = {
        ...liteCache,
        usageDetails: [],
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(ultraLiteCache));
      } catch {
        // Ignore storage write failures after exhausting all persistence fallbacks.
      }
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

const cleanBootstrapCache = (cache: PersistedUsageStatsCache): PersistedUsageStatsCache => {
  const { usage, usageDetails, removedCount, topLevelRemovedCount } =
    expireUsageFailed(cache.usage, cache.usageDetails);
  if (removedCount === 0) return cache;

  const keyStats = computeKeyStatsFromDetails(usageDetails);
  const detailCount = Math.max(cache.detailCount - topLevelRemovedCount, usageDetails.length);
  const cleaned: PersistedUsageStatsCache = {
    ...cache,
    usage,
    keyStats,
    usageDetails,
    detailCount,
  };
  writePersistedUsageStats(cleaned);
  return cleaned;
};

let expireFailedCleanupTimerId: ReturnType<typeof setTimeout> | null = null;

const scheduleExpireFailedCleanup = () => {
  if (expireFailedCleanupTimerId !== null) return;

  const tryCleanup = () => {
    if (inFlightUsageRequest !== null) {
      expireFailedCleanupTimerId = setTimeout(tryCleanup, EXPIRE_FAILED_CLEANUP_IDLE_THRESHOLD_MS);
      return;
    }

    const state = useUsageStatsStore.getState();
    if (!state.scopeKey || state.loading) {
      expireFailedCleanupTimerId = setTimeout(tryCleanup, EXPIRE_FAILED_CLEANUP_IDLE_THRESHOLD_MS);
      return;
    }

    const cache = readPersistedUsageStats(state.scopeKey);
    if (cache && cache.usageDetails.length > 0) {
      const { usageDetails, removedCount, topLevelRemovedCount } = expireUsageFailed(
        cache.usage,
        cache.usageDetails
      );
      if (removedCount > 0) {
        const keyStats = computeKeyStatsFromDetails(usageDetails);
        const detailCount = Math.max(cache.detailCount - topLevelRemovedCount, usageDetails.length);
        writePersistedUsageStats({
          ...cache,
          usageDetails,
          keyStats,
          detailCount,
        });
      }
    }

    expireFailedCleanupTimerId = null;
    expireFailedCleanupTimerId = setTimeout(tryCleanup, EXPIRE_FAILED_CLEANUP_INTERVAL_MS);
  };

  expireFailedCleanupTimerId = setTimeout(tryCleanup, EXPIRE_FAILED_CLEANUP_INTERVAL_MS);
};

export const cancelExpireFailedCleanup = () => {
  if (expireFailedCleanupTimerId !== null) {
    clearTimeout(expireFailedCleanupTimerId);
    expireFailedCleanupTimerId = null;
  }
};

scheduleExpireFailedCleanup();

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  usage: null,
  keyStats: createEmptyKeyStats(),
  usageDetails: [],
  loading: false,
  error: null,
  lastRefreshedAt: null,
  scopeKey: '',
  lastSeq: null,

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
    const rawBootstrapCache = scopeChanged || !fresh
      ? pickRicherUsageSnapshot(persistedCache, autoPersistCache)
      : autoPersistCache ?? pickRicherUsageSnapshot(persistedCache, autoPersistCache);

    // 页面加载/数据恢复时，清理过期的失败记录
    const bootstrapCache = rawBootstrapCache ? cleanBootstrapCache(rawBootstrapCache) : null;

    if (scopeChanged) {
      if (bootstrapCache) {
        set({
          usage: bootstrapCache.usage,
          keyStats: bootstrapCache.keyStats,
          usageDetails: bootstrapCache.usageDetails,
          error: null,
          lastRefreshedAt: bootstrapCache.lastRefreshedAt,
          scopeKey,
          lastSeq: null,
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
          lastSeq: null,
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
        const [usageResponse, eventsResponse] = await Promise.all([
          usageApi.getUsage({ signal: activeAbortController.signal }),
          usageApi.getUsageEvents({ signal: activeAbortController.signal }).catch((error) => {
            if (error && isCanceledRequestError(error)) return undefined;
            logger.warn('Failed to fetch usage events', { error });
            return undefined;
          }),
        ]);

        const rawUsage = usageResponse?.usage ?? usageResponse;
        const usage =
          rawUsage && typeof rawUsage === 'object' ? (rawUsage as UsageStatsSnapshot) : null;

        if (requestId !== usageRequestToken) return;

        let usageDetails: UsageDetail[];
        if (eventsResponse && Array.isArray(eventsResponse) && eventsResponse.length > 0) {
          usageDetails = collectUsageDetailsFromEvents(eventsResponse);
        } else {
          usageDetails = collectUsageDetails(usage);
        }

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
        if (error && isCanceledRequestError(error)) {
          if (requestId === usageRequestToken) {
            set({
              loading: false,
              error: null,
              scopeKey,
            });
          }
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
      lastSeq: null,
    });
  },

  applyDelta: (delta) => {
    const state = get();
    const requestDeltaRecovery = () => {
      set({ loading: true, error: null });
      usageSSEService.requestFullCorrection();
      void get().loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {});
    };

    if (state.usage === null) {
      requestDeltaRecovery();
      return;
    }

    if (state.lastSeq !== null && delta.seq !== state.lastSeq + 1) {
      requestDeltaRecovery();
      return;
    }

    const mergedUsage = mergeModelBreakdown(
      mergeUsageDelta(state.usage, delta),
      delta.modelBreakdown
    );
    const usageDetails = [...state.usageDetails, ...delta.details.map(createUsageDetailFromDelta)];
    const trimmedDetails = usageDetails.length > MAX_USAGE_DETAILS_LENGTH
      ? usageDetails.slice(usageDetails.length - MAX_USAGE_DETAILS_LENGTH)
      : usageDetails;
    const keyStats = computeKeyStatsFromDetails(trimmedDetails);
    const receivedAt = Date.now();
    const nextSnapshot = {
      usage: mergedUsage,
      keyStats,
      usageDetails: trimmedDetails,
      lastRefreshedAt: receivedAt,
      detailCount: usageDetails.length,
      scopeKey: state.scopeKey,
    };

    autoPersistService.onUsageRefreshed({
      scopeKey: state.scopeKey,
      usage: mergedUsage,
      keyStats,
      usageDetails: trimmedDetails,
      lastRefreshedAt: receivedAt,
    });

    writePersistedUsageStats(nextSnapshot);

    set({
      usage: mergedUsage,
      usageDetails: trimmedDetails,
      keyStats,
      lastRefreshedAt: receivedAt,
      lastSeq: delta.seq,
      loading: false,
      error: null,
    });
  },

  applyFullSnapshot: (snapshot) => {
    const state = get();
    const usage = snapshot.usage as UsageStatsSnapshot;
    const usageDetails = Array.isArray(snapshot.usageDetails)
      ? ensureUsageDetailTokens(snapshot.usageDetails)
      : collectUsageDetails(usage);
    const keyStats = computeKeyStatsFromDetails(usageDetails);
    const lastRefreshedAt = Date.now();
    const nextSnapshot = {
      usage,
      keyStats,
      usageDetails,
      lastRefreshedAt,
      detailCount: usageDetails.length,
      scopeKey: state.scopeKey,
    };

    autoPersistService.onUsageRefreshed({
      scopeKey: state.scopeKey,
      usage,
      keyStats,
      usageDetails,
      lastRefreshedAt,
    });

    writePersistedUsageStats(nextSnapshot);

    set({
      usage,
      usageDetails,
      keyStats,
      lastRefreshedAt,
      lastSeq: snapshot.seq,
      loading: false,
      error: null,
    });
  },
}));
