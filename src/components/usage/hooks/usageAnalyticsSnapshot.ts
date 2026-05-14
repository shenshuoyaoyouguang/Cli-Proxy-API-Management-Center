import type { MutableRefObject } from 'react';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  buildCandidateUsageSourceIds,
  calculateCost,
  kahanAdd,
  extractTotalTokens,
  normalizeAuthIndex,
  type ApiStats,
  type KahanAccumulator,
  type ModelPrice,
  type UsageDetail,
  type UsageTimeRange,
} from '@/utils/usage';
import {
  resolveSourceDisplay,
  type SourceInfoMap,
  type SourceInfoMapInput,
} from '@/utils/sourceResolver';
import { FUTURE_TIMESTAMP_TOLERANCE_MS, USAGE_TIME_RANGE_MS } from '@/atoms/usage/time';
import { parseTimestampMs } from '@/utils/timestamp';

const RUNTIME_QUALITY_HEALTHY_SUCCESS_RATE = 0.99;
const RUNTIME_QUALITY_CRITICAL_SUCCESS_RATE = 0.97;
const RUNTIME_QUALITY_WINDOW_MS = 15 * 60 * 1000;
const RUNTIME_QUALITY_MIN_WINDOW_REQUESTS = 15;
const RUNTIME_QUALITY_SEVERE_WINDOW_SUCCESS_RATE = 0.9;
const RUNTIME_QUALITY_AFFECTED_CREDENTIAL_SUCCESS_RATE = 95;
const RUNTIME_QUALITY_AFFECTED_CREDENTIAL_MIN_REQUESTS = 30;
const RUNTIME_QUALITY_AFFECTED_ENDPOINT_FAILURE_RATE = 0.05;
const RUNTIME_QUALITY_AFFECTED_ENDPOINT_MIN_REQUESTS = 20;
const RUNTIME_QUALITY_AFFECTED_MODEL_FAILURE_RATE = 0.05;
const RUNTIME_QUALITY_AFFECTED_MODEL_MIN_REQUESTS = 20;

export interface RequestEventRow {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  model: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  failed: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface CredentialRow {
  key: string;
  displayName: string;
  type: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
}

export interface TokenDistribution {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
}

export interface UsageSummaryMetrics {
  totalTokens: number;
  tokenBreakdown: {
    cachedTokens: number;
    reasoningTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
  rateStats: {
    rpm: number;
    tpm: number;
    windowMinutes: number;
    requestCount: number;
    tokenCount: number;
    peakRpm: number;
    peakTpm: number;
    avgRpm: number;
    avgTpm: number;
  };
  totalCost: number;
}

export type RuntimeQualityStatus = 'healthy' | 'warning' | 'critical' | 'insufficient' | 'empty';
export type RuntimeIncidentType = 'credential' | 'endpoint' | 'model' | 'none';

export interface RuntimeQualityPrimaryIncident {
  type: RuntimeIncidentType;
  name: string;
  failureCount: number;
  failureRate: number;
  totalRequests: number;
}

export interface RuntimeModelStat {
  model: string;
  requests: number;
  successCount: number;
  failureCount: number;
}

export interface RuntimeQualitySummary {
  hasData: boolean;
  status: RuntimeQualityStatus;
  overallSuccessRate: number;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  windowsInsufficient: boolean;
  dataConsistent: boolean;
  abnormalWindowCount: number;
  severeWindowCount: number;
  affectedCredentialCount: number;
  affectedEndpointCount: number;
  affectedModelCount: number;
  primaryIncident: RuntimeQualityPrimaryIncident;
}

export type EfficiencySignal =
  | 'high_failure_waste'
  | 'low_cache_reuse'
  | 'low_output_yield'
  | 'cost_not_enabled'
  | 'low_cost_yield';

export interface EfficiencyOverview {
  hasData: boolean;
  requestCount: number;
  totalTokens: number;
  efficiencyScore: number;
  grade: 'A' | 'B' | 'C' | 'D';
  signals: EfficiencySignal[];
  costEnabled: boolean;
  metrics: {
    cacheReuseRate: number;
    outputYield: number;
    failureWasteRate: number;
    costYield: number | null;
  };
}

export interface ModelEfficiencyRow {
  model: string;
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  cacheReuseRate: number;
  outputYield: number;
  failureWasteRate: number;
  costYield: number | null;
  efficiencyScore: number;
}

export interface CredentialEfficiencyRow {
  key: string;
  displayName: string;
  type: string;
  filterSource: string;
  filterSourceRaw: string | null;
  filterAuthIndex: string | null;
  requests: number;
  success: number;
  failure: number;
  successRate: number;
  totalTokens: number;
  cacheReuseRate: number;
  outputYield: number;
  failureWasteRate: number;
  costYield: number | null;
  efficiencyScore: number;
}

interface CredentialBucket {
  success: number;
  failure: number;
}

type ProviderConfigs = Pick<
  SourceInfoMapInput,
  'geminiApiKeys' | 'claudeApiKeys' | 'codexApiKeys' | 'vertexApiKeys' | 'openaiCompatibility'
>;

interface RuntimeUsageSummaryInput {
  total_requests?: unknown;
  success_count?: unknown;
  failure_count?: unknown;
}

interface EfficiencyAggregate {
  requests: number;
  successCount: number;
  failureCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  failureTokens: number;
  totalCost: number;
}

export interface IncrementalCache<T> {
  result: T;
  prevSource: unknown[];
  computedCount: number;
}

export function incrementalAppend<T>(
  source: unknown[],
  cache: MutableRefObject<IncrementalCache<T> | null>,
  compute: (items: unknown[]) => T,
  merge: (prev: T, delta: T) => T
): T {
  const prev = cache.current;
  if (!prev || prev.prevSource !== source) {
    const result = compute(source);
    cache.current = { result, prevSource: source, computedCount: source.length };
    return result;
  }

  const prevLen = prev.computedCount;
  const newLen = source.length;
  if (newLen === prevLen) return prev.result;
  if (newLen < prevLen) {
    const result = compute(source);
    cache.current = { result, prevSource: source, computedCount: newLen };
    return result;
  }

  const newItems = source.slice(prevLen);
  const delta = compute(newItems);
  const result = prevLen === 0 ? delta : merge(prev.result, delta);
  cache.current = { result, prevSource: source, computedCount: newLen };
  return result;
}

const CACHE_REUSE_TARGET = 0.5;
const OUTPUT_YIELD_TARGET = 0.3;
const FAILURE_WASTE_BAD_THRESHOLD = 0.2;
const COST_YIELD_TARGET = 50_000;

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getDetailTimestampMs = (detail: UsageDetail) => {
  if (typeof detail.__timestampMs === 'number' && Number.isFinite(detail.__timestampMs)) {
    return detail.__timestampMs;
  }

  return parseTimestampMs(detail.timestamp);
};

const toSortableTimestampMs = (timestampMs: number) =>
  Number.isFinite(timestampMs) ? timestampMs : Number.NEGATIVE_INFINITY;

const createEmptyPrimaryIncident = (): RuntimeQualityPrimaryIncident => ({
  type: 'none',
  name: '',
  failureCount: 0,
  failureRate: 0,
  totalRequests: 0,
});

const getFailureRate = (failureCount: number, totalRequests: number) =>
  totalRequests > 0 ? failureCount / totalRequests : 0;

const comparePrimaryIncidents = (
  left: RuntimeQualityPrimaryIncident,
  right: RuntimeQualityPrimaryIncident
) => {
  if (left.failureCount !== right.failureCount) {
    return right.failureCount - left.failureCount;
  }

  if (left.failureRate !== right.failureRate) {
    return right.failureRate - left.failureRate;
  }

  return right.totalRequests - left.totalRequests;
};

const isAnthropicModel = (modelName: string): boolean => {
  const lowerModel = modelName.toLowerCase();
  return lowerModel.includes('claude') || lowerModel.includes('anthropic');
};

const getCachedTokens = (
  tokens: UsageDetail['tokens'] | undefined,
  modelName: string = ''
): number => {
  const cachedTokens = typeof tokens?.cached_tokens === 'number' ? Math.max(tokens.cached_tokens, 0) : 0;
  const cacheTokens = typeof tokens?.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0;

  if (isAnthropicModel(modelName)) {
    return cacheTokens;
  }
  return cachedTokens;
};

const createEmptyEfficiencyAggregate = (): EfficiencyAggregate => ({
  requests: 0,
  successCount: 0,
  failureCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  failureTokens: 0,
  totalCost: 0,
});

const accumulateEfficiencyAggregate = (
  aggregate: EfficiencyAggregate,
  detail: UsageDetail,
  modelPrices: Record<string, ModelPrice>,
  costAcc?: KahanAccumulator
): EfficiencyAggregate => {
  const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
  const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
  const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
  const modelName = String(detail.__modelName ?? '').trim();
  const cachedTokens = getCachedTokens(detail.tokens, modelName);
  const totalTokens = Math.max(toNumber(detail.tokens?.total_tokens), extractTotalTokens(detail));
  const failed = detail.failed === true;

  const cost = calculateCost({ ...detail, __modelName: modelName }, modelPrices);
  if (costAcc) {
    kahanAdd(costAcc, cost);
  }

  return {
    requests: aggregate.requests + 1,
    successCount: aggregate.successCount + (failed ? 0 : 1),
    failureCount: aggregate.failureCount + (failed ? 1 : 0),
    inputTokens: aggregate.inputTokens + inputTokens,
    outputTokens: aggregate.outputTokens + outputTokens,
    reasoningTokens: aggregate.reasoningTokens + reasoningTokens,
    cachedTokens: aggregate.cachedTokens + cachedTokens,
    totalTokens: aggregate.totalTokens + totalTokens,
    failureTokens: aggregate.failureTokens + (failed ? totalTokens : 0),
    totalCost: costAcc ? costAcc.sum : aggregate.totalCost + cost,
  };
};

const aggregateEfficiencyDetails = (
  details: UsageDetail[],
  modelPrices: Record<string, ModelPrice>
): EfficiencyAggregate =>
  details.reduce(
    (aggregate, detail) => accumulateEfficiencyAggregate(aggregate, detail, modelPrices),
    createEmptyEfficiencyAggregate()
  );

const scorePositiveMetric = (value: number, target: number): number => {
  if (!Number.isFinite(value) || target <= 0) {
    return 0;
  }
  return Math.round(Math.min((value / target) * 100, 100));
};

const scoreInverseMetric = (value: number, badThreshold: number): number => {
  if (!Number.isFinite(value) || badThreshold <= 0) {
    return 100;
  }
  return Math.round(Math.max(0, (1 - value / badThreshold) * 100));
};

const getEfficiencyGrade = (score: number): EfficiencyOverview['grade'] => {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
};

const calculateEfficiencyOverview = (aggregate: EfficiencyAggregate): EfficiencyOverview => {
  const hasData = aggregate.requests > 0;
  const totalInputTokens = aggregate.inputTokens + aggregate.cachedTokens;
  const cacheReuseRate = totalInputTokens > 0 ? aggregate.cachedTokens / totalInputTokens : 0;
  const outputYield =
    aggregate.totalTokens > 0 ? aggregate.outputTokens / aggregate.totalTokens : 0;
  const failureWasteRate =
    aggregate.totalTokens > 0 ? aggregate.failureTokens / aggregate.totalTokens : 0;
  const costYield = aggregate.totalCost > 0 ? aggregate.outputTokens / aggregate.totalCost : null;

  const costEnabled = costYield !== null;
  const costScore = costYield === null ? 50 : scorePositiveMetric(costYield, COST_YIELD_TARGET);

  const metricScores = [
    {
      enabled: hasData,
      weight: 25,
      score: scorePositiveMetric(cacheReuseRate, CACHE_REUSE_TARGET),
    },
    { enabled: hasData, weight: 25, score: scorePositiveMetric(outputYield, OUTPUT_YIELD_TARGET) },
    {
      enabled: hasData,
      weight: 30,
      score: scoreInverseMetric(failureWasteRate, FAILURE_WASTE_BAD_THRESHOLD),
    },
    { enabled: true, weight: 20, score: costScore },
  ];

  const totalWeight = metricScores.reduce(
    (sum, metric) => sum + (metric.enabled ? metric.weight : 0),
    0
  );
  const weightedScore =
    totalWeight > 0
      ? Math.round(
          metricScores.reduce(
            (sum, metric) => sum + (metric.enabled ? metric.score * metric.weight : 0),
            0
          ) / totalWeight
        )
      : 0;

  const signals: EfficiencySignal[] = [];
  if (failureWasteRate >= 0.15) signals.push('high_failure_waste');
  if (cacheReuseRate < 0.25) signals.push('low_cache_reuse');
  if (outputYield < 0.2) signals.push('low_output_yield');
  if (costYield === null) {
    signals.push('cost_not_enabled');
  } else if (costYield < COST_YIELD_TARGET * 0.5) {
    signals.push('low_cost_yield');
  }

  return {
    hasData,
    requestCount: aggregate.requests,
    totalTokens: aggregate.totalTokens,
    efficiencyScore: weightedScore,
    grade: getEfficiencyGrade(weightedScore),
    signals,
    costEnabled,
    metrics: {
      cacheReuseRate,
      outputYield,
      failureWasteRate,
      costYield,
    },
  };
};

const resolveRuntimeRequestSummary = (
  usage: RuntimeUsageSummaryInput | null,
  details: UsageDetail[]
) => {
  const derivedFailureCount = details.reduce(
    (count, detail) => count + (detail.failed === true ? 1 : 0),
    0
  );
  const derivedTotalRequests = details.length;
  const derivedSuccessCount = Math.max(derivedTotalRequests - derivedFailureCount, 0);

  const hasUsageTotal =
    typeof usage?.total_requests === 'number' && Number.isFinite(usage.total_requests);
  const hasUsageSuccess =
    typeof usage?.success_count === 'number' && Number.isFinite(usage.success_count);
  const hasUsageFailure =
    typeof usage?.failure_count === 'number' && Number.isFinite(usage.failure_count);

  if (!hasUsageTotal && !hasUsageSuccess && !hasUsageFailure) {
    return {
      totalRequests: derivedTotalRequests,
      successCount: derivedSuccessCount,
      failureCount: derivedFailureCount,
      usedDerivedValues: true,
    };
  }

  const usageTotal = hasUsageTotal ? Math.max(toNumber(usage?.total_requests), 0) : null;
  const usageFailure = hasUsageFailure ? Math.max(toNumber(usage?.failure_count), 0) : null;
  const usageSuccess = hasUsageSuccess ? Math.max(toNumber(usage?.success_count), 0) : null;

  let isUsageConsistent = true;
  if (usageTotal !== null && usageFailure !== null && usageSuccess !== null) {
    isUsageConsistent = usageSuccess + usageFailure === usageTotal;
  } else if (usageTotal !== null && usageFailure !== null && usageFailure > usageTotal) {
    isUsageConsistent = false;
  }

  if (!isUsageConsistent && details.length > 0) {
    return {
      totalRequests: derivedTotalRequests,
      successCount: derivedSuccessCount,
      failureCount: derivedFailureCount,
      usedDerivedValues: true,
    };
  }

  const totalRequests = usageTotal ?? derivedTotalRequests;
  const failureCount = usageFailure ?? derivedFailureCount;
  const successCount = usageSuccess ?? Math.max(totalRequests - failureCount, 0);

  return {
    totalRequests,
    successCount,
    failureCount,
    usedDerivedValues: false,
  };
};

const countRuntimeQualityWindows = (details: UsageDetail[]) => {
  const windowBuckets = new Map<number, { success: number; failure: number }>();

  details.forEach((detail) => {
    const timestamp = getDetailTimestampMs(detail);
    if (!Number.isFinite(timestamp)) {
      return;
    }

    const bucketKey = Math.floor(timestamp / RUNTIME_QUALITY_WINDOW_MS);
    const bucket = windowBuckets.get(bucketKey) ?? { success: 0, failure: 0 };

    if (detail.failed === true) {
      bucket.failure += 1;
    } else {
      bucket.success += 1;
    }

    windowBuckets.set(bucketKey, bucket);
  });

  let abnormalWindowCount = 0;
  let severeWindowCount = 0;

  windowBuckets.forEach((bucket) => {
    const totalRequests = bucket.success + bucket.failure;
    if (totalRequests < RUNTIME_QUALITY_MIN_WINDOW_REQUESTS) {
      return;
    }

    const successRate = bucket.success / totalRequests;
    if (successRate < RUNTIME_QUALITY_HEALTHY_SUCCESS_RATE) {
      abnormalWindowCount += 1;
    }
    if (successRate < RUNTIME_QUALITY_SEVERE_WINDOW_SUCCESS_RATE) {
      severeWindowCount += 1;
    }
  });

  return {
    abnormalWindowCount,
    severeWindowCount,
  };
};

const countAffectedCredentials = (rows: CredentialRow[]) =>
  rows.filter(
    (row) =>
      row.total >= RUNTIME_QUALITY_AFFECTED_CREDENTIAL_MIN_REQUESTS &&
      row.successRate < RUNTIME_QUALITY_AFFECTED_CREDENTIAL_SUCCESS_RATE
  ).length;

const countAffectedEndpoints = (apiStats: ApiStats[]) =>
  apiStats.filter((api) => {
    if (api.totalRequests < RUNTIME_QUALITY_AFFECTED_ENDPOINT_MIN_REQUESTS) {
      return false;
    }

    return (
      getFailureRate(api.failureCount, api.totalRequests) >
      RUNTIME_QUALITY_AFFECTED_ENDPOINT_FAILURE_RATE
    );
  }).length;

const countAffectedModels = (modelStats: RuntimeModelStat[]) =>
  modelStats.filter((model) => {
    if (model.requests < RUNTIME_QUALITY_AFFECTED_MODEL_MIN_REQUESTS) {
      return false;
    }

    return (
      getFailureRate(model.failureCount, model.requests) >
      RUNTIME_QUALITY_AFFECTED_MODEL_FAILURE_RATE
    );
  }).length;

const pickPrimaryIncident = (
  credentialRows: CredentialRow[],
  apiStats: ApiStats[],
  modelStats: RuntimeModelStat[]
): RuntimeQualityPrimaryIncident => {
  const credentialCandidate = credentialRows
    .filter(
      (row) =>
        row.total >= RUNTIME_QUALITY_AFFECTED_CREDENTIAL_MIN_REQUESTS &&
        row.successRate < RUNTIME_QUALITY_AFFECTED_CREDENTIAL_SUCCESS_RATE
    )
    .map<RuntimeQualityPrimaryIncident>((row) => ({
      type: 'credential',
      name: row.displayName,
      failureCount: row.failure,
      failureRate: getFailureRate(row.failure, row.total),
      totalRequests: row.total,
    }))
    .sort(comparePrimaryIncidents)[0];

  if (credentialCandidate) {
    return credentialCandidate;
  }

  const endpointCandidate = apiStats
    .filter(
      (api) =>
        api.totalRequests >= RUNTIME_QUALITY_AFFECTED_ENDPOINT_MIN_REQUESTS &&
        getFailureRate(api.failureCount, api.totalRequests) >
          RUNTIME_QUALITY_AFFECTED_ENDPOINT_FAILURE_RATE
    )
    .map<RuntimeQualityPrimaryIncident>((api) => ({
      type: 'endpoint',
      name: api.endpoint,
      failureCount: api.failureCount,
      failureRate: getFailureRate(api.failureCount, api.totalRequests),
      totalRequests: api.totalRequests,
    }))
    .sort(comparePrimaryIncidents)[0];

  if (endpointCandidate) {
    return endpointCandidate;
  }

  const modelCandidate = modelStats
    .filter((model) => {
      if (model.requests < RUNTIME_QUALITY_AFFECTED_MODEL_MIN_REQUESTS) {
        return false;
      }

      return (
        getFailureRate(model.failureCount, model.requests) >
        RUNTIME_QUALITY_AFFECTED_MODEL_FAILURE_RATE
      );
    })
    .map<RuntimeQualityPrimaryIncident>((model) => ({
      type: 'model',
      name: model.model,
      failureCount: model.failureCount,
      failureRate: getFailureRate(model.failureCount, model.requests),
      totalRequests: model.requests,
    }))
    .sort(comparePrimaryIncidents)[0];

  return modelCandidate ?? createEmptyPrimaryIncident();
};

const resolveRuntimeQualityStatus = ({
  hasData,
  overallSuccessRate,
  abnormalWindowCount,
  severeWindowCount,
  affectedCredentialCount,
  affectedEndpointCount,
  affectedModelCount,
  windowsInsufficient,
}: Pick<
  RuntimeQualitySummary,
  | 'hasData'
  | 'overallSuccessRate'
  | 'abnormalWindowCount'
  | 'severeWindowCount'
  | 'affectedCredentialCount'
  | 'affectedEndpointCount'
  | 'affectedModelCount'
> & { windowsInsufficient: boolean }): RuntimeQualityStatus => {
  if (!hasData) {
    return 'empty';
  }

  const hasRiskFactors =
    abnormalWindowCount > 0 ||
    affectedCredentialCount > 0 ||
    affectedEndpointCount > 0 ||
    affectedModelCount > 0;

  if (windowsInsufficient && !hasRiskFactors && overallSuccessRate >= RUNTIME_QUALITY_CRITICAL_SUCCESS_RATE) {
    return 'insufficient';
  }

  if (overallSuccessRate < RUNTIME_QUALITY_CRITICAL_SUCCESS_RATE || severeWindowCount > 0) {
    return 'critical';
  }

  if (
    overallSuccessRate < RUNTIME_QUALITY_HEALTHY_SUCCESS_RATE ||
    abnormalWindowCount > 0 ||
    affectedCredentialCount > 0 ||
    affectedEndpointCount > 0 ||
    affectedModelCount > 0
  ) {
    return 'warning';
  }

  return 'healthy';
};

export function createAuthFileMap(files: AuthFileItem[]): Map<string, CredentialInfo> {
  const map = new Map<string, CredentialInfo>();

  files.forEach((file) => {
    const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
    if (!key) return;

    map.set(key, {
      name: file.name || key,
      type: (file.type || file.provider || '').toString(),
    });
  });

  return map;
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
    return (
      Number.isFinite(timestamp) &&
      timestamp >= windowStart &&
      timestamp <= nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS
    );
  });
}

export function createTokenDistribution(details: UsageDetail[]): TokenDistribution {
  let input = 0;
  let output = 0;
  let cached = 0;
  let reasoning = 0;

  details.forEach((detail) => {
    const tokens = detail.tokens;
    const modelName = String(detail.__modelName ?? '').trim();
    input += typeof tokens?.input_tokens === 'number' ? Math.max(tokens.input_tokens, 0) : 0;
    output += typeof tokens?.output_tokens === 'number' ? Math.max(tokens.output_tokens, 0) : 0;
    cached += getCachedTokens(tokens, modelName);
    reasoning +=
      typeof tokens?.reasoning_tokens === 'number' ? Math.max(tokens.reasoning_tokens, 0) : 0;
  });

  return { input, output, cached, reasoning };
}

export function createUsageSummaryMetrics(
  details: UsageDetail[],
  modelPrices: Record<string, ModelPrice>,
  nowMs: number,
  windowMinutes: number = 30,
  _fallbackTotalTokens?: unknown
): UsageSummaryMetrics {
  const empty: UsageSummaryMetrics = {
    totalTokens: 0,
    tokenBreakdown: { cachedTokens: 0, reasoningTokens: 0, inputTokens: 0, outputTokens: 0 },
    rateStats: {
      rpm: 0,
      tpm: 0,
      windowMinutes,
      requestCount: 0,
      tokenCount: 0,
      peakRpm: 0,
      peakTpm: 0,
      avgRpm: 0,
      avgTpm: 0,
    },
    totalCost: 0,
  };

  if (!details.length) {
    return empty;
  }

  let cachedTokens = 0;
  let reasoningTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let overallTotalTokens = 0;
  let totalCost = 0;
  let requestCount = 0;
  let tokenCount = 0;

  const hasPrices = Object.keys(modelPrices).length > 0;
  const hasValidNow = Number.isFinite(nowMs) && nowMs > 0;
  const safeWindowMinutes = windowMinutes > 0 ? windowMinutes : 1;
  const windowStart = nowMs - safeWindowMinutes * 60 * 1000;
  const minuteBuckets = new Map<number, { requests: number; tokens: number }>();

  details.forEach((detail) => {
    const tokens = detail.tokens;
    const modelName = String(detail.__modelName ?? '').trim();
    const totalTokens = extractTotalTokens(detail);
    const cached = getCachedTokens(tokens, modelName);

    cachedTokens += cached;
    inputTokens += Math.max(toNumber(tokens?.input_tokens), 0);
    outputTokens += Math.max(toNumber(tokens?.output_tokens), 0);
    reasoningTokens += Math.max(toNumber(tokens?.reasoning_tokens), 0);
    overallTotalTokens += totalTokens;

    if (hasPrices) {
      totalCost += calculateCost(detail, modelPrices);
    }

    const timestamp = getDetailTimestampMs(detail);
    if (
      hasValidNow &&
      Number.isFinite(timestamp) &&
      timestamp >= windowStart &&
      timestamp <= nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS
    ) {
      requestCount += 1;
      tokenCount += totalTokens;

      const minuteKey = Math.floor(timestamp / 60000);
      const existing = minuteBuckets.get(minuteKey);
      if (existing) {
        existing.requests += 1;
        existing.tokens += totalTokens;
      } else {
        minuteBuckets.set(minuteKey, { requests: 1, tokens: totalTokens });
      }
    }
  });

  let peakRpm = 0;
  let peakTpm = 0;
  minuteBuckets.forEach((bucket) => {
    peakRpm = Math.max(peakRpm, bucket.requests);
    peakTpm = Math.max(peakTpm, bucket.tokens);
  });

  return {
    totalTokens: overallTotalTokens,
    tokenBreakdown: { cachedTokens, reasoningTokens, inputTokens, outputTokens },
    rateStats: {
      rpm: peakRpm,
      tpm: peakTpm,
      windowMinutes: safeWindowMinutes,
      requestCount,
      tokenCount,
      peakRpm,
      peakTpm,
      avgRpm: requestCount / safeWindowMinutes,
      avgTpm: tokenCount / safeWindowMinutes,
    },
    totalCost,
  };
}

export function createEfficiencyOverview(
  details: UsageDetail[],
  modelPrices: Record<string, ModelPrice>
): EfficiencyOverview {
  return calculateEfficiencyOverview(aggregateEfficiencyDetails(details, modelPrices));
}

export function createModelEfficiencyRows(
  details: UsageDetail[],
  modelPrices: Record<string, ModelPrice>
): ModelEfficiencyRow[] {
  const modelAggregates = new Map<string, EfficiencyAggregate>();

  details.forEach((detail) => {
    const model = String(detail.__modelName ?? '').trim() || '-';
    const current = modelAggregates.get(model) ?? createEmptyEfficiencyAggregate();
    modelAggregates.set(model, accumulateEfficiencyAggregate(current, detail, modelPrices));
  });

  return Array.from(modelAggregates.entries())
    .map(([model, aggregate]) => {
      const overview = calculateEfficiencyOverview(aggregate);
      return {
        model,
        requests: aggregate.requests,
        successCount: aggregate.successCount,
        failureCount: aggregate.failureCount,
        totalTokens: aggregate.totalTokens,
        cacheReuseRate: overview.metrics.cacheReuseRate,
        outputYield: overview.metrics.outputYield,
        failureWasteRate: overview.metrics.failureWasteRate,
        costYield: overview.metrics.costYield,
        efficiencyScore: overview.efficiencyScore,
      };
    })
    .sort((left, right) => {
      if (left.efficiencyScore !== right.efficiencyScore) {
        return left.efficiencyScore - right.efficiencyScore;
      }
      if (left.totalTokens !== right.totalTokens) {
        return right.totalTokens - left.totalTokens;
      }
      return right.requests - left.requests;
    });
}

export function createCredentialEfficiencyRows(
  details: UsageDetail[],
  sourceInfoMap: SourceInfoMap,
  authFileMap: Map<string, CredentialInfo>,
  modelPrices: Record<string, ModelPrice>
): CredentialEfficiencyRow[] {
  const credentialAggregates = new Map<
    string,
    {
      key: string;
      displayName: string;
      type: string;
      filterSource: string;
      filterSourceRaw: string | null;
      filterAuthIndex: string | null;
      aggregate: EfficiencyAggregate;
    }
  >();

  details.forEach((detail) => {
    const sourceInfo = resolveSourceDisplay(
      detail.source ?? '',
      detail.auth_index,
      sourceInfoMap,
      authFileMap
    );
    const authIndex = normalizeAuthIndex(detail.auth_index);
    const sourceRaw = String(detail.source ?? '').trim() || null;
    const key = authIndex
      ? `auth:${authIndex}`
      : `display:${sourceInfo.displayName}::${sourceInfo.type}`;
    const current = credentialAggregates.get(key) ?? {
      key,
      displayName: sourceInfo.displayName,
      type: sourceInfo.type,
      filterSource: sourceInfo.displayName,
      filterSourceRaw: authIndex ? null : sourceRaw,
      filterAuthIndex: authIndex,
      aggregate: createEmptyEfficiencyAggregate(),
    };

    credentialAggregates.set(key, {
      ...current,
      filterSourceRaw:
        current.filterSourceRaw === null ||
        sourceRaw === null ||
        current.filterSourceRaw === sourceRaw
          ? (current.filterSourceRaw ?? sourceRaw)
          : null,
      aggregate: accumulateEfficiencyAggregate(current.aggregate, detail, modelPrices),
    });
  });

  return Array.from(credentialAggregates.values())
    .map((row) => {
      const overview = calculateEfficiencyOverview(row.aggregate);
      return {
        key: row.key,
        displayName: row.displayName,
        type: row.type,
        filterSource: row.filterSource,
        filterSourceRaw: row.filterSourceRaw,
        filterAuthIndex: row.filterAuthIndex,
        requests: row.aggregate.requests,
        success: row.aggregate.successCount,
        failure: row.aggregate.failureCount,
        successRate:
          row.aggregate.requests > 0
            ? (row.aggregate.successCount / row.aggregate.requests) * 100
            : 100,
        totalTokens: row.aggregate.totalTokens,
        cacheReuseRate: overview.metrics.cacheReuseRate,
        outputYield: overview.metrics.outputYield,
        failureWasteRate: overview.metrics.failureWasteRate,
        costYield: overview.metrics.costYield,
        efficiencyScore: overview.efficiencyScore,
      };
    })
    .sort((left, right) => {
      if (left.efficiencyScore !== right.efficiencyScore) {
        return left.efficiencyScore - right.efficiencyScore;
      }
      if (left.totalTokens !== right.totalTokens) {
        return right.totalTokens - left.totalTokens;
      }
      return right.requests - left.requests;
    });
}

export function createRequestEventRows(
  details: UsageDetail[],
  sourceInfoMap: SourceInfoMap,
  authFileMap: Map<string, CredentialInfo>,
  locale: string
): RequestEventRow[] {
  return details
    .map((detail, index) => {
      const timestamp = detail.timestamp;
      const timestampMs = getDetailTimestampMs(detail);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const sourceRaw = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(sourceRaw, authIndexRaw, sourceInfoMap, authFileMap);
      const model = String(detail.__modelName ?? '').trim() || '-';
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const cachedTokens = getCachedTokens(detail.tokens, model);
      const totalTokens = Math.max(
        toNumber(detail.tokens?.total_tokens),
        extractTotalTokens(detail)
      );

      return {
        id: `${timestampMs}-${model}-${sourceRaw || sourceInfo.displayName}-${authIndex}-${inputTokens}-${outputTokens}-${totalTokens}-${index}`,
        timestamp,
        timestampMs,
        timestampLabel: date ? date.toLocaleString(locale) : timestamp || '-',
        model,
        sourceRaw: sourceRaw || '-',
        source: sourceInfo.displayName,
        sourceType: sourceInfo.type,
        authIndex,
        failed: detail.failed === true,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
      };
    })
    .sort((a, b) => toSortableTimestampMs(b.timestampMs) - toSortableTimestampMs(a.timestampMs));
}

export function createRequestEventRowsForRange(
  details: UsageDetail[],
  range: UsageTimeRange,
  nowMs: number,
  sourceInfoMap: SourceInfoMap,
  authFileMap: Map<string, CredentialInfo>,
  locale: string
): RequestEventRow[] {
  const scopedDetails = filterUsageDetailsByTimeRange(details, range, nowMs);
  return createRequestEventRows(scopedDetails, sourceInfoMap, authFileMap, locale);
}

export function createCredentialRows(
  details: UsageDetail[],
  {
    geminiApiKeys = [],
    claudeApiKeys = [],
    codexApiKeys = [],
    vertexApiKeys = [],
    openaiCompatibility = [],
  }: ProviderConfigs,
  authFileMap: Map<string, CredentialInfo>
): CredentialRow[] {
  const bySource: Record<string, CredentialBucket> = {};
  const result: CredentialRow[] = [];
  const consumedSourceIds = new Set<string>();
  const authIndexToRowIndex = new Map<string, number>();
  const sourceToAuthIndex = new Map<string, string>();
  const sourceToAuthFile = new Map<string, CredentialInfo>();
  const fallbackByAuthIndex = new Map<string, CredentialBucket>();

  details.forEach((detail) => {
    const authIdx = normalizeAuthIndex(detail.auth_index);
    const source = detail.source;
    const isFailed = detail.failed === true;

    if (!source) {
      if (!authIdx) return;
      const fallback = fallbackByAuthIndex.get(authIdx) ?? { success: 0, failure: 0 };
      if (isFailed) {
        fallback.failure += 1;
      } else {
        fallback.success += 1;
      }
      fallbackByAuthIndex.set(authIdx, fallback);
      return;
    }

    const bucket = bySource[source] ?? { success: 0, failure: 0 };
    if (isFailed) {
      bucket.failure += 1;
    } else {
      bucket.success += 1;
    }
    bySource[source] = bucket;

    if (authIdx && !sourceToAuthIndex.has(source)) {
      sourceToAuthIndex.set(source, authIdx);
    }

    if (authIdx && !sourceToAuthFile.has(source)) {
      const mapped = authFileMap.get(authIdx);
      if (mapped) {
        sourceToAuthFile.set(source, mapped);
      }
    }
  });

  const mergeBucketToRow = (index: number, bucket: CredentialBucket) => {
    const target = result[index];
    if (!target) return;

    target.success += bucket.success;
    target.failure += bucket.failure;
    target.total = target.success + target.failure;
    target.successRate = target.total > 0 ? (target.success / target.total) * 100 : 100;
  };

  const addConfigRow = (
    apiKey: string,
    prefix: string | undefined,
    name: string,
    type: string,
    rowKey: string
  ) => {
    const candidates = buildCandidateUsageSourceIds({ apiKey, prefix });
    let success = 0;
    let failure = 0;

    candidates.forEach((id) => {
      const bucket = bySource[id];
      if (!bucket) return;
      success += bucket.success;
      failure += bucket.failure;
      consumedSourceIds.add(id);
    });

    const total = success + failure;
    if (!total) return;

    result.push({
      key: rowKey,
      displayName: name,
      type,
      success,
      failure,
      total,
      successRate: (success / total) * 100,
    });
  };

  geminiApiKeys.forEach((config, index) =>
    addConfigRow(
      config.apiKey,
      config.prefix,
      config.prefix?.trim() || `Gemini #${index + 1}`,
      'gemini',
      `gemini:${index}`
    )
  );
  claudeApiKeys.forEach((config, index) =>
    addConfigRow(
      config.apiKey,
      config.prefix,
      config.prefix?.trim() || `Claude #${index + 1}`,
      'claude',
      `claude:${index}`
    )
  );
  codexApiKeys.forEach((config, index) =>
    addConfigRow(
      config.apiKey,
      config.prefix,
      config.prefix?.trim() || `Codex #${index + 1}`,
      'codex',
      `codex:${index}`
    )
  );
  vertexApiKeys.forEach((config, index) =>
    addConfigRow(
      config.apiKey,
      config.prefix,
      config.prefix?.trim() || `Vertex #${index + 1}`,
      'vertex',
      `vertex:${index}`
    )
  );

  openaiCompatibility.forEach((provider, providerIndex) => {
    const displayName = provider.prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`;
    const candidates = new Set<string>();
    buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => candidates.add(id));
    (provider.apiKeyEntries || []).forEach((entry) => {
      buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
    });

    let success = 0;
    let failure = 0;
    candidates.forEach((id) => {
      const bucket = bySource[id];
      if (!bucket) return;
      success += bucket.success;
      failure += bucket.failure;
      consumedSourceIds.add(id);
    });

    const total = success + failure;
    if (!total) return;

    result.push({
      key: `openai:${providerIndex}`,
      displayName,
      type: 'openai',
      success,
      failure,
      total,
      successRate: (success / total) * 100,
    });
  });

  Object.entries(bySource).forEach(([key, bucket]) => {
    if (consumedSourceIds.has(key)) return;
    const total = bucket.success + bucket.failure;
    const authFile = sourceToAuthFile.get(key);

    const rowIndex =
      result.push({
        key,
        displayName: authFile?.name || (key.startsWith('t:') ? key.slice(2) : key),
        type: authFile?.type || '',
        success: bucket.success,
        failure: bucket.failure,
        total,
        successRate: total > 0 ? (bucket.success / total) * 100 : 100,
      }) - 1;

    const authIdx = sourceToAuthIndex.get(key);
    if (authIdx && !authIndexToRowIndex.has(authIdx)) {
      authIndexToRowIndex.set(authIdx, rowIndex);
    }
  });

  fallbackByAuthIndex.forEach((bucket, authIdx) => {
    if (bucket.success + bucket.failure === 0) return;

    const mapped = authFileMap.get(authIdx);
    let targetRowIndex = authIndexToRowIndex.get(authIdx);
    if (targetRowIndex === undefined && mapped) {
      const matchedIndex = result.findIndex(
        (row) => row.displayName === mapped.name && row.type === mapped.type
      );
      if (matchedIndex >= 0) {
        targetRowIndex = matchedIndex;
        authIndexToRowIndex.set(authIdx, matchedIndex);
      }
    }

    if (targetRowIndex !== undefined) {
      mergeBucketToRow(targetRowIndex, bucket);
      return;
    }

    const total = bucket.success + bucket.failure;
    const rowIndex =
      result.push({
        key: `auth:${authIdx}`,
        displayName: mapped?.name || authIdx,
        type: mapped?.type || '',
        success: bucket.success,
        failure: bucket.failure,
        total,
        successRate: (bucket.success / total) * 100,
      }) - 1;

    authIndexToRowIndex.set(authIdx, rowIndex);
  });

  return result.sort((a, b) => b.total - a.total);
}

export function createRuntimeQualitySummary({
  usage,
  details,
  credentialRows,
  apiStats,
  modelStats,
}: {
  usage: RuntimeUsageSummaryInput | null;
  details: UsageDetail[];
  credentialRows: CredentialRow[];
  apiStats: ApiStats[];
  modelStats: RuntimeModelStat[];
}): RuntimeQualitySummary {
  const { totalRequests, successCount, failureCount, usedDerivedValues } = resolveRuntimeRequestSummary(
    usage,
    details
  );
  const hasData = totalRequests > 0;
  const overallSuccessRate = hasData ? successCount / totalRequests : 0;
  const { abnormalWindowCount, severeWindowCount } = countRuntimeQualityWindows(details);
  const windowsInsufficient = details.length < RUNTIME_QUALITY_MIN_WINDOW_REQUESTS;

  const usageTotalRequests =
    typeof usage?.total_requests === 'number' ? usage.total_requests : null;
  const usageSuccessCount =
    typeof usage?.success_count === 'number' ? usage.success_count : null;
  const usageFailureCount =
    typeof usage?.failure_count === 'number' ? usage.failure_count : null;

  let dataConsistent = true;
  if (usedDerivedValues) {
    dataConsistent = false;
  } else if (
    usageTotalRequests !== null &&
    usageSuccessCount !== null &&
    usageFailureCount !== null
  ) {
    dataConsistent = usageSuccessCount + usageFailureCount === usageTotalRequests;
  }

  const affectedCredentialCount = countAffectedCredentials(credentialRows);
  const affectedEndpointCount = countAffectedEndpoints(apiStats);
  const affectedModelCount = countAffectedModels(modelStats);
  const primaryIncident = pickPrimaryIncident(credentialRows, apiStats, modelStats);

  return {
    hasData,
    status: resolveRuntimeQualityStatus({
      hasData,
      overallSuccessRate,
      abnormalWindowCount,
      severeWindowCount,
      affectedCredentialCount,
      affectedEndpointCount,
      affectedModelCount,
      windowsInsufficient,
    }),
    overallSuccessRate,
    totalRequests,
    successCount,
    failureCount,
    windowsInsufficient,
    dataConsistent,
    abnormalWindowCount,
    severeWindowCount,
    affectedCredentialCount,
    affectedEndpointCount,
    affectedModelCount,
    primaryIncident,
  };
}

export type UsageProviderConfigs = {
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
};
