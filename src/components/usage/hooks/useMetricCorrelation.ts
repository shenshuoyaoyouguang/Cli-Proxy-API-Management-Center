import { useMemo } from 'react';
import type { UsageDetail } from '@/atoms/usage/types';
import { calculateCost, extractTotalTokens, getDetailTimestampMs } from '@/utils/usage';
import type { ModelPrice } from '@/utils/usage';
import { FUTURE_TIMESTAMP_TOLERANCE_MS } from '@/atoms/usage/time';

export interface MetricCorrelation {
  correlation: number | null; // -1 to 1
  sampleCount: number;
  interpretationKey:
    | 'no_data'
    | 'insufficient_data'
    | 'cannot_compute'
    | 'very_strong'
    | 'strong'
    | 'moderate'
    | 'weak'
    | 'very_weak';
}

function pearsonCorrelation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;

  const slice = (arr: number[]) => arr.slice(0, n);
  const xs = slice(x);
  const ys = slice(y);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const mean = (arr: number[]) => sum(arr) / arr.length;

  const xMean = mean(xs);
  const yMean = mean(ys);

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;

  return num / den;
}

function interpretCorrelation(r: number): MetricCorrelation['interpretationKey'] {
  const abs = Math.abs(r);
  if (abs >= 0.9) return 'very_strong';
  if (abs >= 0.7) return 'strong';
  if (abs >= 0.5) return 'moderate';
  if (abs >= 0.3) return 'weak';
  return 'very_weak';
}

export function useMetricCorrelation(
  details: UsageDetail[],
  nowMs: number,
  modelPrices: Record<string, ModelPrice>
): MetricCorrelation {
  return useMemo(() => {
    if (!Number.isFinite(nowMs) || nowMs <= 0 || details.length === 0) {
      return { correlation: null, sampleCount: 0, interpretationKey: 'no_data' };
    }

    // Build daily aggregates (last 14 days max)
    const DAY_MS = 24 * 60 * 60 * 1000;
    const bucketCount = 14;
    const buckets: { tpm: number; cost: number }[] = Array.from({ length: bucketCount }, () => ({
      tpm: 0,
      cost: 0,
    }));

    details.forEach((detail) => {
      const timestamp = getDetailTimestampMs(detail);
      if (
        !Number.isFinite(timestamp) ||
        timestamp > nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS
      ) {
        return;
      }

      const ageDays = (nowMs - timestamp) / DAY_MS;
      const bucketIndex = Math.floor(ageDays);
      if (bucketIndex < 0 || bucketIndex >= bucketCount) return;

      buckets[bucketIndex].tpm += extractTotalTokens(detail);
      buckets[bucketIndex].cost += calculateCost(detail, modelPrices);
    });

    // Reverse so oldest first
    const tpmSeries = buckets.map((b) => b.tpm).reverse();
    const costSeries = buckets.map((b) => b.cost).reverse();

    const nonZeroPairs = tpmSeries
      .map((value, index) => [value, costSeries[index]] as const)
      .filter(([tpm, cost]) => tpm > 0 || cost > 0);

    if (nonZeroPairs.length < 3) {
      return {
        correlation: null,
        sampleCount: nonZeroPairs.length,
        interpretationKey: 'insufficient_data',
      };
    }

    const filteredTpmSeries = nonZeroPairs.map(([tpm]) => tpm);
    const filteredCostSeries = nonZeroPairs.map(([, cost]) => cost);
    const r = pearsonCorrelation(filteredTpmSeries, filteredCostSeries);
    if (r === null) {
      return {
        correlation: null,
        sampleCount: nonZeroPairs.length,
        interpretationKey: 'cannot_compute',
      };
    }

    return {
      correlation: r,
      sampleCount: nonZeroPairs.length,
      interpretationKey: interpretCorrelation(r),
    };
  }, [details, nowMs, modelPrices]);
}
