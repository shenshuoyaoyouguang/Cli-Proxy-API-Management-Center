import { useMemo, useRef } from 'react';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  collectUsageDetails,
  filterUsageByTimeRange,
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
  rehydrateUsageAggregatesFromDetails,
  resolveModelNameInDetails,
  normalizeUsageModelNames,
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
  tokenConsistencyWarning: string | null;
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

  const usageDerivedDetails = useMemo(() => (usage ? collectUsageDetails(usage) : []), [usage]);

  const analyticsSourceDetails = useMemo(
    () => (usageDetails.length > 0 ? usageDetails : usageDerivedDetails),
    [usageDerivedDetails, usageDetails]
  );

  const filteredUsage = useMemo(
    () =>
      usage
        ? rehydrateUsageAggregatesFromDetails(filterUsageByTimeRange(usage, timeRange, nowMs))
        : null,
    [usage, timeRange, nowMs]
  );

  const canonicalUsage = useMemo(
    () => (filteredUsage ? normalizeUsageModelNames(filteredUsage, mergedAliasReverseMap) : null),
    [filteredUsage, mergedAliasReverseMap]
  );

  const filteredDetailsCache = useRef({
    result: [] as UsageDetail[],
    prevSource: [] as unknown[],
    computedCount: 0,
    timeRange: 'all' as UsageTimeRange,
    nowMs: 0,
  });
  const filteredDetails = useMemo(() => {
    const prev = filteredDetailsCache.current;
    if (
      timeRange === prev.timeRange &&
      nowMs === prev.nowMs &&
      prev.prevSource === analyticsSourceDetails
    ) {
      if (analyticsSourceDetails.length === prev.computedCount) return prev.result;
      if (analyticsSourceDetails.length > prev.computedCount) {
        const newItems = analyticsSourceDetails.slice(prev.computedCount);
        const newFiltered = filterUsageDetailsByTimeRange(newItems, timeRange, nowMs);
        if (newFiltered.length === 0) return prev.result;
        const result = prev.computedCount === 0 ? newFiltered : [...prev.result, ...newFiltered];
        prev.result = result;
        prev.computedCount = analyticsSourceDetails.length;
        return result;
      }
    }
    const result = filterUsageDetailsByTimeRange(analyticsSourceDetails, timeRange, nowMs);
    filteredDetailsCache.current = {
      result,
      prevSource: analyticsSourceDetails,
      computedCount: analyticsSourceDetails.length,
      timeRange,
      nowMs,
    };
    return result;
  }, [analyticsSourceDetails, timeRange, nowMs]);

  const resolvedDetailsCache = useRef({
    result: [] as UsageDetail[],
    prevSource: [] as unknown[],
    computedCount: 0,
    aliasMap: null as Map<string, string> | null,
  });
  const resolvedDetails = useMemo(() => {
    const prev = resolvedDetailsCache.current;
    if (prev.aliasMap === mergedAliasReverseMap && prev.prevSource === filteredDetails) {
      if (filteredDetails.length === prev.computedCount) return prev.result;
      if (filteredDetails.length > prev.computedCount) {
        const newItems = filteredDetails.slice(prev.computedCount);
        const newResolved = resolveModelNameInDetails(newItems, mergedAliasReverseMap);
        const result = prev.computedCount === 0 ? newResolved : [...prev.result, ...newResolved];
        prev.result = result;
        prev.computedCount = filteredDetails.length;
        return result;
      }
    }
    const result = resolveModelNameInDetails(filteredDetails, mergedAliasReverseMap);
    resolvedDetailsCache.current = {
      result,
      prevSource: filteredDetails,
      computedCount: filteredDetails.length,
      aliasMap: mergedAliasReverseMap,
    };
    return result;
  }, [filteredDetails, mergedAliasReverseMap]);

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
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const tdCache = useRef(null as { result: TokenDistribution; count: number } | null);
  const tokenDistribution = useMemo(() => {
    const prev = tdCache.current;
    if (prev && resolvedDetails.length > prev.count) {
      const delta = createTokenDistribution(resolvedDetails.slice(prev.count));
      const merged: TokenDistribution = {
        input: prev.result.input + delta.input,
        output: prev.result.output + delta.output,
        cached: prev.result.cached + delta.cached,
        reasoning: prev.result.reasoning + delta.reasoning,
      };
      tdCache.current = { result: merged, count: resolvedDetails.length };
      return merged;
    }
    const result = createTokenDistribution(resolvedDetails);
    tdCache.current = { result, count: resolvedDetails.length };
    return result;
  }, [resolvedDetails]);

  const usCache = useRef(
    null as {
      result: UsageSummaryMetrics;
      count: number;
      modelPrices: Record<string, ModelPrice>;
      nowMs: number;
    } | null
  );
  const stableNowMs = Math.floor(nowMs / 10000) * 10000;
  const usageSummary = useMemo(() => {
    const prev = usCache.current;
    if (
      prev &&
      prev.modelPrices === modelPrices &&
      prev.nowMs === stableNowMs &&
      resolvedDetails.length > prev.count
    ) {
      const delta = createUsageSummaryMetrics(
        resolvedDetails.slice(prev.count),
        modelPrices,
        stableNowMs,
        30
      );
      const merged: UsageSummaryMetrics = {
        totalTokens: prev.result.totalTokens + delta.totalTokens,
        tokenBreakdown: {
          cachedTokens: prev.result.tokenBreakdown.cachedTokens + delta.tokenBreakdown.cachedTokens,
          reasoningTokens:
            prev.result.tokenBreakdown.reasoningTokens + delta.tokenBreakdown.reasoningTokens,
          inputTokens: prev.result.tokenBreakdown.inputTokens + delta.tokenBreakdown.inputTokens,
          outputTokens: prev.result.tokenBreakdown.outputTokens + delta.tokenBreakdown.outputTokens,
        },
        rateStats: delta.rateStats,
        totalCost: prev.result.totalCost + delta.totalCost,
      };
      usCache.current = {
        result: merged,
        count: resolvedDetails.length,
        modelPrices,
        nowMs: stableNowMs,
      };
      return merged;
    }
    const result = createUsageSummaryMetrics(resolvedDetails, modelPrices, stableNowMs, 30);
    usCache.current = { result, count: resolvedDetails.length, modelPrices, nowMs: stableNowMs };
    return result;
  }, [resolvedDetails, modelPrices, stableNowMs]);

  const requestEventRows = useMemo(
    () => createRequestEventRows(resolvedDetails, sourceInfoMap, authFileMap, locale),
    [authFileMap, resolvedDetails, locale, sourceInfoMap]
  );

  const healthRowsLenRef = useRef(0);
  const healthRowsResultRef = useRef<RequestEventRow[]>([]);
  const healthRequestEventRows = useMemo(() => {
    if (!includeHealthRequestEventRows) {
      healthRowsLenRef.current = 0;
      healthRowsResultRef.current = [];
      return healthRowsResultRef.current;
    }
    if (analyticsSourceDetails.length !== healthRowsLenRef.current) {
      healthRowsLenRef.current = analyticsSourceDetails.length;
      healthRowsResultRef.current = createRequestEventRowsForRange(
        analyticsSourceDetails,
        '1d',
        nowMs,
        sourceInfoMap,
        authFileMap,
        locale
      );
    }
    return healthRowsResultRef.current;
  }, [
    analyticsSourceDetails,
    authFileMap,
    includeHealthRequestEventRows,
    locale,
    nowMs,
    sourceInfoMap,
  ]);

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

  const eoCache = useRef(
    null as {
      result: EfficiencyOverview;
      count: number;
      modelPrices: Record<string, ModelPrice>;
    } | null
  );
  const efficiencyOverview = useMemo(() => {
    const prev = eoCache.current;
    if (prev && prev.modelPrices === modelPrices && resolvedDetails.length > prev.count) {
      const result = createEfficiencyOverview(resolvedDetails, modelPrices);
      eoCache.current = { result, count: resolvedDetails.length, modelPrices };
      return result;
    }
    if (prev && prev.modelPrices === modelPrices && resolvedDetails.length === prev.count) {
      return prev.result;
    }
    const result = createEfficiencyOverview(resolvedDetails, modelPrices);
    eoCache.current = { result, count: resolvedDetails.length, modelPrices };
    return result;
  }, [resolvedDetails, modelPrices]);

  const merCache = useRef(
    null as {
      result: ModelEfficiencyRow[];
      count: number;
      modelPrices: Record<string, ModelPrice>;
    } | null
  );
  const modelEfficiencyRows = useMemo(() => {
    const prev = merCache.current;
    if (prev && prev.modelPrices === modelPrices && resolvedDetails.length === prev.count) {
      return prev.result;
    }
    const result = createModelEfficiencyRows(resolvedDetails, modelPrices);
    merCache.current = { result, count: resolvedDetails.length, modelPrices };
    return result;
  }, [resolvedDetails, modelPrices]);

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
    healthRequestEventRows,
    credentialRows,
    efficiencyOverview,
    modelEfficiencyRows,
    credentialEfficiencyRows,
    runtimeQualitySummary,
    tokenConsistencyWarning,
  };
}
