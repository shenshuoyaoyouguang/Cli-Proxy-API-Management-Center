import type { UsageDetail, UsageDetailWithEndpoint } from '@/atoms/usage/types';
import { isRecord, getApisRecord, normalizeAuthIndex } from '@/atoms/usage/guards';
import { normalizeUsageSourceId } from '@/atoms/usage/source';
import { normalizeUsageTokens } from '@/atoms/usage/tokens';

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

export function collectUsageDetails(usageData: unknown): UsageDetail[] {
  const cacheKey = isRecord(usageData) ? (usageData as object) : null;
  if (cacheKey) {
    const cached = usageDetailsCache.get(cacheKey);
    if (cached) return cached;
  }

  const apis = getApisWithFallback(usageData);

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
        const timestampMs = Date.parse(detailRaw.timestamp);
        const tokens = normalizeUsageTokens(detailRaw.tokens);
        const authIndex = normalizeAuthIndex(detailRaw.auth_index);

        details.push({
          timestamp,
          source: normalizeSource(detailRaw.source),
          auth_index: authIndex,
          tokens,
          failed: detailRaw.failed === true,
          __modelName: modelName,
          __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        });
      });
    });
  });

  if (cacheKey) {
    usageDetailsCache.set(cacheKey, details);
  }
  return details;
}

export function collectUsageDetailsWithEndpoint(usageData: unknown): UsageDetailWithEndpoint[] {
  const cacheKey = isRecord(usageData) ? (usageData as object) : null;
  if (cacheKey) {
    const cached = usageDetailsWithEndpointCache.get(cacheKey);
    if (cached) return cached;
  }

  const apis = getApisWithFallback(usageData);

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
        const timestampMs = Date.parse(detailRaw.timestamp);
        const tokens = normalizeUsageTokens(detailRaw.tokens);
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
          __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        });
      });
    });
  });

  if (cacheKey) {
    usageDetailsWithEndpointCache.set(cacheKey, details);
  }
  return details;
}
