import type { SubscriptionTier } from './types';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface SLATierConfig {
  availabilityTarget: number | null;
  successRateTarget: number | null;
  responseTimeTarget: number | null;
  recoveryTimeTarget: number | null;
  hasCompensation: boolean;
  compensationRules: Array<{
    minRate: number;
    maxRate: number;
    percentage: number;
  }>;
}

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

export const SLA_TIERS: Record<SubscriptionTier, SLATierConfig> = {
  free: {
    availabilityTarget: null,
    successRateTarget: null,
    responseTimeTarget: null,
    recoveryTimeTarget: null,
    hasCompensation: false,
    compensationRules: []
  },
  basic: {
    availabilityTarget: 0.99,
    successRateTarget: 0.95,
    responseTimeTarget: 5000,
    recoveryTimeTarget: 30,
    hasCompensation: false,
    compensationRules: []
  },
  pro: {
    availabilityTarget: 0.999,
    successRateTarget: 0.99,
    responseTimeTarget: 3000,
    recoveryTimeTarget: 15,
    hasCompensation: true,
    compensationRules: [
      { minRate: 0.99, maxRate: 1, percentage: 0 },
      { minRate: 0.95, maxRate: 0.99, percentage: 10 },
      { minRate: 0.9, maxRate: 0.95, percentage: 25 },
      { minRate: 0, maxRate: 0.9, percentage: 50 }
    ]
  },
  enterprise: {
    availabilityTarget: 0.9999,
    successRateTarget: 0.999,
    responseTimeTarget: 1000,
    recoveryTimeTarget: 5,
    hasCompensation: true,
    compensationRules: [
      { minRate: 0.999, maxRate: 1, percentage: 0 },
      { minRate: 0.99, maxRate: 0.999, percentage: 10 },
      { minRate: 0.95, maxRate: 0.99, percentage: 25 },
      { minRate: 0, maxRate: 0.95, percentage: 50 }
    ]
  }
};
