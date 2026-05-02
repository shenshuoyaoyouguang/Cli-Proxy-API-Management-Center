import type { UsageDetail } from '@/atoms/usage/types';
import { isRecord, getApisRecord } from '@/atoms/usage/guards';

export function normalizeUsageModelNames<T>(
  usageData: T,
  aliasReverseMap: Map<string, string>
): T {
  if (!aliasReverseMap.size) {
    return usageData;
  }

  const usageRecord = isRecord(usageData) ? usageData : null;
  const apis = getApisRecord(usageData);
  if (!usageRecord || !apis) {
    return usageData;
  }

  const normalizedApis: Record<string, unknown> = {};

  Object.entries(apis).forEach(([apiName, apiEntry]) => {
    if (!isRecord(apiEntry)) {
      normalizedApis[apiName] = apiEntry;
      return;
    }

    const models = isRecord(apiEntry.models) ? apiEntry.models : null;
    if (!models) {
      normalizedApis[apiName] = apiEntry;
      return;
    }

    const normalizedModels: Record<string, {
      total_requests: number;
      success_count: number;
      failure_count: number;
      total_tokens: number;
      details: unknown[];
      [key: string]: unknown;
    }> = {};

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) return;

      const canonicalName = aliasReverseMap.get(modelName) ?? modelName;

      if (!normalizedModels[canonicalName]) {
        normalizedModels[canonicalName] = {
          ...modelEntry,
          total_requests: Number(modelEntry.total_requests) || 0,
          success_count: Number(modelEntry.success_count) || 0,
          failure_count: Number(modelEntry.failure_count) || 0,
          total_tokens: Number(modelEntry.total_tokens) || 0,
          details: Array.isArray(modelEntry.details) ? [...modelEntry.details] : [],
        };
      } else {
        normalizedModels[canonicalName].total_requests += Number(modelEntry.total_requests) || 0;
        normalizedModels[canonicalName].success_count += Number(modelEntry.success_count) || 0;
        normalizedModels[canonicalName].failure_count += Number(modelEntry.failure_count) || 0;
        normalizedModels[canonicalName].total_tokens += Number(modelEntry.total_tokens) || 0;

        const details = Array.isArray(modelEntry.details) ? modelEntry.details : [];
        normalizedModels[canonicalName].details.push(...details);
      }
    });

    normalizedApis[apiName] = {
      ...apiEntry,
      models: normalizedModels,
    };
  });

  return {
    ...usageRecord,
    apis: normalizedApis,
  } as T;
}

export function resolveModelNameInDetails(
  details: UsageDetail[],
  aliasReverseMap: Map<string, string>
): UsageDetail[] {
  if (!aliasReverseMap.size) {
    return details;
  }

  return details.map((detail) => {
    const resolvedModelName = aliasReverseMap.get(detail.__modelName ?? '');
    if (resolvedModelName && resolvedModelName !== detail.__modelName) {
      return { ...detail, __modelName: resolvedModelName };
    }
    return detail;
  });
}
