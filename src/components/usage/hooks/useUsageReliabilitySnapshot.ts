import { useMemo } from 'react';
import type { UsageDetail } from '@/utils/usage';
import {
  buildHealthAssessment,
  buildReliabilitySnapshot,
  type ReliabilitySnapshot,
} from '@/utils/usage/reliability';
import type { HealthScore } from '@/utils/usage/healthScore';
import { createHealthScoreFromAssessment } from '@/utils/usage/healthScore';

export interface UseUsageReliabilitySnapshotOptions {
  usageDetails: UsageDetail[];
  nowMs: number;
  snapshot?: ReliabilitySnapshot | null;
}

export interface UseUsageReliabilitySnapshotReturn {
  reliabilitySnapshot: ReliabilitySnapshot;
  healthAssessment: HealthScore;
  serviceHealth: ReliabilitySnapshot['serviceHealth'];
}

export function useUsageReliabilitySnapshot({
  usageDetails,
  nowMs,
  snapshot,
}: UseUsageReliabilitySnapshotOptions): UseUsageReliabilitySnapshotReturn {
  const fallbackNowRef = { current: 0 };
  if (fallbackNowRef.current === 0) {
    fallbackNowRef.current = Date.now();
  }

  return useMemo(() => {
    const resolvedNowMs = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : fallbackNowRef.current;
    const reliabilitySnapshot = snapshot ?? buildReliabilitySnapshot(usageDetails, resolvedNowMs);
    const healthAssessment = createHealthScoreFromAssessment(
      buildHealthAssessment(reliabilitySnapshot)
    );

    return {
      reliabilitySnapshot,
      healthAssessment,
      serviceHealth: reliabilitySnapshot.serviceHealth,
    };
  }, [nowMs, snapshot, usageDetails]);
}
