const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const reliabilityConfig = {
  minuteMs: MINUTE_MS,
  hourMs: HOUR_MS,
  dayMs: DAY_MS,
  healthWindowMs: 24 * HOUR_MS,
  trendWindowMs: 7 * DAY_MS,
  slaWindowMs: 30 * DAY_MS,
  serviceHealthWindowMs: 7 * DAY_MS,
  serviceHealthRows: 7,
  serviceHealthCols: 96,
  serviceHealthBucketMs: 15 * MINUTE_MS,
  availabilityBucketMs: MINUTE_MS,
  stabilityBucketMs: HOUR_MS,
  streakWindowDays: 30,
  minimumSamples: {
    healthTotal: 20,
    trendSegment: 20,
    dayHealthy: 10
  },
  weights: {
    successRate: 0.4,
    availability: 0.35,
    stability: 0.25
  },
  thresholds: {
    excellent: 90,
    good: 70,
    fair: 50,
    degradedSuccessRate: 0.5,
    healthyDaySuccessRate: 0.99,
    healthyDayAvailability: 0.99,
    trendDelta: 0.02
  },
  stabilityStdDevScoreMap: [
    { max: 0.01, score: 100 },
    { max: 0.02, score: 92 },
    { max: 0.05, score: 78 },
    { max: 0.08, score: 64 },
    { max: 0.12, score: 48 },
    { max: Number.POSITIVE_INFINITY, score: 24 }
  ]
} as const;
