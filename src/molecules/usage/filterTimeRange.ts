import type { UsageTimeRange, UsageDetail } from '@/atoms/usage/types';
import { USAGE_TIME_RANGE_MS } from '@/atoms/usage/time';
import { getDetailTimestampMs } from '@/atoms/usage/time';
import { isRecord, getApisRecord } from '@/atoms/usage/guards';
import { extractCanonicalTotalTokens } from '@/atoms/usage/tokens';
import type { UsageSummary } from '@/atoms/usage/types';

function createUsageSummary(): UsageSummary {
  return {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    totalTokens: 0,
  };
}

function toUsageSummaryFields(summary: UsageSummary) {
  return {
    total_requests: summary.totalRequests,
    success_count: summary.successCount,
    failure_count: summary.failureCount,
    total_tokens: summary.totalTokens,
  };
}

export function filterUsageByTimeRange<T>(
  usageData: T,
  range: UsageTimeRange,
  nowMs: number = Date.now()
): T {
  if (range === 'all') {
    return usageData;
  }

  const usageRecord = isRecord(usageData) ? usageData : null;
  const apis = getApisRecord(usageData);
  if (!usageRecord || !apis) {
    return usageData;
  }

  const rangeMs = USAGE_TIME_RANGE_MS[range];
  if (!Number.isFinite(rangeMs) || rangeMs <= 0) {
    return usageData;
  }

  const windowStart = nowMs - rangeMs;
  const filteredApis: Record<string, unknown> = {};
  const totalSummary = createUsageSummary();

  Object.entries(apis).forEach(([apiName, apiEntry]) => {
    if (!isRecord(apiEntry)) {
      return;
    }

    const models = isRecord(apiEntry.models) ? apiEntry.models : null;
    if (!models) {
      return;
    }

    const filteredModels: Record<string, unknown> = {};
    const apiSummary = createUsageSummary();
    let hasModelData = false;

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) {
        return;
      }

      const detailsRaw = Array.isArray(modelEntry.details) ? modelEntry.details : [];
      const modelSummary = createUsageSummary();
      const filteredDetails: unknown[] = [];

      detailsRaw.forEach((detail) => {
        const detailRecord = isRecord(detail) ? detail : null;
        if (!detailRecord || typeof detailRecord.timestamp !== 'string') {
          return;
        }
        const timestamp = Date.parse(detailRecord.timestamp);
        if (Number.isNaN(timestamp) || timestamp < windowStart || timestamp > nowMs) {
          return;
        }

        filteredDetails.push(detail);
        modelSummary.totalRequests += 1;
        if (detailRecord.failed === true) {
          modelSummary.failureCount += 1;
        } else {
          modelSummary.successCount += 1;
        }
        modelSummary.totalTokens += extractCanonicalTotalTokens(detailRecord.tokens ?? detailRecord);
      });

      if (!filteredDetails.length) {
        return;
      }

      filteredModels[modelName] = {
        ...modelEntry,
        ...toUsageSummaryFields(modelSummary),
        details: filteredDetails,
      };
      hasModelData = true;

      apiSummary.totalRequests += modelSummary.totalRequests;
      apiSummary.successCount += modelSummary.successCount;
      apiSummary.failureCount += modelSummary.failureCount;
      apiSummary.totalTokens += modelSummary.totalTokens;
    });

    if (!hasModelData) {
      return;
    }

    filteredApis[apiName] = {
      ...apiEntry,
      ...toUsageSummaryFields(apiSummary),
      models: filteredModels,
    };

    totalSummary.totalRequests += apiSummary.totalRequests;
    totalSummary.successCount += apiSummary.successCount;
    totalSummary.failureCount += apiSummary.failureCount;
    totalSummary.totalTokens += apiSummary.totalTokens;
  });

  return {
    ...usageRecord,
    ...toUsageSummaryFields(totalSummary),
    apis: filteredApis,
  } as T;
}

export function filterUsageDetailsByTimeRange(
  details: UsageDetail[],
  range: UsageTimeRange,
  nowMs: number = Date.now()
): UsageDetail[] {
  if (range === 'all') {
    return details;
  }

  const rangeMs = USAGE_TIME_RANGE_MS[range];
  if (!Number.isFinite(rangeMs) || rangeMs <= 0 || !Number.isFinite(nowMs) || nowMs <= 0) {
    return details;
  }

  const windowStart = nowMs - rangeMs;
  return details.filter((detail) => {
    const timestamp = getDetailTimestampMs(detail);
    return Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= nowMs;
  });
}
