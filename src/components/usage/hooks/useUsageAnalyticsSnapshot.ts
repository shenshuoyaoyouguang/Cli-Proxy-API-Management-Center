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
  createCredentialRows,
  createRequestEventRows,
  createTokenDistribution,
  filterUsageDetailsByTimeRange,
  type CredentialRow,
  type RequestEventRow,
  type TokenDistribution
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
}

export interface UseUsageAnalyticsSnapshotReturn {
  filteredUsage: UsagePayload | null;
  filteredDetails: UsageDetail[];
  modelNames: string[];
  apiStats: ReturnType<typeof getApiStats>;
  modelStats: ReturnType<typeof getModelStats>;
  tokenDistribution: TokenDistribution;
  requestEventRows: RequestEventRow[];
  credentialRows: CredentialRow[];
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
  openaiProviders
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

  const requestEventRows = useMemo(
    () => createRequestEventRows(filteredDetails, sourceInfoMap, authFileMap, locale),
    [authFileMap, filteredDetails, locale, sourceInfoMap]
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

  return {
    filteredUsage,
    filteredDetails,
    modelNames,
    apiStats,
    modelStats,
    tokenDistribution,
    requestEventRows,
    credentialRows
  };
}
