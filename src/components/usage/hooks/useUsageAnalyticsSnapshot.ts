import { useMemo } from 'react';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  filterUsageByTimeRange,
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
  type ModelPrice,
  type UsageDetail,
  type UsageTimeRange
} from '@/utils/usage';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
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
}

export interface UseUsageAnalyticsSnapshotReturn {
  filteredUsage: UsagePayload | null;
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
  includeHealthRequestEventRows = false
}: UseUsageAnalyticsSnapshotOptions): UseUsageAnalyticsSnapshotReturn {
  const filteredUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, timeRange, nowMs) : null),
    [usage, timeRange, nowMs]
  );

  const filteredDetails = useMemo(
    () => filterUsageDetailsByTimeRange(usageDetails, timeRange, nowMs),
    [usageDetails, timeRange, nowMs]
  );

  const modelNames = useMemo(() => getModelNamesFromUsage(usage), [usage]);

  const apiStats = useMemo(
    () => getApiStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );

  const modelStats = useMemo(
    () => getModelStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
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
    () => createTokenDistribution(filteredDetails),
    [filteredDetails]
  );

  const usageSummary = useMemo(
    () => createUsageSummaryMetrics(filteredDetails, modelPrices, nowMs),
    [filteredDetails, modelPrices, nowMs]
  );

  const requestEventRows = useMemo(
    () => createRequestEventRows(filteredDetails, sourceInfoMap, authFileMap, locale),
    [authFileMap, filteredDetails, locale, sourceInfoMap]
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
        filteredDetails,
        {
          geminiApiKeys: geminiKeys,
          claudeApiKeys: claudeConfigs,
          codexApiKeys: codexConfigs,
          vertexApiKeys: vertexConfigs,
          openaiCompatibility: openaiProviders
        },
        authFileMap
      ),
    [authFileMap, claudeConfigs, codexConfigs, filteredDetails, geminiKeys, openaiProviders, vertexConfigs]
  );

  const efficiencyOverview = useMemo(
    () => createEfficiencyOverview(filteredDetails, modelPrices),
    [filteredDetails, modelPrices]
  );

  const modelEfficiencyRows = useMemo(
    () => createModelEfficiencyRows(filteredDetails, modelPrices),
    [filteredDetails, modelPrices]
  );

  const credentialEfficiencyRows = useMemo(
    () => createCredentialEfficiencyRows(filteredDetails, sourceInfoMap, authFileMap, modelPrices),
    [authFileMap, filteredDetails, modelPrices, sourceInfoMap]
  );

  const runtimeQualitySummary = useMemo(
    () =>
      createRuntimeQualitySummary({
        usage: filteredUsage,
        details: filteredDetails,
        credentialRows,
        apiStats,
        modelStats
      }),
    [apiStats, credentialRows, filteredDetails, filteredUsage, modelStats]
  );

  return {
    filteredUsage,
    filteredDetails,
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
