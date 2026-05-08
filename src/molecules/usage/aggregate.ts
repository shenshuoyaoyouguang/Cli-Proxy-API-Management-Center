import type { UsageDetail, KeyStats, KeyStatBucket, ApiStats, ModelPrice } from '@/atoms/usage/types';
import { isRecord, getApisRecord, normalizeAuthIndex } from '@/atoms/usage/guards';
import { normalizeUsageSourceId, maskUsageSensitiveValue } from '@/atoms/usage/source';
import {
  getUsageDetailTotalTokenCount,
  hasUsageTokenEvidence,
  normalizeUsageDetailTokens,
} from '@/atoms/usage/tokens';
import { calculateCost } from '@/atoms/usage/cost';
import { rehydrateUsageAggregatesFromDetails } from '@/utils/usageAggregation';

export { rehydrateUsageAggregatesFromDetails } from '@/utils/usageAggregation';

function ensureBucket(bucket: Record<string, KeyStatBucket>, key: string): KeyStatBucket {
  if (!bucket[key]) {
    bucket[key] = { success: 0, failure: 0 };
  }
  return bucket[key];
}

const toFiniteNonNegativeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
};

const getDerivedDetailTokensTotal = (details: unknown[]): number =>
  details.reduce<number>((sum, detail) => sum + getUsageDetailTotalTokenCount(detail), 0);

const getResolvedModelTokens = (modelData: Record<string, unknown>, details: unknown[]): number => {
  const explicitTokens = toFiniteNonNegativeNumber(modelData.total_tokens);
  if (!details.length) {
    return explicitTokens;
  }

  const derivedTokens = getDerivedDetailTokensTotal(details);
  const hasTokenData = details.some((detail) => hasUsageTokenEvidence(detail));
  return hasTokenData || explicitTokens === 0 ? derivedTokens : explicitTokens;
};

export function createAggregateOnlyUsageSnapshot<T>(usageData: T): T {
  const hydrated = rehydrateUsageAggregatesFromDetails(usageData);
  const usageRecord = isRecord(hydrated) ? hydrated : null;
  const apis = getApisRecord(hydrated);
  if (!usageRecord || !apis) {
    return hydrated;
  }

  const nextApis: Record<string, unknown> = {};
  Object.entries(apis).forEach(([apiName, apiEntry]) => {
    if (!isRecord(apiEntry)) {
      nextApis[apiName] = apiEntry;
      return;
    }

    const models = isRecord(apiEntry.models) ? apiEntry.models : null;
    if (!models) {
      nextApis[apiName] = apiEntry;
      return;
    }

    const nextModels: Record<string, unknown> = {};
    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) {
        nextModels[modelName] = modelEntry;
        return;
      }

      nextModels[modelName] = {
        ...modelEntry,
        details: [],
      };
    });

    nextApis[apiName] = {
      ...apiEntry,
      models: nextModels,
    };
  });

  return {
    ...usageRecord,
    apis: nextApis,
  } as T;
}

export function computeKeyStats(
  usageData: unknown,
  masker: (val: string) => string = (val) => val
): KeyStats {
  const apis = getApisRecord(usageData);
  if (!apis) {
    return { bySource: {}, byAuthIndex: {} };
  }

  const sourceStats: Record<string, KeyStatBucket> = {};
  const authIndexStats: Record<string, KeyStatBucket> = {};

  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.values(models).forEach((modelEntry) => {
      if (!isRecord(modelEntry)) return;
      const details = Array.isArray(modelEntry.details) ? modelEntry.details : [];

      details.forEach((detail) => {
        const detailRecord = isRecord(detail) ? detail : null;
        const source = normalizeUsageSourceId(detailRecord?.source, masker);
        const authIndexKey = normalizeAuthIndex(detailRecord?.auth_index);
        const isFailed = detailRecord?.failed === true;

        if (source) {
          const bucket = ensureBucket(sourceStats, source);
          if (isFailed) {
            bucket.failure += 1;
          } else {
            bucket.success += 1;
          }
        }

        if (authIndexKey !== null) {
          const bucket = ensureBucket(authIndexStats, authIndexKey);
          if (isFailed) {
            bucket.failure += 1;
          } else {
            bucket.success += 1;
          }
        }
      });
    });
  });

  return {
    bySource: sourceStats,
    byAuthIndex: authIndexStats,
  };
}

export function computeKeyStatsFromDetails(usageDetails: UsageDetail[]): KeyStats {
  const bySource: Record<string, KeyStatBucket> = {};
  const byAuthIndex: Record<string, KeyStatBucket> = {};

  usageDetails.forEach((detail) => {
    const source = detail.source;
    const authIndexKey = normalizeAuthIndex(detail.auth_index);
    const isFailed = detail.failed === true;

    if (source) {
      const bucket = ensureBucket(bySource, source);
      if (isFailed) {
        bucket.failure += 1;
      } else {
        bucket.success += 1;
      }
    }

    if (authIndexKey !== null) {
      const bucket = ensureBucket(byAuthIndex, authIndexKey);
      if (isFailed) {
        bucket.failure += 1;
      } else {
        bucket.success += 1;
      }
    }
  });

  return { bySource, byAuthIndex };
}

export function getApiStats(
  usageData: unknown,
  modelPrices: Record<string, ModelPrice>
): ApiStats[] {
  const apis = getApisRecord(usageData);
  if (!apis) return [];
  const result: ApiStats[] = [];

  Object.entries(apis).forEach(([endpoint, apiData]) => {
    if (!isRecord(apiData)) return;
    const models: Record<
      string,
      { requests: number; successCount: number; failureCount: number; tokens: number }
    > = {};
    let derivedSuccessCount = 0;
    let derivedFailureCount = 0;
    let derivedTotalTokens = 0;
    let totalCost = 0;

    const modelsData = isRecord(apiData.models) ? apiData.models : {};
    Object.entries(modelsData).forEach(([modelName, modelData]) => {
      if (!isRecord(modelData)) return;
      const details = Array.isArray(modelData.details) ? modelData.details : [];
      const hasExplicitCounts =
        typeof modelData.success_count === 'number' || typeof modelData.failure_count === 'number';

      let successCount = 0;
      let failureCount = 0;
      if (hasExplicitCounts) {
        successCount += Number(modelData.success_count) || 0;
        failureCount += Number(modelData.failure_count) || 0;
      }

      const price = modelPrices[modelName];
      if (details.length > 0 && (!hasExplicitCounts || price)) {
        details.forEach((detail) => {
          const detailRecord = isRecord(detail) ? detail : null;
          if (!hasExplicitCounts) {
            if (detailRecord?.failed === true) {
              failureCount += 1;
            } else {
              successCount += 1;
            }
          }

          if (price && detailRecord) {
            totalCost += calculateCost(
              {
                tokens: normalizeUsageDetailTokens(detailRecord),
                __modelName: modelName,
              },
              modelPrices
            );
          }
        });
      }

      const modelTokens = getResolvedModelTokens(modelData, details);

      models[modelName] = {
        requests: Number(modelData.total_requests) || 0,
        successCount,
        failureCount,
        tokens: modelTokens,
      };
      derivedSuccessCount += successCount;
      derivedFailureCount += failureCount;
      derivedTotalTokens += modelTokens;
    });

    const hasModelEntries = Object.keys(models).length > 0;
    const successCount = hasModelEntries
      ? derivedSuccessCount
      : Number(apiData.success_count) || 0;
    const failureCount = hasModelEntries
      ? derivedFailureCount
      : Number(apiData.failure_count) || 0;
    const totalRequests = hasModelEntries
      ? Object.values(models).reduce((sum, model) => sum + model.requests, 0)
      : Number(apiData.total_requests) || 0;
    const totalTokens = hasModelEntries
      ? derivedTotalTokens
      : Number(apiData.total_tokens) || 0;

    result.push({
      endpoint: maskUsageSensitiveValue(endpoint),
      totalRequests,
      successCount,
      failureCount,
      totalTokens,
      totalCost,
      models,
    });
  });

  return result;
}

export function getModelStats(
  usageData: unknown,
  modelPrices: Record<string, ModelPrice>
): Array<{
  model: string;
  requests: number;
  successCount: number;
  failureCount: number;
  tokens: number;
  cost: number;
  __details?: UsageDetail[];
}> {
  const apis = getApisRecord(usageData);
  if (!apis) return [];

  const modelMap = new Map<
    string,
    { requests: number; successCount: number; failureCount: number; tokens: number; cost: number }
  >();

  Object.values(apis).forEach((apiData) => {
    if (!isRecord(apiData)) return;
    const modelsRaw = apiData.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.entries(models).forEach(([modelName, modelData]) => {
      if (!isRecord(modelData)) return;
      const existing = modelMap.get(modelName) || {
        requests: 0,
        successCount: 0,
        failureCount: 0,
        tokens: 0,
        cost: 0,
      };
      existing.requests += Number(modelData.total_requests) || 0;

      const details = Array.isArray(modelData.details) ? modelData.details : [];
      existing.tokens += getResolvedModelTokens(modelData, details);

      const price = modelPrices[modelName];

      const hasExplicitCounts =
        typeof modelData.success_count === 'number' || typeof modelData.failure_count === 'number';
      if (hasExplicitCounts) {
        existing.successCount += Number(modelData.success_count) || 0;
        existing.failureCount += Number(modelData.failure_count) || 0;
      }

      if (details.length > 0 && (!hasExplicitCounts || price)) {
        details.forEach((detail) => {
          const detailRecord = isRecord(detail) ? detail : null;
          if (!hasExplicitCounts) {
            if (detailRecord?.failed === true) {
              existing.failureCount += 1;
            } else {
              existing.successCount += 1;
            }
          }

          if (price && detailRecord) {
            existing.cost += calculateCost(
              {
                tokens: normalizeUsageDetailTokens(detailRecord),
                __modelName: modelName,
              },
              modelPrices
            );
          }
        });
      }
      modelMap.set(modelName, existing);
    });
  });

  return Array.from(modelMap.entries())
    .map(([model, stats]) => ({ model, ...stats }))
    .sort((a, b) => b.requests - a.requests);
}
