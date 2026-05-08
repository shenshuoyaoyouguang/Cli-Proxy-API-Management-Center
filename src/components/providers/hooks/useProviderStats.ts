import { useCallback, useMemo } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores';
import type { KeyStats, UsageDetail } from '@/utils/usage';
import { expireFailedDetails } from '@/atoms/usage/expireFailed';

const EMPTY_KEY_STATS: KeyStats = { bySource: {}, byAuthIndex: {} };
const EMPTY_USAGE_DETAILS: UsageDetail[] = [];
const PROVIDER_STATS_REFRESH_INTERVAL_MS = 240_000;

export type UseProviderStatsOptions = {
  enabled?: boolean;
};

export const useProviderStats = (options: UseProviderStatsOptions = {}) => {
  const enabled = options.enabled ?? true;
  const keyStats = useUsageStatsStore((state) => (enabled ? state.keyStats : EMPTY_KEY_STATS));
  const rawUsageDetails = useUsageStatsStore((state) =>
    enabled ? state.usageDetails : EMPTY_USAGE_DETAILS
  );
  const isLoading = useUsageStatsStore((state) => (enabled ? state.loading : false));
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const usageDetails = useMemo(
    () => (enabled ? expireFailedDetails(rawUsageDetails).details : EMPTY_USAGE_DETAILS),
    [rawUsageDetails, enabled]
  );

  const loadKeyStats = useCallback(async () => {
    await loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  useInterval(() => {
    if (!enabled) return;
    void loadKeyStats().catch(() => {});
  }, enabled ? PROVIDER_STATS_REFRESH_INTERVAL_MS : null);

  return { keyStats, usageDetails, loadKeyStats, isLoading };
};
