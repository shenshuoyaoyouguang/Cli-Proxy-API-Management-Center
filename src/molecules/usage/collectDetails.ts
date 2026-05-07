import type { UsageDetail, UsageDetailWithEndpoint } from '@/atoms/usage/types';
import { isRecord, getApisRecord, normalizeAuthIndex } from '@/atoms/usage/guards';
import { normalizeUsageSourceId } from '@/atoms/usage/source';
import { normalizeUsageDetailTokens } from '@/atoms/usage/tokens';
import { parseTimestampMs } from '@/utils/timestamp';
import type { UsageEvent } from '@/services/api/usage';

const USAGE_ENDPOINT_METHOD_REGEX = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i;

const usageDetailsCache = new WeakMap<object, UsageDetail[]>();
const usageDetailsWithEndpointCache = new WeakMap<object, UsageDetailWithEndpoint[]>();

function createNormalizeSource() {
  const sourceCache = new Map<string, string>();
  return (value: unknown): string => {
    const raw =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const cached = sourceCache.get(trimmed);
    if (cached !== undefined) return cached;
    const normalized = normalizeUsageSourceId(trimmed);
    sourceCache.set(trimmed, normalized);
    return normalized;
  };
}

function getApisWithFallback(usageData: unknown): Record<string, unknown> | null {
  let apis = getApisRecord(usageData);
  if (!apis && isRecord(usageData)) {
    const usageField = (usageData as Record<string, unknown>).usage;
    if (isRecord(usageField)) {
      apis = getApisRecord(usageField);
    }
  }
  return apis;
}

function readCachedDetails<T>(
  cache: WeakMap<object, T[]>,
  usageData: unknown,
  apis: Record<string, unknown> | null
): T[] | null {
  const rootCacheKey = isRecord(usageData) ? (usageData as object) : null;
  if (rootCacheKey) {
    const cached = cache.get(rootCacheKey);
    if (cached) {
      return cached;
    }
  }

  const apisCacheKey = apis ? (apis as object) : null;
  if (!apisCacheKey) {
    return null;
  }

  const cached = cache.get(apisCacheKey);
  if (!cached) {
    return null;
  }

  if (rootCacheKey && rootCacheKey !== apisCacheKey) {
    cache.set(rootCacheKey, cached);
  }

  return cached;
}

function writeCachedDetails<T>(
  cache: WeakMap<object, T[]>,
  usageData: unknown,
  apis: Record<string, unknown> | null,
  details: T[]
) {
  const rootCacheKey = isRecord(usageData) ? (usageData as object) : null;
  const apisCacheKey = apis ? (apis as object) : null;

  if (apisCacheKey) {
    cache.set(apisCacheKey, details);
  }

  if (rootCacheKey) {
    cache.set(rootCacheKey, details);
  }
}

export function collectUsageDetails(usageData: unknown): UsageDetail[] {
  const apis = getApisWithFallback(usageData);
  const cached = readCachedDetails(usageDetailsCache, usageData, apis);
  if (cached) {
    return cached;
  }

  if (!apis) {
    if (import.meta.env.DEV) {
      console.warn('[collectUsageDetails] No apis field found in:', usageData);
    }
    return [];
  }
  const details: UsageDetail[] = [];
  const normalizeSource = createNormalizeSource();

  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) return;
      const modelDetailsRaw = modelEntry.details;
      const modelDetails = Array.isArray(modelDetailsRaw) ? modelDetailsRaw : [];

      modelDetails.forEach((detailRaw) => {
        if (!isRecord(detailRaw) || typeof detailRaw.timestamp !== 'string') return;
        const timestamp = detailRaw.timestamp;
        const timestampMs = parseTimestampMs(detailRaw.timestamp);
        const tokens = normalizeUsageDetailTokens(detailRaw);
        const authIndex = normalizeAuthIndex(detailRaw.auth_index);

        details.push({
          timestamp,
          source: normalizeSource(detailRaw.source),
          auth_index: authIndex,
          tokens,
          failed: detailRaw.failed === true,
          __modelName: modelName,
          __timestampMs: timestampMs,
        });
      });
    });
  });

  writeCachedDetails(usageDetailsCache, usageData, apis, details);
  return details;
}

export function collectUsageDetailsWithEndpoint(usageData: unknown): UsageDetailWithEndpoint[] {
  const apis = getApisWithFallback(usageData);
  const cached = readCachedDetails(usageDetailsWithEndpointCache, usageData, apis);
  if (cached) {
    return cached;
  }

  if (!apis) {
    if (import.meta.env.DEV) {
      console.warn('[collectUsageDetailsWithEndpoint] No apis field found in:', usageData);
    }
    return [];
  }

  const details: UsageDetailWithEndpoint[] = [];
  const normalizeSource = createNormalizeSource();

  Object.entries(apis).forEach(([endpoint, apiEntry]) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    const endpointMatch = endpoint.match(USAGE_ENDPOINT_METHOD_REGEX);
    const endpointMethod = endpointMatch?.[1]?.toUpperCase();
    const endpointPath = endpointMatch?.[2];

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) return;
      const modelDetailsRaw = modelEntry.details;
      const modelDetails = Array.isArray(modelDetailsRaw) ? modelDetailsRaw : [];

      modelDetails.forEach((detailRaw) => {
        if (!isRecord(detailRaw) || typeof detailRaw.timestamp !== 'string') return;
        const timestamp = detailRaw.timestamp;
        const timestampMs = parseTimestampMs(detailRaw.timestamp);
        const tokens = normalizeUsageDetailTokens(detailRaw);
        const authIndex = normalizeAuthIndex(detailRaw.auth_index);

        details.push({
          timestamp,
          source: normalizeSource(detailRaw.source),
          auth_index: authIndex,
          tokens,
          failed: detailRaw.failed === true,
          __modelName: modelName,
          __endpoint: endpoint,
          __endpointMethod: endpointMethod,
          __endpointPath: endpointPath,
          __timestampMs: timestampMs,
        });
      });
    });
  });

  writeCachedDetails(usageDetailsWithEndpointCache, usageData, apis, details);
  return details;
}

export function collectUsageDetailsFromEvents(events: UsageEvent[]): UsageDetail[] {
  if (!Array.isArray(events)) {
    if (import.meta.env.DEV) {
      console.warn('[collectUsageDetailsFromEvents] Expected array, got:', typeof events);
    }
    return [];
  }

  const details: UsageDetail[] = [];
  const normalizeSource = createNormalizeSource();

  events.forEach((event) => {
    if (!isRecord(event)) return;

    let timestamp: string;
    let timestampMs: number;

    if (typeof event.timestamp === 'number') {
      timestampMs = event.timestamp;
      timestamp = new Date(timestampMs).toISOString();
    } else if (typeof event.timestamp === 'string') {
      timestamp = event.timestamp;
      timestampMs = parseTimestampMs(timestamp);
    } else {
      return;
    }

    const tokenSource = event.tokens ?? event.usage;
    const tokens = normalizeUsageDetailTokens(tokenSource);
    const authIndex = normalizeAuthIndex(event.auth_index);
    const modelName = typeof event.model === 'string' && event.model.trim()
      ? event.model.trim()
      : undefined;

    details.push({
      timestamp,
      source: normalizeSource(event.source),
      auth_index: authIndex,
      tokens,
      failed: event.failed === true,
      __modelName: modelName,
      __timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined,
    });
  });

  return details;
}
