import { useMemo } from 'react';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
  resolveModelNameInDetails,
  normalizeUsageModelNames,
  createAggregateUsageSnapshotFromDetails,
  type ModelPrice,
  type UsageDetail,
  type UsageTimeRange,
} from '@/utils/usage';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
import { buildProviderAliasReverseMap, mergeAliasReverseMaps } from '@/utils/usageAliasResolver';
import type { UsagePayload } from './useUsageData';
import {
  createCredentialEfficiencyRows,
  createCredentialRows,
  createEfficiencyOverview,
  createModelEfficiencyRows,
  createRequestEventRows,
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
  type UsageSummaryMetrics,
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
  credentialRows: CredentialRow[];
  efficiencyOverview: EfficiencyOverview;
  modelEfficiencyRows: ModelEfficiencyRow[];
  credentialEfficiencyRows: CredentialEfficiencyRow[];
  runtimeQualitySummary: RuntimeQualitySummary;
  tokenConsistencyWarning: string | null;
}

export function useUsageAnalyticsSnapshot({
  usage: _usage,
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
  aliasReverseMap,
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

  const analyticsSourceDetails = useMemo(() => usageDetails, [usageDetails]);

  const filteredDetails = useMemo(
    () => filterUsageDetailsByTimeRange(analyticsSourceDetails, timeRange, nowMs),
    [analyticsSourceDetails, timeRange, nowMs]
  );

  const resolvedDetails = useMemo(
    () => resolveModelNameInDetails(filteredDetails, mergedAliasReverseMap),
    [filteredDetails, mergedAliasReverseMap]
  );

  const filteredUsage = useMemo(
    () => createAggregateUsageSnapshotFromDetails(resolvedDetails),
    [resolvedDetails]
  );

  const canonicalUsage = useMemo(
    () => (filteredUsage ? normalizeUsageModelNames(filteredUsage, mergedAliasReverseMap) : null),
    [filteredUsage, mergedAliasReverseMap]
  );

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
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const tokenDistribution = useMemo(
    () => createTokenDistribution(resolvedDetails),
    [resolvedDetails]
  );

  const stableNowMs = useMemo(() => Math.floor(nowMs / 10000) * 10000, [nowMs]);
  const usageSummary = useMemo(
    () => createUsageSummaryMetrics(resolvedDetails, modelPrices, stableNowMs, 30),
    [resolvedDetails, modelPrices, stableNowMs]
  );

  const requestEventRows = useMemo(
    () => createRequestEventRows(resolvedDetails, sourceInfoMap, authFileMap, locale),
    [authFileMap, resolvedDetails, locale, sourceInfoMap]
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
          openaiCompatibility: openaiProviders,
        },
        authFileMap
      ),
    [
      authFileMap,
      claudeConfigs,
      codexConfigs,
      resolvedDetails,
      geminiKeys,
      openaiProviders,
      vertexConfigs,
    ]
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
        modelStats,
      }),
    [apiStats, credentialRows, filteredUsage, modelStats, resolvedDetails]
  );

  const tokenConsistencyWarning = useMemo(() => {
    const distributionSum =
      tokenDistribution.input +
      tokenDistribution.output +
      tokenDistribution.cached +
      tokenDistribution.reasoning;
    const totalTokens = usageSummary.totalTokens;
    if (totalTokens > 0 && Math.abs(distributionSum - totalTokens) / totalTokens > 0.05) {
      return `Token 饼图分项之和 (${distributionSum.toLocaleString()}) 与总 Token 数 (${totalTokens.toLocaleString()}) 偏差超过 5%，数据可能来自不完整的聚合统计。`;
    }
    return null;
  }, [tokenDistribution, usageSummary.totalTokens]);

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
    credentialRows,
    efficiencyOverview,
    modelEfficiencyRows,
    credentialEfficiencyRows,
    runtimeQualitySummary,
    tokenConsistencyWarning,
  };
}
