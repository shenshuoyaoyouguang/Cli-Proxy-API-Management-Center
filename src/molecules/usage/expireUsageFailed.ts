import type { UsageDetail } from '@/atoms/usage/types';
import { expireFailedDetails, FAILED_DETAIL_TTL_MS } from '@/atoms/usage/expireFailed';
import { rehydrateUsageAggregatesFromDetails } from '@/molecules/usage/aggregate';
import { isRecord, getApisRecord } from '@/atoms/usage/guards';
import { getDetailTimestampMs } from '@/atoms/usage/time';

export type ExpireUsageFailedResult = {
  usage: Record<string, unknown> | null;
  usageDetails: UsageDetail[];
  removedCount: number;
  topLevelRemovedCount: number;
};

type UsageSnapshot = Record<string, unknown>;

/**
 * 清理 usage 快照内嵌的 details[] 中过期的失败记录，并重水合聚合计数。
 * 注意：此函数会浅复制 usage 对象，不修改原始引用。
 */
function cleanUsageSnapshotDetails(
  usage: UsageSnapshot | null,
  ttlMs: number
): { usage: UsageSnapshot | null; removedCount: number } {
  if (!usage) return { usage: null, removedCount: 0 };

  const apis = getApisRecord(usage);
  if (!apis) return { usage, removedCount: 0 };

  const cutoff = Date.now() - ttlMs;
  let totalRemoved = 0;

  const nextApis: Record<string, unknown> = {};

  for (const [apiName, apiEntry] of Object.entries(apis)) {
    if (!isRecord(apiEntry)) {
      nextApis[apiName] = apiEntry;
      continue;
    }

    const models = isRecord(apiEntry.models) ? apiEntry.models : null;
    if (!models) {
      nextApis[apiName] = apiEntry;
      continue;
    }

    const nextModels: Record<string, unknown> = {};

    for (const [modelName, modelEntry] of Object.entries(models)) {
      if (!isRecord(modelEntry)) {
        nextModels[modelName] = modelEntry;
        continue;
      }

      const details = Array.isArray(modelEntry.details) ? modelEntry.details : [];
      if (details.length === 0) {
        nextModels[modelName] = modelEntry;
        continue;
      }

      const cleanedDetails = details.filter((detail) => {
        if (!isRecord(detail) || detail.failed !== true) return true;

        const ts = getDetailTimestampMs({
          timestamp: typeof detail.timestamp === 'string' ? detail.timestamp : '',
          __timestampMs:
            typeof detail.__timestampMs === 'number' && Number.isFinite(detail.__timestampMs)
              ? detail.__timestampMs
              : undefined,
        });
        if (!Number.isFinite(ts)) return true;

        if (ts < cutoff) {
          totalRemoved += 1;
          return false;
        }
        return true;
      });

      nextModels[modelName] =
        cleanedDetails.length !== details.length
          ? { ...modelEntry, details: cleanedDetails }
          : modelEntry;
    }

    nextApis[apiName] = { ...apiEntry, models: nextModels };
  }

  const nextUsage: UsageSnapshot = { ...usage, apis: nextApis };
  // 清理了内嵌 details 后，重水合聚合计数
  const rehydrated = rehydrateUsageAggregatesFromDetails(nextUsage);

  return { usage: rehydrated, removedCount: totalRemoved };
}

/**
 * 组合清理：顶层 usageDetails + usage 快照内嵌 details[]。
 * 仅在页面加载 / 数据恢复时调用。
 */
export function expireUsageFailed(
  usage: UsageSnapshot | null,
  usageDetails: UsageDetail[],
  ttlMs: number = FAILED_DETAIL_TTL_MS
): ExpireUsageFailedResult {
  const { details: cleanedDetails, removedCount: topLevelRemoved } =
    expireFailedDetails(usageDetails, ttlMs);

  const { usage: cleanedUsage, removedCount: nestedRemoved } =
    cleanUsageSnapshotDetails(usage, ttlMs);

  return {
    usage: cleanedUsage,
    usageDetails: cleanedDetails,
    removedCount: topLevelRemoved + nestedRemoved,
    topLevelRemovedCount: topLevelRemoved,
  };
}