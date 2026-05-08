import { useCallback, useMemo } from 'react';
import {
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  getDetailTimestampMs,
  type ModelPrice,
  type UsageDetail,
} from '@/utils/usage';
import { FUTURE_TIMESTAMP_TOLERANCE_MS } from '@/atoms/usage/time';
import { STAT_COLORS } from '@/constants/colors';
import type { UsagePayload } from './useUsageData';

export interface SparklineData {
  labels: string[];
  datasets: Array<{
    data: number[];
    borderColor: string;
    backgroundColor: string;
    fill: boolean;
    tension: number;
    pointRadius: number;
    borderWidth: number;
  }>;
}

export interface SparklineBundle {
  data: SparklineData;
}

export type TrendPeriod = '7d' | '30d';

export interface DaySparklineBundle extends SparklineBundle {
  period: TrendPeriod;
}

export interface PeriodSparklineBundle {
  '7d': DaySparklineBundle | null;
  '30d': DaySparklineBundle | null;
}

export interface UseSparklinesOptions {
  usage: UsagePayload | null;
  usageDetails?: UsageDetail[];
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  nowMs: number;
}

export interface UseSparklinesReturn {
  requestsSparkline: SparklineBundle | null;
  tokensSparkline: SparklineBundle | null;
  rpmSparkline: SparklineBundle | null;
  tpmSparkline: SparklineBundle | null;
  costSparkline: SparklineBundle | null;
  dayRpmSparkline: PeriodSparklineBundle;
  dayTpmSparkline: PeriodSparklineBundle;
  dayCostSparkline: PeriodSparklineBundle;
}

function buildRollingAverageSeries(values: number[], windowSize: number): number[] {
  if (!values.length || windowSize <= 0) {
    return [];
  }

  const rolling: number[] = new Array(values.length).fill(0);
  let runningTotal = 0;

  values.forEach((value, index) => {
    runningTotal += value;
    if (index >= windowSize) {
      runningTotal -= values[index - windowSize];
    }

    const divisor = Math.min(index + 1, windowSize);
    rolling[index] = runningTotal / divisor;
  });

  return rolling;
}

function buildDaySparkline(
  labels: string[],
  points: number[],
  period: TrendPeriod,
  color: string,
  backgroundColor: string,
  loading: boolean
): DaySparklineBundle | null {
  if (loading || labels.length === 0 || points.every((value) => value <= 0)) {
    return null;
  }

  return {
    period,
    data: {
      labels,
      datasets: [
        {
          data: points,
          borderColor: color,
          backgroundColor,
          fill: true,
          tension: 0.45,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
  };
}

export function useSparklines({
  usage,
  usageDetails = [],
  loading,
  modelPrices,
  nowMs,
}: UseSparklinesOptions): UseSparklinesReturn {
  const sparklineDetails = useMemo(
    () => (usageDetails.length > 0 ? usageDetails : usage ? collectUsageDetails(usage) : []),
    [usage, usageDetails]
  );

  const lastHourSeries = useMemo(() => {
    if (!Number.isFinite(nowMs) || nowMs <= 0) {
      return { labels: [], requests: [], tokens: [], costs: [], rpm: [], tpm: [] };
    }
    if (!sparklineDetails.length) {
      return { labels: [], requests: [], tokens: [], costs: [], rpm: [], tpm: [] };
    }

    const windowMinutes = 60;
    const rateWindowMinutes = 30;
    const now = nowMs;
    const windowStart = now - windowMinutes * 60 * 1000;
    const requestBuckets = new Array(windowMinutes).fill(0);
    const tokenBuckets = new Array(windowMinutes).fill(0);
    const costBuckets = new Array(windowMinutes).fill(0);

    sparklineDetails.forEach((detail) => {
      const timestamp = getDetailTimestampMs(detail);
      if (
        !Number.isFinite(timestamp) ||
        timestamp < windowStart ||
        timestamp > now + FUTURE_TIMESTAMP_TOLERANCE_MS
      ) {
        return;
      }
      const minuteIndex = Math.min(
        windowMinutes - 1,
        Math.max(0, Math.floor((timestamp - windowStart) / 60000))
      );
      requestBuckets[minuteIndex] += 1;
      tokenBuckets[minuteIndex] += extractTotalTokens(detail);
      costBuckets[minuteIndex] += calculateCost(detail, modelPrices);
    });

    const labels = requestBuckets.map((_, idx) => {
      const date = new Date(windowStart + (idx + 1) * 60000);
      const h = date.getHours().toString().padStart(2, '0');
      const m = date.getMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
    });

    return {
      labels,
      requests: requestBuckets,
      tokens: tokenBuckets,
      costs: costBuckets,
      rpm: buildRollingAverageSeries(requestBuckets, rateWindowMinutes),
      tpm: buildRollingAverageSeries(tokenBuckets, rateWindowMinutes),
    };
  }, [modelPrices, nowMs, sparklineDetails]);

  const lastDaysSeries = useMemo(() => {
    if (!Number.isFinite(nowMs) || nowMs <= 0) {
      return { labels7d: [], rpm7d: [], tpm7d: [], cost7d: [], labels30d: [], rpm30d: [], tpm30d: [], cost30d: [] };
    }
    if (!sparklineDetails.length) {
      return { labels7d: [], rpm7d: [], tpm7d: [], cost7d: [], labels30d: [], rpm30d: [], tpm30d: [], cost30d: [] };
    }

    const DAY_MS = 24 * 60 * 60 * 1000;

    // 7-day buckets
    const bucketCount7d = 7;
    const buckets7d = Array.from({ length: bucketCount7d }, () => ({
      rpm: 0, tpm: 0, cost: 0,
    }));
    const windowStart7d = nowMs - bucketCount7d * DAY_MS;

    // 30-day buckets (6h resolution for efficiency)
    const bucketCount30d = 30;
    const buckets30d = Array.from({ length: bucketCount30d }, () => ({
      rpm: 0, tpm: 0, cost: 0,
    }));
    const windowStart30d = nowMs - bucketCount30d * DAY_MS;

    sparklineDetails.forEach((detail) => {
      const timestamp = getDetailTimestampMs(detail);
      if (!Number.isFinite(timestamp) || timestamp > nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS) {
        return;
      }

      // 7-day bucket
      if (timestamp >= windowStart7d) {
        const ageDays = (nowMs - timestamp) / DAY_MS;
        const idx = bucketCount7d - 1 - Math.floor(ageDays);
        if (idx >= 0 && idx < bucketCount7d) {
          buckets7d[idx].rpm += 1;
          buckets7d[idx].tpm += extractTotalTokens(detail);
          buckets7d[idx].cost += calculateCost(detail, modelPrices);
        }
      }

      // 30-day bucket
      if (timestamp >= windowStart30d) {
        const ageDays = (nowMs - timestamp) / DAY_MS;
        const idx = bucketCount30d - 1 - Math.floor(ageDays);
        if (idx >= 0 && idx < bucketCount30d) {
          buckets30d[idx].rpm += 1;
          buckets30d[idx].tpm += extractTotalTokens(detail);
          buckets30d[idx].cost += calculateCost(detail, modelPrices);
        }
      }
    });

    const labels7d = buckets7d.map((_, idx) => {
      const date = new Date(windowStart7d + idx * DAY_MS);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });
    const labels30d = buckets30d.map((_, idx) => {
      const date = new Date(windowStart30d + idx * DAY_MS);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    return {
      labels7d,
      rpm7d: buckets7d.map((b) => b.rpm),
      tpm7d: buckets7d.map((b) => b.tpm),
      cost7d: buckets7d.map((b) => b.cost),
      labels30d,
      rpm30d: buckets30d.map((b) => b.rpm),
      tpm30d: buckets30d.map((b) => b.tpm),
      cost30d: buckets30d.map((b) => b.cost),
    };
  }, [modelPrices, nowMs, sparklineDetails]);

  const buildSparkline = useCallback(
    (
      series: { labels: string[]; data: number[] },
      color: string,
      backgroundColor: string
    ): SparklineBundle | null => {
      if (loading || !series?.data?.length) {
        return null;
      }
      const sliceStart = Math.max(series.data.length - 60, 0);
      const labels = series.labels.slice(sliceStart);
      const points = series.data.slice(sliceStart);
      return {
        data: {
          labels,
          datasets: [
            {
              data: points,
              borderColor: color,
              backgroundColor,
              fill: true,
              tension: 0.45,
              pointRadius: 0,
              borderWidth: 2
            }
          ]
        }
      };
    },
    [loading]
  );

  const requestsSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.requests },
        STAT_COLORS.requests.accent,
        STAT_COLORS.requests.soft
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.requests]
  );

  const tokensSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.tokens },
        STAT_COLORS.tokens.accent,
        STAT_COLORS.tokens.soft
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.tokens]
  );

  const rpmSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.rpm },
        STAT_COLORS.rpm.accent,
        STAT_COLORS.rpm.soft
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.rpm]
  );

  const tpmSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.tpm },
        STAT_COLORS.tpm.accent,
        STAT_COLORS.tpm.soft
      ),
    [buildSparkline, lastHourSeries.labels, lastHourSeries.tpm]
  );

  const costSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: lastHourSeries.labels, data: lastHourSeries.costs },
        STAT_COLORS.cost.accent,
        STAT_COLORS.cost.soft
      ),
    [buildSparkline, lastHourSeries.costs, lastHourSeries.labels]
  );

  const dayRpmSparkline = useMemo(
    (): PeriodSparklineBundle => ({
      '7d': buildDaySparkline(
        lastDaysSeries.labels7d,
        lastDaysSeries.rpm7d,
        '7d',
        STAT_COLORS.rpm.accent,
        STAT_COLORS.rpm.soft,
        loading
      ),
      '30d': buildDaySparkline(
        lastDaysSeries.labels30d,
        lastDaysSeries.rpm30d,
        '30d',
        STAT_COLORS.rpm.accent,
        STAT_COLORS.rpm.soft,
        loading
      ),
    }),
    [lastDaysSeries, loading]
  );

  const dayTpmSparkline = useMemo(
    (): PeriodSparklineBundle => ({
      '7d': buildDaySparkline(
        lastDaysSeries.labels7d,
        lastDaysSeries.tpm7d,
        '7d',
        STAT_COLORS.tpm.accent,
        STAT_COLORS.tpm.soft,
        loading
      ),
      '30d': buildDaySparkline(
        lastDaysSeries.labels30d,
        lastDaysSeries.tpm30d,
        '30d',
        STAT_COLORS.tpm.accent,
        STAT_COLORS.tpm.soft,
        loading
      ),
    }),
    [lastDaysSeries, loading]
  );

  const dayCostSparkline = useMemo(
    (): PeriodSparklineBundle => ({
      '7d': buildDaySparkline(
        lastDaysSeries.labels7d,
        lastDaysSeries.cost7d,
        '7d',
        STAT_COLORS.cost.accent,
        STAT_COLORS.cost.soft,
        loading
      ),
      '30d': buildDaySparkline(
        lastDaysSeries.labels30d,
        lastDaysSeries.cost30d,
        '30d',
        STAT_COLORS.cost.accent,
        STAT_COLORS.cost.soft,
        loading
      ),
    }),
    [lastDaysSeries, loading]
  );

  return {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline,
    dayRpmSparkline,
    dayTpmSparkline,
    dayCostSparkline,
  };
}
