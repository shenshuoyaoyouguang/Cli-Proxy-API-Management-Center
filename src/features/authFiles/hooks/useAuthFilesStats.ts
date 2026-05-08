import { useCallback, useMemo } from 'react';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores';
import type { KeyStats, UsageDetail } from '@/utils/usage';
import { expireFailedDetails } from '@/atoms/usage/expireFailed';

export type UseAuthFilesStatsResult = {
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loadKeyStats: () => Promise<void>;
  refreshKeyStats: () => Promise<void>;
};

export function useAuthFilesStats(): UseAuthFilesStatsResult {
  const keyStats = useUsageStatsStore((state) => state.keyStats);
  const rawUsageDetails = useUsageStatsStore((state) => state.usageDetails);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const usageDetails = useMemo(
    () => expireFailedDetails(rawUsageDetails).details,
    [rawUsageDetails]
  );

  const loadKeyStats = useCallback(async () => {
    await loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  const refreshKeyStats = useCallback(async () => {
    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  return { keyStats, usageDetails, loadKeyStats, refreshKeyStats };
}
