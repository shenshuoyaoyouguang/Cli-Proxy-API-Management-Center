import { useMemo } from 'react';
import type { UsageDetail } from '@/utils/usage';
import {
  buildReliabilitySnapshot,
  type ReliabilitySnapshot,
} from '@/utils/usage/reliability';

export interface UseUsageReliabilitySnapshotOptions {
  usageDetails: UsageDetail[];
  nowMs: number;
  snapshot?: ReliabilitySnapshot | null;
}

export interface UseUsageReliabilitySnapshotReturn {
  reliabilitySnapshot: ReliabilitySnapshot;
  serviceHealth: ReliabilitySnapshot['serviceHealth'];
}

const FALLBACK_NOW_MS = Date.now();

export function useUsageReliabilitySnapshot({
  usageDetails,
  nowMs,
  snapshot,
}: UseUsageReliabilitySnapshotOptions): UseUsageReliabilitySnapshotReturn {
  return useMemo(() => {
    const resolvedNowMs = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : FALLBACK_NOW_MS;
    const reliabilitySnapshot = snapshot ?? buildReliabilitySnapshot(usageDetails, resolvedNowMs);

    return {
      reliabilitySnapshot,
      serviceHealth: reliabilitySnapshot.serviceHealth,
    };
  }, [nowMs, snapshot, usageDetails]);
}
