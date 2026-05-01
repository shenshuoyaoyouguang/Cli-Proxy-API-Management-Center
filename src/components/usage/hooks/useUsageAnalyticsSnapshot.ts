import { useMemo } from 'react';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  filterUsageByTimeRange,
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
  resolveModelNameInDetails,
  normalizeUsageModelNames,
  type ModelPrice,
  type UsageDetail,
  type UsageTimeRange
} from '@/utils/usage';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
import {
  buildProviderAliasReverseMap,
  mergeAliasReverseMaps
} from '@/utils/usageAliasResolver';
import type { UsagePayload } from './useUsageData';
import {
  createCredentialEfficiencyRows,
  createCredentialRows,
  createEfficiencyOverview,
  createModelEfficiencyRows,
  createRequestEventRows,
  createRequestEventRowsForRange,
  createRuntimeQualitySummary,
  createTokenDistribution,
  createUsageSummaryMetrics,
  filterUsageDetailsByTimeRange,
  type CredentialEfficiencyRow,
  type CredentialRow,
  type EfficiencyOverview,
  type ModelEfficiencyRow,
  type RequestEventRow,
  type RuntimeQualitySummary,
  type TokenDistribution,
  type UsageSummaryMetrics
} from './usageAnalyticsSnapshot';

export interface UseUsageAnalyticsSnapshotOptions {
  usage: UsagePayload | null;
  usageDetails: UsageDetail[];
  timeRange: UsageTimeRange;
  modelPrices: Record<string, ModelPrice>;
  nowMs: number;
  authFileMap: Map<string, CredentialInfo>;
  locale: string;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
  includeHealthRequestEventRows?: boolean;
  aliasReverseMap?: Map<string, string>;
}

export interface UseUsageAnalyticsSnapshotReturn {
  filteredUsage: UsagePayload | null;
  canonicalUsage: UsagePayload | null;
  filteredDetails: UsageDetail[];
  modelNames: string[];
  apiStats: ReturnType<typeof getApiStats>;
  modelStats: ReturnType<typeof getModelStats>;
  tokenDistribution: TokenDistribution;
  usageSummary: UsageSummaryMetrics;
  requestEventRows: RequestEventRow[];
  healthRequestEventRows: RequestEventRow[];
  credentialRows: CredentialRow[];
  efficiencyOverview: EfficiencyOverview;
  modelEfficiencyRows: ModelEfficiencyRow[];
  credentialEfficiencyRows: CredentialEfficiencyRow[];
  runtimeQualitySummary: RuntimeQualitySummary;
}

export function useUsageAnalyticsSnapshot({
  usage,
  usageDetails,
  timeRange,
  modelPrices,
  nowMs,
  authFileMap,
  locale,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
  includeHealthRequestEventRows = false,
  aliasReverseMap
}: UseUsageAnalyticsSnapshotOptions): UseUsageAnalyticsSnapshotReturn {
  const mergedAliasReverseMap = useMemo(() => {
    const providerMap = buildProviderAliasReverseMap([
      ...geminiKeys,
      ...claudeConfigs,
      ...codexConfigs,
      ...vertexConfigs,
      ...openaiProviders,
    ]);
    if (!providerMap.size && (!aliasReverseMap || !aliasReverseMap.size)) {
      return new Map<string, string>();
    }
    return mergeAliasReverseMaps(providerMap, aliasReverseMap ?? new Map());
  }, [geminiKeys, claudeConfigs, codexConfigs, vertexConfigs, openaiProviders, aliasReverseMap]);

  const filteredUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, timeRange, nowMs) : null),
    [usage, timeRange, nowMs]
  );

  const canonicalUsage = useMemo(
    () => filteredUsage ? normalizeUsageModelNames(filteredUsage, mergedAliasReverseMap) : null,
    [filteredUsage, mergedAliasReverseMap]
  );

  const filteredDetails = useMemo(
    () => filterUsageDetailsByTimeRange(usageDetails, timeRange, nowMs),
    [usageDetails, timeRange, nowMs]
  );

  const resolvedDetails = useMemo(
    () => resolveModelNameInDetails(filteredDetails, mergedAliasReverseMap),
    [filteredDetails, mergedAliasReverseMap]
  );

  // 所有聚合函数现在全部基于 canonicalUsage，确保口径100%统一
  const modelNames = useMemo(() => getModelNamesFromUsage(canonicalUsage), [canonicalUsage]);

  const apiStats = useMemo(
    () => getApiStats(canonicalUsage, modelPrices),
    [canonicalUsage, modelPrices]
  );

  const modelStats = useMemo(
    () => getModelStats(canonicalUsage, modelPrices),
    [canonicalUsage, modelPrices]
  );

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const tokenDistribution = useMemo(
    () => createTokenDistribution(resolvedDetails),
    [resolvedDetails]
  );

  const usageSummary = useMemo(
    () => createUsageSummaryMetrics(resolvedDetails, modelPrices, nowMs),
    [resolvedDetails, modelPrices, nowMs]
  );

  const requestEventRows = useMemo(
    () => createRequestEventRows(resolvedDetails, sourceInfoMap, authFileMap, locale),
    [authFileMap, resolvedDetails, locale, sourceInfoMap]
  );

  const healthRequestEventRows = useMemo(
    () =>
      includeHealthRequestEventRows
        ? createRequestEventRowsForRange(usageDetails, '24h', nowMs, sourceInfoMap, authFileMap, locale)
        : [],
    [authFileMap, includeHealthRequestEventRows, locale, nowMs, sourceInfoMap, usageDetails]
  );

  const credentialRows = useMemo(
    () =>
      createCredentialRows(
        resolvedDetails,
        {
          geminiApiKeys: geminiKeys,
          claudeApiKeys: claudeConfigs,
          codexApiKeys: codexConfigs,
          vertexApiKeys: vertexConfigs,
          openaiCompatibility: openaiProviders
        },
        authFileMap
      ),
    [authFileMap, claudeConfigs, codexConfigs, resolvedDetails, geminiKeys, openaiProviders, vertexConfigs]
  );

  const efficiencyOverview = useMemo(
    () => createEfficiencyOverview(resolvedDetails, modelPrices),
    [resolvedDetails, modelPrices]
  );

  const modelEfficiencyRows = useMemo(
    () => createModelEfficiencyRows(resolvedDetails, modelPrices),
    [resolvedDetails, modelPrices]
  );

  const credentialEfficiencyRows = useMemo(
    () => createCredentialEfficiencyRows(resolvedDetails, sourceInfoMap, authFileMap, modelPrices),
    [authFileMap, resolvedDetails, modelPrices, sourceInfoMap]
  );

  const runtimeQualitySummary = useMemo(
    () =>
      createRuntimeQualitySummary({
        usage: filteredUsage,
        details: resolvedDetails,
        credentialRows,
        apiStats,
        modelStats
      }),
    [apiStats, credentialRows, filteredUsage, modelStats, resolvedDetails]
  );

  return {
    filteredUsage,
    canonicalUsage,
    filteredDetails: resolvedDetails,
    modelNames,
    apiStats,
    modelStats,
    tokenDistribution,
    usageSummary,
    requestEventRows,
    healthRequestEventRows,
    credentialRows,
    efficiencyOverview,
    modelEfficiencyRows,
    credentialEfficiencyRows,
    runtimeQualitySummary
  };
}
