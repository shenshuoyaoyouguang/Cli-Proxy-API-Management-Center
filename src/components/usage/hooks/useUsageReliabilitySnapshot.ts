import { useMemo } from 'react';
import type { UsageDetail } from '@/utils/usage';
import {
  buildHealthAssessment,
  buildReliabilitySnapshot,
  buildSlaAssessment,
  type ReliabilitySnapshot,
  type SlaAssessment,
  type SubscriptionTier
} from '@/utils/usage/reliability';
import type { HealthScore } from '@/utils/usage/healthScore';
import { createHealthScoreFromAssessment } from '@/utils/usage/healthScore';

export interface UseUsageReliabilitySnapshotOptions {
  usageDetails: UsageDetail[];
  tier: SubscriptionTier;
  nowMs: number;
  monthlyFee?: number;
  snapshot?: ReliabilitySnapshot | null;
}

export interface UseUsageReliabilitySnapshotReturn {
  reliabilitySnapshot: ReliabilitySnapshot;
  healthAssessment: HealthScore;
  slaAssessment: SlaAssessment;
  serviceHealth: ReliabilitySnapshot['serviceHealth'];
}

export function useUsageReliabilitySnapshot({
  usageDetails,
  tier,
  nowMs,
  monthlyFee,
  snapshot
}: UseUsageReliabilitySnapshotOptions): UseUsageReliabilitySnapshotReturn {
  return useMemo(() => {
    const resolvedNowMs = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now();
    const reliabilitySnapshot = snapshot ?? buildReliabilitySnapshot(usageDetails, resolvedNowMs);
    const healthAssessment = createHealthScoreFromAssessment(buildHealthAssessment(reliabilitySnapshot));
    const slaAssessment = buildSlaAssessment({
      snapshot: reliabilitySnapshot,
      tier,
      monthlyFee
    });

    return {
      reliabilitySnapshot,
      healthAssessment,
      slaAssessment,
      serviceHealth: reliabilitySnapshot.serviceHealth
    };
  }, [monthlyFee, nowMs, snapshot, tier, usageDetails]);
}
