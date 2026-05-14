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
  mergeKeyStatsIncremental,
  subtractKeyStatsForDetails,
  normalizeAuthIndex,
  normalizeUsageSourceId,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import { resolveCachedUsageDetailsFromUsage } from '@/utils/usage/cacheSnapshot';
import { normalizeUsageDetailTokens } from '@/atoms/usage/tokens';
import { expireUsageFailed } from '@/molecules/usage/expireUsageFailed';
import i18n from '@/i18n';
import { buildScopeKey } from '@/utils/helpers';
import { getApiErrorStatus, getErrorMessage, isCanceledRequestError } from '@/utils/error';
import { parseTimestampMs } from '@/utils/timestamp';
import { logger } from '@/utils/logger';
import type { UsageEvent } from '@/services/api/usage';
import type {
  UsageDeltaDetailItem,
  UsageDeltaEvent,
  UsageFullEvent,
  UsageModelBreakdownItem,
  UsageSnapshotDetailItem,
} from '@/types/sse';

export const USAGE_STATS_STALE_TIME_MS = 120_000;
const USAGE_STATS_CACHE_PREFIX = 'cli-proxy-usage-stats-cache-v1';
const MAX_USAGE_DETAILS_LENGTH = 500_000;
const EXPIRE_FAILED_CLEANUP_INTERVAL_MS = 3 * 60 * 60 * 1000;
const EXPIRE_FAILED_CLEANUP_IDLE_THRESHOLD_MS = 10_000;

export type LoadUsageStatsOptions = {
  force?: boolean;
  staleTimeMs?: number;
};

type UsageStatsSnapshot = Record<string, unknown>;

export type DataQualityWarning = {
  message: string;
  zeroedCount: number;
};

type UsageStatsState = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  scopeKey: string;
  lastSeq: number | null;
  dataQualityWarning: DataQualityWarning | null;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  clearUsageStats: () => void;
  applyDelta: (delta: UsageDeltaEvent) => void;
  applyFullSnapshot: (snapshot: UsageFullEvent) => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

const pendingDeltas: UsageDeltaEvent[] = [];

const UNKNOWN_USAGE_MODEL = 'unknown';
const UNKNOWN_USAGE_ENDPOINT = 'unknown';

type UsageBootstrapResult = {
  usage: UsageStatsSnapshot | null;
  usageDetails: UsageDetail[];
  lastSeq: number | null;
};

type CompatibilityUsageDetailEntry = {
  endpoint: string;
  modelName: string;
  usageDetail: UsageDetail;
  nestedDetail: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeStringValue = (value: unknown, fallback = ''): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
};

const normalizeUsageModelName = (value: unknown): string =>
  normalizeStringValue(value, UNKNOWN_USAGE_MODEL);

let nonFiniteValueCount = 0;
const NON_FINITE_WARNING_THRESHOLD = 1;

export const getAndResetNonFiniteCount = (): number => {
  const count = nonFiniteValueCount;
  nonFiniteValueCount = 0;
  return count;
};

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    nonFiniteValueCount += 1;
    logger.warn('[toFiniteNumber] 非有限数值，已归零', {
      originalValue: value,
      totalZeroedCount: nonFiniteValueCount,
    });
    return 0;
  }
  return parsed;
};

const checkDataQualityWarning = (): DataQualityWarning | null => {
  const count = getAndResetNonFiniteCount();
  if (count >= NON_FINITE_WARNING_THRESHOLD) {
    return {
      message: `本次数据加载中，有 ${count} 个非有限数值（NaN/Infinity）被归零处理，统计数据可能不准确。`,
      zeroedCount: count,
    };
  }
  return null;
};

const addUsageAggregate = (currentValue: unknown, deltaValue: number): number => {
  const result = toFiniteNumber(currentValue) + deltaValue;
  if (result > Number.MAX_SAFE_INTEGER) {
    logger.warn('[addUsageAggregate] 累加结果超过安全整数上限，已锁定:', {
      currentValue,
      deltaValue,
      result,
    });
    return Number.MAX_SAFE_INTEGER;
  }
  return result;
};

const safeAdd = (a: number, b: number): number => {
  const result = a + b;
  if (result > Number.MAX_SAFE_INTEGER) {
    logger.warn('[safeAdd] 累加结果超过安全整数上限，已锁定:', { a, b, result });
    return Number.MAX_SAFE_INTEGER;
  }
  return result;
};

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

const cloneUsageWithApis = (
  usage: UsageStatsSnapshot
): [UsageStatsSnapshot, Record<string, unknown>] => {
  const nextUsage = { ...usage };
  const sourceApis = isRecord(nextUsage.apis) ? (nextUsage.apis as Record<string, unknown>) : null;
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

    const models = isRecord(apiEntry.models) ? (apiEntry.models as Record<string, unknown>) : {};
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
      apis: {},
    };
  }

  const merged = { ...current };
  merged.total_requests = addUsageAggregate(merged.total_requests, delta.requestCount);
  merged.success_count = addUsageAggregate(merged.success_count, delta.successCount);
  merged.failure_count = addUsageAggregate(merged.failure_count, delta.failureCount);
  merged.total_tokens = addUsageAggregate(merged.total_tokens, delta.tokenDelta.totalTokens);
  merged.prompt_tokens = addUsageAggregate(merged.prompt_tokens, delta.tokenDelta.promptTokens);
  merged.completion_tokens = addUsageAggregate(
    merged.completion_tokens,
    delta.tokenDelta.completionTokens
  );
  merged.reasoning_tokens = addUsageAggregate(
    merged.reasoning_tokens,
    delta.tokenDelta.reasoningTokens ?? 0
  );
  merged.cached_tokens = addUsageAggregate(
    merged.cached_tokens,
    delta.tokenDelta.cachedTokens ?? 0
  );

  return merged;
};

const getUsageEventAggregateTokens = (value: unknown): number =>
  normalizeUsageDetailTokens(value).total_tokens;

const trimUsageDetails = (usageDetails: UsageDetail[]): UsageDetail[] =>
  usageDetails.length > MAX_USAGE_DETAILS_LENGTH
    ? usageDetails.slice(usageDetails.length - MAX_USAGE_DETAILS_LENGTH)
    : usageDetails;

const buildCompatibilityUsageDetailEntries = (
  details: Array<UsageSnapshotDetailItem | UsageEvent> | undefined
): CompatibilityUsageDetailEntry[] => {
  if (!Array.isArray(details) || details.length === 0) {
    return [];
  }

  const entries: CompatibilityUsageDetailEntry[] = [];

  details.forEach((detail) => {
    if (!isRecord(detail)) {
      return;
    }

    const timestampValue = detail.timestamp;
    let timestamp: string;
    let timestampMs: number;

    if (typeof timestampValue === 'number') {
      timestampMs = timestampValue;
      timestamp = new Date(timestampValue).toISOString();
    } else if (typeof timestampValue === 'string') {
      timestamp = timestampValue;
      timestampMs = parseTimestampMs(timestampValue);
    } else {
      return;
    }

    const tokens = normalizeUsageDetailTokens(detail.tokens ?? detail.usage ?? detail);
    const modelName = normalizeUsageModelName(detail.__modelName ?? detail.model);
    const endpoint = normalizeStringValue(detail.endpoint, UNKNOWN_USAGE_ENDPOINT);
    const usageDetail: UsageDetail = {
      timestamp,
      source: normalizeUsageSourceId(detail.source),
      auth_index: normalizeAuthIndex(detail.auth_index),
      tokens,
      failed: detail.failed === true,
      __modelName: modelName,
      __timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined,
    };

    entries.push({
      endpoint,
      modelName,
      usageDetail,
      nestedDetail: {
        timestamp,
        source: usageDetail.source,
        auth_index: usageDetail.auth_index,
        tokens,
        failed: usageDetail.failed,
      },
    });
  });

  return entries;
};

const buildUsageSnapshotFromCompatibilityEntries = (
  entries: CompatibilityUsageDetailEntry[]
): UsageStatsSnapshot | null => {
  if (entries.length === 0) {
    return null;
  }

  const apis: Record<string, Record<string, unknown>> = {};
  let totalRequests = 0;
  let successCount = 0;
  let failureCount = 0;
  let totalTokens = 0;

  entries.forEach((entry) => {
    const apiEntry = isRecord(apis[entry.endpoint])
      ? (apis[entry.endpoint] as Record<string, unknown>)
      : createEmptyApiUsageEntry();
    if (!isRecord(apis[entry.endpoint])) {
      apis[entry.endpoint] = apiEntry;
    }

    const models = isRecord(apiEntry.models) ? (apiEntry.models as Record<string, unknown>) : {};
    apiEntry.models = models;

    const modelEntry = isRecord(models[entry.modelName])
      ? (models[entry.modelName] as Record<string, unknown>)
      : createEmptyModelUsageEntry();
    if (!isRecord(models[entry.modelName])) {
      models[entry.modelName] = modelEntry;
    }

    const detailTokens = entry.usageDetail.tokens.total_tokens;
    const successDelta = entry.usageDetail.failed ? 0 : 1;
    const failureDelta = entry.usageDetail.failed ? 1 : 0;
    const details = Array.isArray(modelEntry.details) ? [...modelEntry.details] : [];
    details.push(entry.nestedDetail);
    modelEntry.details = details;
    modelEntry.total_requests = addUsageAggregate(modelEntry.total_requests, 1);
    modelEntry.success_count = addUsageAggregate(modelEntry.success_count, successDelta);
    modelEntry.failure_count = addUsageAggregate(modelEntry.failure_count, failureDelta);
    modelEntry.total_tokens = addUsageAggregate(modelEntry.total_tokens, detailTokens);

    apiEntry.total_requests = addUsageAggregate(apiEntry.total_requests, 1);
    apiEntry.success_count = addUsageAggregate(apiEntry.success_count, successDelta);
    apiEntry.failure_count = addUsageAggregate(apiEntry.failure_count, failureDelta);
    apiEntry.total_tokens = addUsageAggregate(apiEntry.total_tokens, detailTokens);

    totalRequests = safeAdd(totalRequests, 1);
    successCount = safeAdd(successCount, successDelta);
    failureCount = safeAdd(failureCount, failureDelta);
    totalTokens = safeAdd(totalTokens, detailTokens);
  });

  return {
    total_requests: totalRequests,
    success_count: successCount,
    failure_count: failureCount,
    total_tokens: totalTokens,
    apis,
  };
};

const isCurrentBackendUsageSnapshot = (usage: UsageStatsSnapshot): boolean => {
  const apis = isRecord(usage.apis) ? (usage.apis as Record<string, unknown>) : null;
  const models = isRecord(usage.models) ? (usage.models as Record<string, unknown>) : null;
  if (!apis || !models) {
    return false;
  }

  // token_delta 是后端格式的唯一确定性标记，前端格式不存在此字段
  // 使用它作为主要判据，避免后端新增 total_tokens 等字段时误判
  const hasBackendModels = Object.values(models).some(
    (modelEntry) => isRecord(modelEntry) && 'token_delta' in modelEntry
  );
  if (!hasBackendModels) {
    return false;
  }

  const hasBackendApis = Object.values(apis).some(
    (apiEntry) => isRecord(apiEntry) && ('request_count' in apiEntry || 'total_tokens' in apiEntry)
  );

  // Both markers must be present to avoid double-normalizing already-converted frontend data
  return hasBackendApis && hasBackendModels;
};

const normalizeUsageSnapshotForFrontend = (
  usage: UsageStatsSnapshot | null,
  rawDetails?: Array<UsageSnapshotDetailItem | UsageEvent>
): UsageStatsSnapshot | null => {
  if (!usage) {
    return null;
  }

  if (!isCurrentBackendUsageSnapshot(usage)) {
    return usage;
  }

  const detailEntries = buildCompatibilityUsageDetailEntries(rawDetails);
  const detailSnapshot = buildUsageSnapshotFromCompatibilityEntries(detailEntries);
  const detailBuckets = new Map<string, Record<string, unknown>[]>();

  detailEntries.forEach((entry) => {
    const key = `${entry.endpoint}\u0000${entry.modelName}`;
    const bucket = detailBuckets.get(key) ?? [];
    bucket.push(entry.nestedDetail);
    detailBuckets.set(key, bucket);
  });

  const apisRaw = isRecord(usage.apis) ? (usage.apis as Record<string, unknown>) : {};
  const modelsRaw = isRecord(usage.models) ? (usage.models as Record<string, unknown>) : {};
  const nextApis: Record<string, Record<string, unknown>> = {};

  Object.entries(apisRaw).forEach(([endpoint, apiEntry]) => {
    if (!isRecord(apiEntry)) {
      return;
    }

    nextApis[endpoint] = {
      total_requests: toFiniteNumber(apiEntry.total_requests ?? apiEntry.request_count),
      success_count: toFiniteNumber(apiEntry.success_count),
      failure_count: toFiniteNumber(apiEntry.failure_count),
      total_tokens: getUsageEventAggregateTokens(apiEntry.total_tokens ?? apiEntry),
      models: {},
    };
  });

  Object.entries(modelsRaw).forEach(([modelName, modelEntry]) => {
    if (!isRecord(modelEntry)) {
      return;
    }

    const endpoint = normalizeStringValue(modelEntry.endpoint, UNKNOWN_USAGE_ENDPOINT);
    const apiEntry = isRecord(nextApis[endpoint])
      ? nextApis[endpoint]
      : {
          ...createEmptyApiUsageEntry(),
        };
    if (!isRecord(nextApis[endpoint])) {
      nextApis[endpoint] = apiEntry;
    }

    const models = isRecord(apiEntry.models) ? (apiEntry.models as Record<string, unknown>) : {};
    apiEntry.models = models;
    models[modelName] = {
      total_requests: toFiniteNumber(modelEntry.total_requests ?? modelEntry.request_count),
      success_count: toFiniteNumber(modelEntry.success_count),
      failure_count: toFiniteNumber(modelEntry.failure_count),
      total_tokens: getUsageEventAggregateTokens(
        modelEntry.token_delta ?? modelEntry.total_tokens ?? modelEntry
      ),
      details: detailBuckets.get(`${endpoint}\u0000${modelName}`) ?? [],
    };
  });

  detailBuckets.forEach((details, key) => {
    const [endpoint, modelName] = key.split('\u0000');
    const apiEntry = isRecord(nextApis[endpoint])
      ? nextApis[endpoint]
      : {
          ...createEmptyApiUsageEntry(),
        };
    if (!isRecord(nextApis[endpoint])) {
      nextApis[endpoint] = apiEntry;
    }

    const models = isRecord(apiEntry.models) ? (apiEntry.models as Record<string, unknown>) : {};
    apiEntry.models = models;
    if (!isRecord(models[modelName])) {
      models[modelName] = {
        total_requests: details.length,
        success_count: details.filter((detail) => isRecord(detail) && detail.failed !== true)
          .length,
        failure_count: details.filter((detail) => isRecord(detail) && detail.failed === true)
          .length,
        total_tokens: details.reduce(
          (sum, detail) =>
            safeAdd(
              sum,
              getUsageEventAggregateTokens(isRecord(detail) ? (detail.tokens ?? detail) : detail)
            ),
          0
        ),
        details,
      };
    }
  });

  if (Object.keys(nextApis).length === 0) {
    return detailSnapshot;
  }

  const totals = Object.values(nextApis).reduce<{
    totalRequests: number;
    successCount: number;
    failureCount: number;
    totalTokens: number;
  }>(
    (acc, apiEntry) => {
      acc.totalRequests = safeAdd(acc.totalRequests, toFiniteNumber(apiEntry.total_requests));
      acc.successCount = safeAdd(acc.successCount, toFiniteNumber(apiEntry.success_count));
      acc.failureCount = safeAdd(acc.failureCount, toFiniteNumber(apiEntry.failure_count));
      acc.totalTokens = safeAdd(acc.totalTokens, toFiniteNumber(apiEntry.total_tokens));
      return acc;
    },
    { totalRequests: 0, successCount: 0, failureCount: 0, totalTokens: 0 }
  );

  // 排除后端顶层 models 字段，防止缓存读取时触发二次归一化导致计数翻倍
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- models 必须被解构排除
  const { models: _backendModels, ...usageWithoutModels } = usage;
  return {
    ...usageWithoutModels,
    total_requests: totals.totalRequests,
    success_count: totals.successCount,
    failure_count: totals.failureCount,
    total_tokens: totals.totalTokens,
    apis: nextApis,
  };
};

const buildUsageSnapshotFromEvents = (events: UsageEvent[]): UsageStatsSnapshot | null => {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  const entries = buildCompatibilityUsageDetailEntries(events);
  if (entries.length === 0) {
    return null;
  }

  return buildUsageSnapshotFromCompatibilityEntries(entries);
};

const readUsageStatsWithCompatibility = async (
  apiBase: string,
  managementKey: string,
  signal: AbortSignal,
  currentUsage: UsageStatsSnapshot | null,
  currentUsageDetails: UsageDetail[],
  currentLastSeq: number | null
): Promise<UsageBootstrapResult> => {
  try {
    const [usageResult, eventsResult] = await Promise.allSettled([
      usageApi.getUsage({ signal }),
      usageApi.getUsageEvents({ signal }),
    ]);

    if (signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const usageResponse = usageResult.status === 'fulfilled' ? usageResult.value : null;
    const usageError = usageResult.status === 'rejected' ? usageResult.reason : null;
    const eventsResponse = eventsResult.status === 'fulfilled' ? eventsResult.value : undefined;
    const eventsError = eventsResult.status === 'rejected' ? eventsResult.reason : null;

    if (usageError && isCanceledRequestError(usageError)) {
      throw usageError;
    }
    if (eventsError && isCanceledRequestError(eventsError)) {
      throw eventsError;
    }

    if (eventsError && !isCanceledRequestError(eventsError)) {
      logger.warn('Failed to fetch usage events', { error: eventsError });
    }

    const usageStatus = usageError ? getApiErrorStatus(usageError) : null;
    const hasEvents = eventsResponse && eventsResponse.length > 0;

    if (usageStatus === 404 && hasEvents) {
      const usageDetails = collectUsageDetailsFromEvents(eventsResponse);
      const usage = buildUsageSnapshotFromEvents(eventsResponse!);
      return { usage, usageDetails, lastSeq: null };
    }

    if (usageError) {
      throw usageError;
    }

    const rawUsage = usageResponse?.usage ?? usageResponse;
    const usage =
      rawUsage && typeof rawUsage === 'object'
        ? normalizeUsageSnapshotForFrontend(rawUsage as UsageStatsSnapshot, eventsResponse)
        : null;
    const usageDetails = hasEvents
      ? collectUsageDetailsFromEvents(eventsResponse)
      : collectUsageDetails(usage);

    return {
      usage,
      usageDetails,
      lastSeq: null,
    };
  } catch (error) {
    if (error && isCanceledRequestError(error)) {
      throw error;
    }

    if (getApiErrorStatus(error) !== 404) {
      throw error;
    }

    if (usageSSEService.getConnectionStatus() === 'connected' && currentUsage) {
      return {
        usage: currentUsage,
        usageDetails:
          currentUsageDetails.length > 0
            ? trimUsageDetails(currentUsageDetails)
            : collectUsageDetails(currentUsage),
        lastSeq: currentLastSeq,
      };
    }

    try {
      const fullSnapshot = await usageSSEService.awaitFullSnapshot(apiBase, managementKey, {
        signal,
        timeoutMs: 8000,
      });
      const usageDetails = Array.isArray(fullSnapshot.usageDetails)
        ? buildCompatibilityUsageDetailEntries(fullSnapshot.usageDetails).map(
            (entry) => entry.usageDetail
          )
        : [];
      const usage = normalizeUsageSnapshotForFrontend(
        fullSnapshot.usage as UsageStatsSnapshot,
        fullSnapshot.usageDetails
      );

      return {
        usage,
        usageDetails: usageDetails.length > 0 ? usageDetails : collectUsageDetails(usage),
        lastSeq: typeof fullSnapshot.seq === 'number' ? fullSnapshot.seq : null,
      };
    } catch (snapshotError) {
      if (snapshotError && isCanceledRequestError(snapshotError)) {
        throw snapshotError;
      }

      // SSE 快照获取失败时，降级到已有缓存数据而不是抛错
      if (currentUsage) {
        logger.warn('awaitFullSnapshot failed, falling back to cached data', {
          message: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
          stack: snapshotError instanceof Error ? snapshotError.stack : undefined,
        });
        return {
          usage: currentUsage,
          usageDetails:
            currentUsageDetails.length > 0
              ? trimUsageDetails(currentUsageDetails)
              : collectUsageDetails(currentUsage),
          lastSeq: currentLastSeq,
        };
      }

      throw snapshotError;
    }
  }
};

const resolveCachedUsageDetails = (
  usage: UsageStatsSnapshot | null,
  usageDetails: UsageDetail[] | undefined
): UsageDetail[] => resolveCachedUsageDetailsFromUsage(usage, usageDetails);

const DELTA_RECOVERY_COOLDOWN_MS = 30_000;
let lastDeltaRecoveryAt = 0;

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
      ? (() => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars -- models 必须被解构排除，防止缓存读取时触发二次归一化
          const { models: _, ...rest } = snapshot.usage as Record<string, unknown>;
          return rest as UsageStatsSnapshot;
        })()
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

  const primaryTime = primary.lastRefreshedAt ?? 0;
  const secondaryTime = secondary.lastRefreshedAt ?? 0;

  // 优先选择更新时间更近的缓存，避免旧但 detailCount 更大的缓存导致数据回退
  if (secondaryTime !== primaryTime) {
    return secondaryTime > primaryTime ? secondary : primary;
  }

  return secondary.detailCount > primary.detailCount ? secondary : primary;
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
        ? (() => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- models 必须被解构排除
            const { models: _, ...rest } = parsed.usage as Record<string, unknown>;
            return rest as UsageStatsSnapshot;
          })()
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
    // 序列化数据仍然太大，直接降级到 lite，跳过对完整缓存的二次序列化
  }

  const liteCache: PersistedUsageStatsCache = {
    ...persistableCache,
    usage: persistableCache.usage ? createAggregateOnlyUsageSnapshot(persistableCache.usage) : null,
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(liteCache));
    return;
  } catch {
    CacheLayer.prune();
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(liteCache));
    return;
  } catch {
    // lite 仍失败，继续 ultra-lite 降级
  }

  const ultraLiteCache: PersistedUsageStatsCache = {
    ...liteCache,
    usageDetails: [],
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(ultraLiteCache));
  } catch {
    // 所有降级策略均失败，放弃持久化
  }
};

// ── Deferred persistence for hot SSE paths ──────────────────────────────────────
// Batches rapid delta/full-snapshot writes via requestIdleCallback to avoid blocking
// the event loop. Each scopeKey is deduplicated so only the latest snapshot persists.

const deferredPersistQueue = new Map<string, PersistedUsageStatsCache>();
let deferredPersistScheduled = false;

export const flushDeferredPersistQueue = () => {
  deferredPersistScheduled = false;
  for (const cache of deferredPersistQueue.values()) {
    writePersistedUsageStats(cache);
  }
  deferredPersistQueue.clear();
};

const scheduleDeferredPersist = () => {
  if (deferredPersistScheduled) return;
  deferredPersistScheduled = true;
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(flushDeferredPersistQueue, { timeout: 2000 });
  } else {
    setTimeout(flushDeferredPersistQueue, 0);
  }
};

const writeDeferredPersistedUsageStats = (cache: PersistedUsageStatsCache) => {
  if (typeof localStorage === 'undefined' || !cache.scopeKey) return;
  deferredPersistQueue.set(cache.scopeKey, cache);
  scheduleDeferredPersist();
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushDeferredPersistQueue);
}

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
  const { usage, usageDetails, removedCount, topLevelRemovedCount } = expireUsageFailed(
    cache.usage,
    cache.usageDetails
  );
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
      if (expireFailedCleanupTimerId !== null) {
        clearTimeout(expireFailedCleanupTimerId);
      }
      expireFailedCleanupTimerId = setTimeout(tryCleanup, EXPIRE_FAILED_CLEANUP_IDLE_THRESHOLD_MS);
      return;
    }

    const state = useUsageStatsStore.getState();
    if (!state.scopeKey || state.loading) {
      if (expireFailedCleanupTimerId !== null) {
        clearTimeout(expireFailedCleanupTimerId);
      }
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

    if (expireFailedCleanupTimerId !== null) {
      clearTimeout(expireFailedCleanupTimerId);
    }
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

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  usage: null,
  keyStats: createEmptyKeyStats(),
  usageDetails: [],
  loading: false,
  error: null,
  lastRefreshedAt: null,
  scopeKey: '',
  lastSeq: null,
  dataQualityWarning: null,

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
      : (state.lastRefreshedAt ??
        autoPersistCache?.lastRefreshedAt ??
        persistedCache?.lastRefreshedAt ??
        null);
    const fresh = cachedLastRefreshedAt !== null && now - cachedLastRefreshedAt < staleTimeMs;

    // 只有在需要显示历史数据时才选择更丰富的缓存源，避免不必要的状态抖动
    const rawBootstrapCache =
      scopeChanged || !fresh
        ? pickRicherUsageSnapshot(persistedCache, autoPersistCache)
        : (autoPersistCache ?? pickRicherUsageSnapshot(persistedCache, autoPersistCache));

    // 只在缓存较旧或范围切换时清理过期失败记录，避免频繁加载时反复清除用户数据
    const shouldCleanBootstrap =
      scopeChanged ||
      !fresh ||
      (rawBootstrapCache?.lastRefreshedAt !== null &&
        rawBootstrapCache?.lastRefreshedAt !== undefined &&
        now - rawBootstrapCache.lastRefreshedAt > EXPIRE_FAILED_CLEANUP_INTERVAL_MS);
    const bootstrapCache = rawBootstrapCache
      ? shouldCleanBootstrap
        ? cleanBootstrapCache(rawBootstrapCache)
        : rawBootstrapCache
      : null;

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

    // 新增：快照请求前的 lastSeq，用于检测竞态
    const preRequestLastSeq = get().lastSeq;

    pendingDeltas.splice(0, pendingDeltas.length);
    set({ loading: true, error: null, scopeKey });

    const requestPromise = (async () => {
      try {
        const baseState = get();
        const bootstrap = await readUsageStatsWithCompatibility(
          apiBase,
          managementKey,
          activeAbortController.signal,
          baseState.scopeKey === scopeKey ? baseState.usage : (bootstrapCache?.usage ?? null),
          baseState.scopeKey === scopeKey
            ? baseState.usageDetails
            : (bootstrapCache?.usageDetails ?? []),
          baseState.scopeKey === scopeKey ? baseState.lastSeq : null
        );
        const usage = bootstrap.usage;

        // Reset counter before normalization so only the fresh batch is counted
        getAndResetNonFiniteCount();

        if (requestId !== usageRequestToken) return;

        const usageDetails = trimUsageDetails(bootstrap.usageDetails);
        const keyStats = computeKeyStatsFromDetails(usageDetails);
        const dataQualityWarning = checkDataQualityWarning();
        const lastRefreshedAt = Date.now();
        const nextSnapshot = {
          usage,
          keyStats,
          usageDetails,
          lastRefreshedAt,
          detailCount: bootstrap.usageDetails.length,
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

        // 新增：检测请求期间是否有 delta 已应用
        const currentSeqBeforeSet = get().lastSeq;
        const deltaAppliedDuringRequest =
          preRequestLastSeq !== null &&
          currentSeqBeforeSet !== null &&
          currentSeqBeforeSet > preRequestLastSeq;

        if (deltaAppliedDuringRequest) {
          // REST 数据可能比已应用的 delta 更旧，只更新非聚合字段
          logger.info('[loadUsageStats] 检测到请求期间有 delta 已应用，跳过 usage 覆盖:', {
            preRequestLastSeq,
            currentSeqBeforeSet,
            restLastSeq: bootstrap.lastSeq,
          });

          set({
            keyStats: nextSnapshot.keyStats,
            usageDetails: nextSnapshot.usageDetails,
            loading: false,
            error: null,
            lastRefreshedAt: nextSnapshot.lastRefreshedAt,
            scopeKey,
            dataQualityWarning,
            // 不覆盖 usage 和 lastSeq
          });

          // 如果 REST 数据较旧，触发全量修正以确保最终一致性
          if (bootstrap.lastSeq !== null && bootstrap.lastSeq < currentSeqBeforeSet) {
            logger.info('[loadUsageStats] REST 数据较旧，触发全量修正');
            usageSSEService.requestFullCorrection();
            void get()
              .loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
              .catch(() => {});
          }

          return;
        }

        // 正常覆盖路径（无竞态）
        set({
          usage: nextSnapshot.usage,
          keyStats: nextSnapshot.keyStats,
          usageDetails: nextSnapshot.usageDetails,
          loading: false,
          error: null,
          lastRefreshedAt: nextSnapshot.lastRefreshedAt,
          scopeKey,
          dataQualityWarning,
          ...(bootstrap.lastSeq !== null ? { lastSeq: bootstrap.lastSeq } : {}),
        });

        // REST 成功后，应用 loading 期间缓存的 SSE delta，防止数据倒退
        const buffered = pendingDeltas.splice(0, pendingDeltas.length);
        if (buffered.length > 0) {
          const currentState = get();
          const needsFullCorrection =
            currentState.lastSeq === null ||
            buffered.some((d) => d.seq > currentState.lastSeq! + 1);

          if (needsFullCorrection) {
            set({ loading: true, error: null });
            usageSSEService.requestFullCorrection();
            void get()
              .loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
              .catch(() => {});
          } else {
            for (const delta of buffered) {
              if (delta.seq <= get().lastSeq!) continue;
              if (delta.seq !== get().lastSeq! + 1) {
                set({ loading: true, error: null });
                usageSSEService.requestFullCorrection();
                void get()
                  .loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
                  .catch(() => {});
                break;
              }
              get().applyDelta(delta);
            }
          }
        }

        scheduleExpireFailedCleanup();
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
    pendingDeltas.splice(0, pendingDeltas.length);
    lastDeltaRecoveryAt = 0;
    cancelExpireFailedCleanup();
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

    if (state.loading) {
      pendingDeltas.push(delta);
      return;
    }

    const requestDeltaRecovery = () => {
      const now = Date.now();
      // 30 秒内只允许一次全量修正，避免修正风暴
      if (now - lastDeltaRecoveryAt < DELTA_RECOVERY_COOLDOWN_MS) {
        pendingDeltas.push(delta);
        return;
      }
      lastDeltaRecoveryAt = now;
      // 缓存触发修正的 delta，修正完成后会重放
      pendingDeltas.push(delta);
      set({ loading: true, error: null });
      usageSSEService.requestFullCorrection();
      void get()
        .loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
        .catch(() => {});
    };

    if (state.usage === null) {
      requestDeltaRecovery();
      return;
    }

    if (state.lastSeq === null) {
      requestDeltaRecovery();
      return;
    }

    if (delta.seq !== state.lastSeq + 1) {
      requestDeltaRecovery();
      return;
    }

    const mergedUsage = mergeModelBreakdown(
      mergeUsageDelta(state.usage, delta),
      delta.modelBreakdown
    );
    const newDetails = delta.details.map(createUsageDetailFromDelta);
    const existingLen = state.usageDetails.length;
    const totalLen = existingLen + newDetails.length;
    const needsTrim = totalLen > MAX_USAGE_DETAILS_LENGTH;
    let removedDetails: UsageDetail[] | undefined;
    let trimmedDetails: UsageDetail[];
    if (needsTrim) {
      const keepFromExisting = Math.max(0, MAX_USAGE_DETAILS_LENGTH - newDetails.length);
      const removeCount = existingLen - keepFromExisting;
      removedDetails = removeCount > 0 ? state.usageDetails.slice(0, removeCount) : undefined;
      trimmedDetails = [...state.usageDetails.slice(removeCount), ...newDetails];
    } else {
      trimmedDetails = [...state.usageDetails, ...newDetails];
    }
    // 先 subtract 再 merge，避免中间状态导致 keyStats 短暂包含已删除 details 的计数
    let keyStats = state.keyStats;
    if (removedDetails) {
      keyStats = subtractKeyStatsForDetails(keyStats, removedDetails);
    }
    keyStats = mergeKeyStatsIncremental(keyStats, newDetails);
    const receivedAt = Date.now();
    const nextSnapshot = {
      usage: mergedUsage,
      keyStats,
      usageDetails: trimmedDetails,
      lastRefreshedAt: receivedAt,
      detailCount: totalLen,
      scopeKey: state.scopeKey,
    };

    autoPersistService.onUsageRefreshed({
      scopeKey: state.scopeKey,
      usage: mergedUsage,
      keyStats,
      usageDetails: trimmedDetails,
      lastRefreshedAt: receivedAt,
    });

    writeDeferredPersistedUsageStats(nextSnapshot);

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
    const usage = normalizeUsageSnapshotForFrontend(
      snapshot.usage as UsageStatsSnapshot,
      snapshot.usageDetails
    );
    const rawDetails = Array.isArray(snapshot.usageDetails)
      ? buildCompatibilityUsageDetailEntries(snapshot.usageDetails).map(
          (entry) => entry.usageDetail
        )
      : collectUsageDetails(usage);
    const rawDetailCount = rawDetails.length;
    const usageDetails = trimUsageDetails(rawDetails);
    const keyStats = computeKeyStatsFromDetails(usageDetails);
    const lastRefreshedAt = Date.now();
    const nextSnapshot = {
      usage,
      keyStats,
      usageDetails,
      lastRefreshedAt,
      detailCount: rawDetailCount,
      scopeKey: state.scopeKey,
    };

    autoPersistService.onUsageRefreshed({
      scopeKey: state.scopeKey,
      usage,
      keyStats,
      usageDetails,
      lastRefreshedAt,
    });

    writeDeferredPersistedUsageStats(nextSnapshot);

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
