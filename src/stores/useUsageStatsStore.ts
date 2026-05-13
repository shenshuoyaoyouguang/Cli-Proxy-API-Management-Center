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
import { computeApiUrl } from '@/utils/connection';
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
const UNKNOWN_USAGE_ENDPOINT = 'unknown';
const USAGE_QUEUE_FALLBACK_COUNT = 1000;

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

    const models = isRecord(apiEntry.models)
      ? (apiEntry.models as Record<string, unknown>)
      : {};
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

    totalRequests += 1;
    successCount += successDelta;
    failureCount += failureDelta;
    totalTokens += detailTokens;
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

  return (
    Object.values(apis).some(
      (apiEntry) => isRecord(apiEntry) && ('request_count' in apiEntry || 'total_tokens' in apiEntry)
    ) ||
    Object.values(models).some(
      (modelEntry) => isRecord(modelEntry) && ('token_delta' in modelEntry || 'endpoint' in modelEntry)
    )
  );
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

    const models = isRecord(apiEntry.models)
      ? (apiEntry.models as Record<string, unknown>)
      : {};
    apiEntry.models = models;
    models[modelName] = {
      total_requests: toFiniteNumber(modelEntry.total_requests ?? modelEntry.request_count),
      success_count: toFiniteNumber(modelEntry.success_count),
      failure_count: toFiniteNumber(modelEntry.failure_count),
      total_tokens: getUsageEventAggregateTokens(modelEntry.token_delta ?? modelEntry.total_tokens ?? modelEntry),
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

    const models = isRecord(apiEntry.models)
      ? (apiEntry.models as Record<string, unknown>)
      : {};
    apiEntry.models = models;
    if (!isRecord(models[modelName])) {
      models[modelName] = {
        total_requests: details.length,
        success_count: details.filter((detail) => isRecord(detail) && detail.failed !== true).length,
        failure_count: details.filter((detail) => isRecord(detail) && detail.failed === true).length,
        total_tokens: details.reduce(
          (sum, detail) => sum + getUsageEventAggregateTokens(isRecord(detail) ? detail.tokens ?? detail : detail),
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
  }>((acc, apiEntry) => {
      acc.totalRequests += toFiniteNumber(apiEntry.total_requests);
      acc.successCount += toFiniteNumber(apiEntry.success_count);
      acc.failureCount += toFiniteNumber(apiEntry.failure_count);
      acc.totalTokens += toFiniteNumber(apiEntry.total_tokens);
      return acc;
    }, { totalRequests: 0, successCount: 0, failureCount: 0, totalTokens: 0 });

  return {
    ...usage,
    total_requests: totals.totalRequests,
    success_count: totals.successCount,
    failure_count: totals.failureCount,
    total_tokens: totals.totalTokens,
    apis: nextApis,
  };
};

type ParsedSSEEvent = {
  eventType: string;
  data: string;
};

const parseSSEChunk = (chunk: string, buffer: { value: string }): ParsedSSEEvent[] => {
  buffer.value += chunk;

  const events: ParsedSSEEvent[] = [];
  let eventType = 'message';
  let data = '';
  const lines = buffer.value.split(/\r\n|\n|\r/);
  const lastLine = lines.pop() ?? '';
  buffer.value = lastLine;

  lines.forEach((line) => {
    if (line === '') {
      if (data !== '') {
        events.push({ eventType, data });
        eventType = 'message';
        data = '';
      }
      return;
    }

    if (line.startsWith(':')) {
      return;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      return;
    }

    const field = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1).replace(/^ /, '');
    if (field === 'event') {
      eventType = value;
      return;
    }
    if (field === 'data') {
      data = data ? `${data}\n${value}` : value;
    }
  });

  return events;
};

const createHttpStatusError = (status: number, message: string) => {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
};

const readUsageBootstrapFromStream = async (
  apiBase: string,
  managementKey: string,
  signal: AbortSignal
): Promise<UsageBootstrapResult> => {
  const url = `${computeApiUrl(apiBase)}/usage/stream`;
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${managementKey}`,
    },
    signal,
  });

  if (!response.ok) {
    throw createHttpStatusError(response.status, `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No readable stream');
  }

  const decoder = new TextDecoder();
  const buffer = { value: '' };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const events = parseSSEChunk(decoder.decode(value, { stream: true }), buffer);
      for (const event of events) {
        if (event.eventType !== 'usage:full') {
          continue;
        }

        const payload = JSON.parse(event.data) as UsageFullEvent;
        const usageDetails = buildCompatibilityUsageDetailEntries(payload.usageDetails).map(
          (entry) => entry.usageDetail
        );
        const usage = normalizeUsageSnapshotForFrontend(
          payload.usage as UsageStatsSnapshot,
          payload.usageDetails
        );
        await reader.cancel();
        return {
          usage,
          usageDetails,
          lastSeq: typeof payload.seq === 'number' ? payload.seq : null,
        };
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error('Usage stream ended before initial snapshot');
};

const buildUsageDeltaFromEvents = (events: UsageEvent[]): UsageDeltaEvent => {
  const modelBreakdownMap = new Map<string, UsageModelBreakdownItem>();
  let requestCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let cachedTokens = 0;
  let totalTokens = 0;

  const details = events.reduce<UsageDeltaDetailItem[]>((acc, event) => {
    if (!isRecord(event)) {
      return acc;
    }

    const tokens = normalizeUsageDetailTokens(event.tokens ?? event.usage ?? event);
    const timestamp =
      typeof event.timestamp === 'number'
        ? event.timestamp
        : parseTimestampMs(typeof event.timestamp === 'string' ? event.timestamp : '');
    const endpoint = normalizeStringValue(event.endpoint, UNKNOWN_USAGE_ENDPOINT);
    const model = normalizeUsageModelName(event.model);
    const success = event.failed !== true;
    const mapKey = `${endpoint}\u0000${model}`;
    const bucket = modelBreakdownMap.get(mapKey) ?? {
      endpoint,
      model,
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      tokenDelta: {
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
      },
    };

    bucket.requestCount += 1;
    bucket.successCount += success ? 1 : 0;
    bucket.failureCount += success ? 0 : 1;
    bucket.tokenDelta.promptTokens += tokens.input_tokens;
    bucket.tokenDelta.completionTokens += tokens.output_tokens;
    bucket.tokenDelta.reasoningTokens = (bucket.tokenDelta.reasoningTokens ?? 0) + tokens.reasoning_tokens;
    bucket.tokenDelta.cachedTokens = (bucket.tokenDelta.cachedTokens ?? 0) + tokens.cached_tokens;
    bucket.tokenDelta.totalTokens += tokens.total_tokens;
    modelBreakdownMap.set(mapKey, bucket);

    requestCount += 1;
    successCount += success ? 1 : 0;
    failureCount += success ? 0 : 1;
    promptTokens += tokens.input_tokens;
    completionTokens += tokens.output_tokens;
    reasoningTokens += tokens.reasoning_tokens;
    cachedTokens += tokens.cached_tokens;
    totalTokens += tokens.total_tokens;

    acc.push({
      model,
      source: normalizeUsageSourceId(event.source),
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      success,
      tokens: {
        prompt: tokens.input_tokens,
        completion: tokens.output_tokens,
        reasoning: tokens.reasoning_tokens,
        cached: tokens.cached_tokens,
        total: tokens.total_tokens,
      },
    });
    return acc;
  }, []);

  return {
    seq: 0,
    timestamp: Date.now(),
    requestCount,
    successCount,
    failureCount,
    tokenDelta: {
      promptTokens,
      completionTokens,
      reasoningTokens,
      cachedTokens,
      totalTokens,
    },
    modelBreakdown: Array.from(modelBreakdownMap.values()),
    details,
  };
};

const readUsageBootstrapFromQueue = async (
  baseUsage: UsageStatsSnapshot | null,
  baseUsageDetails: UsageDetail[],
  signal: AbortSignal
): Promise<UsageBootstrapResult> => {
  const events = await usageApi.getUsageQueue(USAGE_QUEUE_FALLBACK_COUNT, { signal });
  const normalizedDetails = collectUsageDetailsFromEvents(events);
  if (events.length === 0) {
    return {
      usage: baseUsage,
      usageDetails: trimUsageDetails(baseUsageDetails),
      lastSeq: null,
    };
  }

  const mergedDetails = [...baseUsageDetails, ...normalizedDetails];
  const delta = buildUsageDeltaFromEvents(events);
  const usage = baseUsage
    ? mergeModelBreakdown(mergeUsageDelta(baseUsage, delta), delta.modelBreakdown)
    : buildUsageSnapshotFromCompatibilityEntries(buildCompatibilityUsageDetailEntries(events));

  return {
    usage,
    usageDetails: trimUsageDetails(mergedDetails),
    lastSeq: null,
  };
};

const readUsageStatsWithCompatibility = async (
  apiBase: string,
  managementKey: string,
  signal: AbortSignal,
  baseUsage: UsageStatsSnapshot | null,
  baseUsageDetails: UsageDetail[]
): Promise<UsageBootstrapResult> => {
  try {
    const [usageResponse, eventsResponse] = await Promise.all([
      usageApi.getUsage({ signal }),
      usageApi.getUsageEvents({ signal }).catch((error) => {
        if (error && isCanceledRequestError(error)) return undefined;
        logger.warn('Failed to fetch usage events', { error });
        return undefined;
      }),
    ]);

    const rawUsage = usageResponse?.usage ?? usageResponse;
    const usage =
      rawUsage && typeof rawUsage === 'object'
        ? normalizeUsageSnapshotForFrontend(rawUsage as UsageStatsSnapshot, eventsResponse)
        : null;
    const usageDetails =
      eventsResponse && eventsResponse.length > 0
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

    try {
      return await readUsageBootstrapFromStream(apiBase, managementKey, signal);
    } catch (streamError) {
      if (streamError && isCanceledRequestError(streamError)) {
        throw streamError;
      }
      logger.warn('Failed to bootstrap usage stats from stream, falling back to queue', {
        error: streamError,
      });
      return readUsageBootstrapFromQueue(baseUsage, baseUsageDetails, signal);
    }
  }
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
        const baseState = get();
        const fallbackUsage =
          baseState.scopeKey === scopeKey
            ? baseState.usage
            : bootstrapCache?.usage ?? null;
        const fallbackUsageDetails =
          baseState.scopeKey === scopeKey
            ? baseState.usageDetails
            : bootstrapCache?.usageDetails ?? [];
        const bootstrap = await readUsageStatsWithCompatibility(
          apiBase,
          managementKey,
          activeAbortController.signal,
          fallbackUsage,
          fallbackUsageDetails
        );
        const usage = bootstrap.usage;

        if (requestId !== usageRequestToken) return;

        const usageDetails = trimUsageDetails(bootstrap.usageDetails);
        const keyStats = computeKeyStatsFromDetails(usageDetails);
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

        set({
          usage: nextSnapshot.usage,
          keyStats: nextSnapshot.keyStats,
          usageDetails: nextSnapshot.usageDetails,
          loading: false,
          error: null,
          lastRefreshedAt: nextSnapshot.lastRefreshedAt,
          scopeKey,
          ...(bootstrap.lastSeq !== null ? { lastSeq: bootstrap.lastSeq } : {}),
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
    const usage = normalizeUsageSnapshotForFrontend(
      snapshot.usage as UsageStatsSnapshot,
      snapshot.usageDetails
    );
    const usageDetails = Array.isArray(snapshot.usageDetails)
      ? trimUsageDetails(
          buildCompatibilityUsageDetailEntries(snapshot.usageDetails).map((entry) => entry.usageDetail)
        )
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
