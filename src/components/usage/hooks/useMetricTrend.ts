import { useMemo } from 'react';
import type { UsageDetail } from '@/atoms/usage/types';
import {
  calculateCost,
  extractTotalTokens,
  getDetailTimestampMs,
  type ModelPrice,
} from '@/utils/usage';
import { FUTURE_TIMESTAMP_TOLERANCE_MS } from '@/atoms/usage/time';

export interface MetricTrend {
  delta7d: number | null;
  delta30d: number | null;
  currentPeriod: '7d' | '30d';
  currentValue: number;
  previousValue: number;
}

export type MetricType = 'rpm' | 'tpm' | 'cost';

interface Bucket {
  requests: number;
  tokens: number;
  cost: number;
}

function createBuckets(count: number): Bucket[] {
  return Array.from({ length: count }, () => ({
    requests: 0,
    tokens: 0,
    cost: 0,
  }));
}

function accumulateBucket(
  bucket: Bucket,
  requestCount: number,
  tokenCount: number,
  cost: number
): void {
  bucket.requests += requestCount;
  bucket.tokens += tokenCount;
  bucket.cost += cost;
}

function aggregateBucket(bucket: Bucket, metricType: MetricType): number {
  switch (metricType) {
    case 'rpm':
      return bucket.requests; // requests per bucket period (already rate-normalized by bucket size)
    case 'tpm':
      return bucket.tokens; // tokens per bucket period
    case 'cost':
      return bucket.cost;
  }
}

function computeDelta(
  currentBuckets: Bucket[],
  previousBuckets: Bucket[],
  metricType: MetricType
): { currentAvg: number; previousAvg: number; delta: number | null } {
  const currentValues = currentBuckets.map((bucket) => aggregateBucket(bucket, metricType));
  const previousValues = previousBuckets.map((bucket) => aggregateBucket(bucket, metricType));
  const hasCurrentData = currentValues.some((value) => value > 0);
  const hasPreviousData = previousValues.some((value) => value > 0);

  if (!hasCurrentData && !hasPreviousData) {
    return { currentAvg: 0, previousAvg: 0, delta: null };
  }

  const currentAvg =
    currentValues.reduce((sum, value) => sum + value, 0) / Math.max(currentValues.length, 1);
  const previousAvg =
    previousValues.reduce((sum, value) => sum + value, 0) / Math.max(previousValues.length, 1);

  if (previousAvg <= 0) {
    return { currentAvg, previousAvg, delta: null };
  }

  const delta = ((currentAvg - previousAvg) / previousAvg) * 100;
  return { currentAvg, previousAvg, delta };
}

export function useMetricTrend(
  details: UsageDetail[],
  nowMs: number,
  metricType: MetricType,
  modelPrices: Record<string, ModelPrice>
): MetricTrend {
  return useMemo(() => {
    if (!Number.isFinite(nowMs) || nowMs <= 0 || details.length === 0) {
      return {
        delta7d: null,
        delta30d: null,
        currentPeriod: '7d',
        currentValue: 0,
        previousValue: 0,
      };
    }

    // 7d trend: 1-hour buckets over 7 days (168 buckets)
    // previous period: 7-14 days ago
    const BUCKET_7D_MS = 60 * 60 * 1000;
    const BUCKET_7D_COUNT = 168;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const msPer7d = 7 * DAY_MS;

    const recent7dBuckets = createBuckets(BUCKET_7D_COUNT);
    const previous7dBuckets = createBuckets(BUCKET_7D_COUNT);

    // 30d trend: 6-hour buckets over 30 days (120 buckets)
    const BUCKET_30D_MS = 6 * 60 * 60 * 1000;
    const BUCKET_30D_COUNT = 120;
    const msPer30d = 30 * DAY_MS;

    const recent30dBuckets = createBuckets(BUCKET_30D_COUNT);
    const previous30dBuckets = createBuckets(BUCKET_30D_COUNT);

    details.forEach((detail) => {
      const timestamp = getDetailTimestampMs(detail);
      if (!Number.isFinite(timestamp) || timestamp > nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS) {
        return;
      }

      const tokenCount = extractTotalTokens(detail);
      const cost = calculateCost(detail, modelPrices);

      const recent7dAgeMs = nowMs - timestamp;
      if (recent7dAgeMs >= 0 && recent7dAgeMs < msPer7d) {
        const bucketIndex = Math.floor(recent7dAgeMs / BUCKET_7D_MS);
        const bucket = recent7dBuckets[bucketIndex];
        if (bucket) {
          accumulateBucket(bucket, 1, tokenCount, cost);
        }
      }

      const previous7dEnd = nowMs - msPer7d;
      const previous7dStart = nowMs - 2 * msPer7d;
      if (timestamp >= previous7dStart && timestamp < previous7dEnd) {
        const offsetFromWindowEnd = previous7dEnd - timestamp;
        const bucketIndex = Math.floor(offsetFromWindowEnd / BUCKET_7D_MS);
        const bucket = previous7dBuckets[bucketIndex];
        if (bucket) {
          accumulateBucket(bucket, 1, tokenCount, cost);
        }
      }

      const recent30dAgeMs = nowMs - timestamp;
      if (recent30dAgeMs >= 0 && recent30dAgeMs < msPer30d) {
        const bucketIndex = Math.floor(recent30dAgeMs / BUCKET_30D_MS);
        const bucket = recent30dBuckets[bucketIndex];
        if (bucket) {
          accumulateBucket(bucket, 1, tokenCount, cost);
        }
      }

      const previous30dEnd = nowMs - msPer30d;
      const previous30dStart = nowMs - 2 * msPer30d;
      if (timestamp >= previous30dStart && timestamp < previous30dEnd) {
        const offsetFromWindowEnd = previous30dEnd - timestamp;
        const bucketIndex = Math.floor(offsetFromWindowEnd / BUCKET_30D_MS);
        const bucket = previous30dBuckets[bucketIndex];
        if (bucket) {
          accumulateBucket(bucket, 1, tokenCount, cost);
        }
      }
    });

    const recent7d = computeDelta(recent7dBuckets, previous7dBuckets, metricType);
    const recent30d = computeDelta(recent30dBuckets, previous30dBuckets, metricType);

    return {
      delta7d: recent7d.delta,
      delta30d: recent30d.delta,
      currentPeriod: '7d',
      currentValue: recent7d.currentAvg,
      previousValue: recent7d.previousAvg,
    };
  }, [details, nowMs, metricType, modelPrices]);
}
