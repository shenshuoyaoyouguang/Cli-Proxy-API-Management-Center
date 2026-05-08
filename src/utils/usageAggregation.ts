import { getUsageDetailTotalTokenCount, hasUsageTokenEvidence } from '@/atoms/usage/tokens';
import { getApisRecord, isRecord } from '@/utils/usageRecord';

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

const getResolvedAggregateValue = (
  explicitValue: unknown,
  derivedValue: number,
  preferDerived: boolean
): number => (preferDerived ? derivedValue : toFiniteNonNegativeNumber(explicitValue));

export function rehydrateUsageAggregatesFromDetails<T>(usageData: T): T {
  const usageRecord = isRecord(usageData) ? usageData : null;
  const apis = getApisRecord(usageData);
  if (!usageRecord || !apis) {
    return usageData;
  }

  const nextApis: Record<string, unknown> = {};
  let derivedTotalRequests = 0;
  let derivedSuccessCount = 0;
  let derivedFailureCount = 0;
  let derivedTotalTokens = 0;

  Object.entries(apis).forEach(([apiName, apiEntry]) => {
    if (!isRecord(apiEntry)) {
      nextApis[apiName] = apiEntry;
      return;
    }

    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) {
      nextApis[apiName] = apiEntry;
      return;
    }

    const nextModels: Record<string, unknown> = {};
    let apiDerivedRequests = 0;
    let apiDerivedSuccess = 0;
    let apiDerivedFailure = 0;
    let apiDerivedTokens = 0;

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) {
        nextModels[modelName] = modelEntry;
        return;
      }

      const details = Array.isArray(modelEntry.details) ? modelEntry.details : [];
      const derivedRequests = details.length;
      const derivedFailure = details.reduce(
        (count, detail) => count + (isRecord(detail) && detail.failed === true ? 1 : 0),
        0
      );
      const derivedSuccess = Math.max(derivedRequests - derivedFailure, 0);
      const derivedTokens = getResolvedModelTokens(modelEntry, details);
      const hasDerivedDetails = details.length > 0;

      const totalRequests = getResolvedAggregateValue(
        modelEntry.total_requests,
        derivedRequests,
        hasDerivedDetails
      );
      const successCount = getResolvedAggregateValue(
        modelEntry.success_count,
        derivedSuccess,
        hasDerivedDetails
      );
      const failureCount = getResolvedAggregateValue(
        modelEntry.failure_count,
        derivedFailure,
        hasDerivedDetails
      );
      const totalTokens = getResolvedAggregateValue(
        modelEntry.total_tokens,
        derivedTokens,
        hasDerivedDetails
      );

      nextModels[modelName] = {
        ...modelEntry,
        total_requests: totalRequests,
        success_count: successCount,
        failure_count: failureCount,
        total_tokens: totalTokens,
        details,
      };

      apiDerivedRequests += totalRequests;
      apiDerivedSuccess += successCount;
      apiDerivedFailure += failureCount;
      apiDerivedTokens += totalTokens;
    });

    const hasResolvedModels = Object.keys(nextModels).length > 0;
    const apiTotalRequests = hasResolvedModels
      ? apiDerivedRequests
      : toFiniteNonNegativeNumber(apiEntry.total_requests);
    const apiSuccessCount = hasResolvedModels
      ? apiDerivedSuccess
      : toFiniteNonNegativeNumber(apiEntry.success_count);
    const apiFailureCount = hasResolvedModels
      ? apiDerivedFailure
      : toFiniteNonNegativeNumber(apiEntry.failure_count);
    const apiTotalTokens = hasResolvedModels
      ? apiDerivedTokens
      : toFiniteNonNegativeNumber(apiEntry.total_tokens);

    nextApis[apiName] = {
      ...apiEntry,
      total_requests: apiTotalRequests,
      success_count: apiSuccessCount,
      failure_count: apiFailureCount,
      total_tokens: apiTotalTokens,
      models: nextModels,
    };

    derivedTotalRequests += apiTotalRequests;
    derivedSuccessCount += apiSuccessCount;
    derivedFailureCount += apiFailureCount;
    derivedTotalTokens += apiTotalTokens;
  });

  return {
    ...usageRecord,
    total_requests:
      Object.keys(nextApis).length > 0
        ? derivedTotalRequests
        : toFiniteNonNegativeNumber(usageRecord.total_requests),
    success_count:
      Object.keys(nextApis).length > 0
        ? derivedSuccessCount
        : toFiniteNonNegativeNumber(usageRecord.success_count),
    failure_count:
      Object.keys(nextApis).length > 0
        ? derivedFailureCount
        : toFiniteNonNegativeNumber(usageRecord.failure_count),
    total_tokens:
      Object.keys(nextApis).length > 0
        ? derivedTotalTokens
        : toFiniteNonNegativeNumber(usageRecord.total_tokens),
    apis: nextApis,
  } as T;
}
