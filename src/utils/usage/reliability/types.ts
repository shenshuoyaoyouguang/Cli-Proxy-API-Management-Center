import type { UsageDetail } from '@/utils/usage';

export type ReliabilityMetricId =
  | 'success_rate'
  | 'availability'
  | 'stability'
  | 'latency'
  | 'recovery_time'
  | 'model_consistency';

export type MetricStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
export type DataQuality = 'ok' | 'low_sample' | 'no_data' | 'unsupported';
export type HealthGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';
export type HealthTrend = 'up' | 'stable' | 'down' | 'unknown';
export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'enterprise';
export type StatusBlockState = 'success' | 'failure' | 'mixed' | 'idle';

export interface ReliabilityCounts {
  success: number;
  failure: number;
  total: number;
}

export interface ReliabilityDetail
  extends Pick<UsageDetail, 'timestamp' | 'source' | 'auth_index' | 'failed' | 'tokens'> {
  timestampMs: number;
  modelName: string;
  minuteKey: number;
  hourKey: number;
  dayKey: number;
}

export interface StatusBlockDetail {
  success: number;
  failure: number;
  rate: number;
  startTime: number;
  endTime: number;
}

export interface ServiceHealthData {
  blocks: StatusBlockState[];
  blockDetails: StatusBlockDetail[];
  successRate: number | null;
  totalSuccess: number;
  totalFailure: number;
  rows: number;
  cols: number;
}

export interface MetricResult {
  id: ReliabilityMetricId;
  rawValue: number | null;
  normalizedScore: number;
  weight: number;
  status: MetricStatus;
  dataQuality: DataQuality;
  sampleCount: number;
}

export interface TrendResult {
  direction: HealthTrend;
  currentValue: number | null;
  previousValue: number | null;
  delta: number | null;
  dataQuality: DataQuality;
  sampleCount: number;
}

export interface HealthAssessment {
  overallScore: number;
  grade: HealthGrade;
  dataQuality: DataQuality;
  windowMs: number;
  metrics: {
    successRate: MetricResult;
    availability: MetricResult;
    stability: MetricResult;
  };
  trend: TrendResult;
  healthyDayStreak: number;
  primaryMetricId: ReliabilityMetricId | null;
  hasData: boolean;
}

export interface ReliabilitySnapshot {
  generatedAtMs: number;
  details: ReliabilityDetail[];
  totals: ReliabilityCounts;
  minuteByModel: Map<number, Map<string, ReliabilityCounts>>;
  hourBuckets: Map<number, ReliabilityCounts>;
  dayBuckets: Map<number, ReliabilityCounts>;
  serviceHealth: ServiceHealthData;
}
