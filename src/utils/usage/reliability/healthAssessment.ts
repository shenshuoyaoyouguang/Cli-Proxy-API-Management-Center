import { reliabilityConfig } from './config';
import {
  collectDailyAvailability,
  collectWindowAvailability,
  collectWindowCounts,
  collectWindowHourlyRates,
  createReliabilityCounts
} from './snapshot';
import type {
  DataQuality,
  HealthAssessment,
  HealthGrade,
  HealthTrend,
  MetricResult,
  MetricStatus,
  ReliabilityCounts,
  ReliabilityMetricId,
  ReliabilitySnapshot,
  TrendResult
} from './types';

const dataQualityRank: Record<DataQuality, number> = {
  ok: 0,
  low_sample: 1,
  no_data: 2,
  unsupported: 3
};

const getWorstDataQuality = (...values: DataQuality[]): DataQuality =>
  values.reduce((worst, current) =>
    dataQualityRank[current] > dataQualityRank[worst] ? current : worst
  );

const getMetricStatus = (score: number, dataQuality: DataQuality): MetricStatus => {
  if (dataQuality !== 'ok') {
    return 'unknown';
  }
  if (score >= reliabilityConfig.thresholds.excellent) {
    return 'healthy';
  }
  if (score >= reliabilityConfig.thresholds.fair) {
    return 'warning';
  }
  return 'critical';
};

export const getHealthGrade = (score: number, dataQuality: DataQuality = 'ok'): HealthGrade => {
  if (dataQuality !== 'ok') {
    return 'unknown';
  }
  if (score >= reliabilityConfig.thresholds.excellent) {
    return 'excellent';
  }
  if (score >= reliabilityConfig.thresholds.good) {
    return 'good';
  }
  if (score >= reliabilityConfig.thresholds.fair) {
    return 'fair';
  }
  return 'poor';
};

const buildMetricResult = ({
  id,
  rawValue,
  normalizedScore,
  weight,
  sampleCount,
  dataQuality
}: {
  id: ReliabilityMetricId;
  rawValue: number | null;
  normalizedScore: number;
  weight: number;
  sampleCount: number;
  dataQuality: DataQuality;
}): MetricResult => ({
  id,
  rawValue,
  normalizedScore,
  weight,
  sampleCount,
  dataQuality,
  status: getMetricStatus(normalizedScore, dataQuality)
});

const buildSuccessRateMetric = (counts: ReliabilityCounts): MetricResult => {
  const rawValue = counts.total > 0 ? counts.success / counts.total : null;
  const dataQuality = counts.total === 0
    ? 'no_data'
    : counts.total < reliabilityConfig.minimumSamples.healthTotal
      ? 'low_sample'
      : 'ok';

  return buildMetricResult({
    id: 'success_rate',
    rawValue,
    normalizedScore: rawValue === null ? 0 : Math.round(rawValue * 100),
    weight: reliabilityConfig.weights.successRate,
    sampleCount: counts.total,
    dataQuality
  });
};

const buildAvailabilityMetric = (snapshot: ReliabilitySnapshot): MetricResult => {
  const { availability, totalWeight } = collectWindowAvailability(snapshot, reliabilityConfig.healthWindowMs);
  const dataQuality = totalWeight === 0
    ? 'no_data'
    : totalWeight < reliabilityConfig.minimumSamples.healthTotal
      ? 'low_sample'
      : 'ok';

  return buildMetricResult({
    id: 'availability',
    rawValue: availability,
    normalizedScore: availability === null ? 0 : Math.round(availability * 100),
    weight: reliabilityConfig.weights.availability,
    sampleCount: totalWeight,
    dataQuality
  });
};

const calculateStdDev = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const normalizeStabilityScore = (stdDev: number): number => {
  const matched = reliabilityConfig.stabilityStdDevScoreMap.find((candidate) => stdDev <= candidate.max);
  return matched?.score ?? 0;
};

const buildStabilityMetric = (snapshot: ReliabilitySnapshot, healthCounts: ReliabilityCounts): MetricResult => {
  const hourlyRates = collectWindowHourlyRates(snapshot, reliabilityConfig.healthWindowMs);
  const stdDev = hourlyRates.length > 1 ? calculateStdDev(hourlyRates) : null;
  const dataQuality = healthCounts.total === 0
    ? 'no_data'
    : healthCounts.total < reliabilityConfig.minimumSamples.healthTotal || hourlyRates.length < 2
      ? 'low_sample'
      : 'ok';

  return buildMetricResult({
    id: 'stability',
    rawValue: stdDev,
    normalizedScore: stdDev === null ? 0 : normalizeStabilityScore(stdDev),
    weight: reliabilityConfig.weights.stability,
    sampleCount: hourlyRates.length,
    dataQuality
  });
};

const buildTrend = (snapshot: ReliabilitySnapshot): TrendResult => {
  const recentWindowStart = snapshot.generatedAtMs - reliabilityConfig.trendWindowMs;
  const previousWindowStart = recentWindowStart - reliabilityConfig.trendWindowMs;

  const counts = snapshot.details.reduce(
    (accumulator, detail) => {
      if (detail.timestampMs < previousWindowStart || detail.timestampMs > snapshot.generatedAtMs) {
        return accumulator;
      }

      if (detail.timestampMs >= recentWindowStart) {
        return {
          ...accumulator,
          recent: detail.failed
            ? createReliabilityCounts(accumulator.recent.success, accumulator.recent.failure + 1)
            : createReliabilityCounts(accumulator.recent.success + 1, accumulator.recent.failure)
        };
      }

      return {
        ...accumulator,
        previous: detail.failed
          ? createReliabilityCounts(accumulator.previous.success, accumulator.previous.failure + 1)
          : createReliabilityCounts(accumulator.previous.success + 1, accumulator.previous.failure)
      };
    },
    {
      recent: createReliabilityCounts(),
      previous: createReliabilityCounts()
    }
  );

  const sampleCount = counts.recent.total + counts.previous.total;
  if (counts.recent.total === 0 && counts.previous.total === 0) {
    return {
      direction: 'unknown',
      currentValue: null,
      previousValue: null,
      delta: null,
      dataQuality: 'no_data',
      sampleCount
    };
  }

  if (
    counts.recent.total < reliabilityConfig.minimumSamples.trendSegment ||
    counts.previous.total < reliabilityConfig.minimumSamples.trendSegment
  ) {
    return {
      direction: 'unknown',
      currentValue: counts.recent.total > 0 ? counts.recent.success / counts.recent.total : null,
      previousValue: counts.previous.total > 0 ? counts.previous.success / counts.previous.total : null,
      delta: null,
      dataQuality: 'low_sample',
      sampleCount
    };
  }

  const currentValue = counts.recent.success / counts.recent.total;
  const previousValue = counts.previous.success / counts.previous.total;
  const delta = currentValue - previousValue;
  const direction: HealthTrend = delta > reliabilityConfig.thresholds.trendDelta
    ? 'up'
    : delta < -reliabilityConfig.thresholds.trendDelta
      ? 'down'
      : 'stable';

  return {
    direction,
    currentValue,
    previousValue,
    delta,
    dataQuality: 'ok',
    sampleCount
  };
};

const calculateHealthyDayStreak = (snapshot: ReliabilitySnapshot): number => {
  const availabilityByDay = collectDailyAvailability(snapshot, reliabilityConfig.streakWindowDays);
  const todayDayKey = Math.floor(snapshot.generatedAtMs / reliabilityConfig.dayMs);

  let streak = 0;
  for (let offset = 0; offset < reliabilityConfig.streakWindowDays; offset += 1) {
    const dayKey = todayDayKey - offset;
    const counts = snapshot.dayBuckets.get(dayKey);
    if (!counts || counts.total === 0 || counts.total < reliabilityConfig.minimumSamples.dayHealthy) {
      break;
    }

    const availability = availabilityByDay.get(dayKey);
    if (availability === undefined) {
      break;
    }

    const successRate = counts.success / counts.total;
    const isHealthy =
      successRate >= reliabilityConfig.thresholds.healthyDaySuccessRate &&
      availability >= reliabilityConfig.thresholds.healthyDayAvailability;

    if (!isHealthy) {
      break;
    }

    streak += 1;
  }

  return streak;
};

const calculateOverallScore = (metrics: HealthAssessment['metrics']): number =>
  Math.round(
    metrics.successRate.normalizedScore * metrics.successRate.weight +
      metrics.availability.normalizedScore * metrics.availability.weight +
      metrics.stability.normalizedScore * metrics.stability.weight
  );

const getPrimaryMetricId = (metrics: HealthAssessment['metrics']): ReliabilityMetricId | null => {
  const candidates = [metrics.successRate, metrics.availability, metrics.stability]
    .filter((metric) => metric.sampleCount > 0)
    .map((metric) => ({
      id: metric.id,
      loss: (100 - metric.normalizedScore) * metric.weight
    }))
    .sort((left, right) => right.loss - left.loss);

  return candidates[0]?.id ?? null;
};

export function buildHealthAssessment(snapshot: ReliabilitySnapshot): HealthAssessment {
  const healthCounts = collectWindowCounts(snapshot, reliabilityConfig.healthWindowMs);
  const successRate = buildSuccessRateMetric(healthCounts);
  const availability = buildAvailabilityMetric(snapshot);
  const stability = buildStabilityMetric(snapshot, healthCounts);
  const dataQuality = getWorstDataQuality(
    successRate.dataQuality,
    availability.dataQuality,
    stability.dataQuality
  );
  const metrics = { successRate, availability, stability };
  const overallScore = calculateOverallScore(metrics);

  return {
    overallScore,
    grade: getHealthGrade(overallScore, dataQuality),
    dataQuality,
    windowMs: reliabilityConfig.healthWindowMs,
    metrics,
    trend: buildTrend(snapshot),
    healthyDayStreak: calculateHealthyDayStreak(snapshot),
    primaryMetricId: healthCounts.total === 0 ? null : getPrimaryMetricId(metrics),
    hasData: healthCounts.total > 0
  };
}
