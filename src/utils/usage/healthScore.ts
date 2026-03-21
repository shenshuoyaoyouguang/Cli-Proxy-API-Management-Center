import type { UsageDetail } from '../usage';
import {
  buildHealthAssessment,
  buildReliabilitySnapshot,
  type DataQuality,
  type HealthAssessment,
  type HealthGrade as ReliabilityHealthGrade,
  type MetricResult,
  type MetricStatus,
  type ReliabilityMetricId
} from './reliability';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type HealthGrade = ReliabilityHealthGrade;
export type HealthTrend = HealthAssessment['trend']['direction'];

export interface MetricScore {
  value: number | null;
  score: number;
  grade: HealthGrade;
  weight: number;
  status: MetricStatus;
  dataQuality: DataQuality;
  sampleCount: number;
}

export interface HealthScoreMetrics {
  successRate: MetricScore;
  availability: MetricScore;
  stability: MetricScore;
}

export interface HealthScore {
  overall: number;
  grade: HealthGrade;
  metrics: HealthScoreMetrics;
  trend: HealthTrend;
  healthyDayStreak: number;
  dataQuality: DataQuality;
  windowMs: number;
  primaryMetricId: ReliabilityMetricId | null;
  hasData: boolean;
}

const GRADE_COLORS: Record<HealthGrade, string> = {
  excellent: '#22c55e',
  good: '#84cc16',
  fair: '#f59e0b',
  poor: '#ef4444',
  unknown: '#94a3b8'
};

const asMetricScore = (metric: MetricResult): MetricScore => ({
  value: metric.rawValue,
  score: metric.normalizedScore,
  grade: getGrade(metric.normalizedScore, metric.dataQuality),
  weight: metric.weight,
  status: metric.status,
  dataQuality: metric.dataQuality,
  sampleCount: metric.sampleCount
});

export function createHealthScoreFromAssessment(assessment: HealthAssessment): HealthScore {
  return {
    overall: assessment.overallScore,
    grade: assessment.grade,
    metrics: {
      successRate: asMetricScore(assessment.metrics.successRate),
      availability: asMetricScore(assessment.metrics.availability),
      stability: asMetricScore(assessment.metrics.stability)
    },
    trend: assessment.trend.direction,
    healthyDayStreak: assessment.healthyDayStreak,
    dataQuality: assessment.dataQuality,
    windowMs: assessment.windowMs,
    primaryMetricId: assessment.primaryMetricId,
    hasData: assessment.hasData
  };
}

export function getGrade(score: number, dataQuality: DataQuality = 'ok'): HealthGrade {
  if (dataQuality !== 'ok') return 'unknown';
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

export function getGradeColor(grade: HealthGrade): string {
  return GRADE_COLORS[grade];
}

export function getGradeLabel(grade: HealthGrade, t?: Translate): string {
  const labels: Record<HealthGrade, string> = {
    excellent: t ? t('health.excellent') : '优秀',
    good: t ? t('health.good') : '良好',
    fair: t ? t('health.fair') : '一般',
    poor: t ? t('health.poor') : '较差',
    unknown: t ? t('health.unknown') : '未知'
  };
  return labels[grade];
}

export function getMetricStatusLabel(status: MetricStatus, t?: Translate): string {
  const labels: Record<MetricStatus, string> = {
    healthy: t ? t('health.metric_status_healthy') : '健康',
    warning: t ? t('health.metric_status_warning') : '关注',
    critical: t ? t('health.metric_status_critical') : '严重',
    unknown: t ? t('health.metric_status_unknown') : '未知'
  };
  return labels[status];
}

export function getDataQualityLabel(dataQuality: DataQuality, t?: Translate): string {
  const labels: Record<DataQuality, string> = {
    ok: t ? t('health.data_quality_ok') : '正常',
    low_sample: t ? t('health.data_quality_low_sample') : '样本不足',
    no_data: t ? t('health.data_quality_no_data') : '无数据',
    unsupported: t ? t('health.data_quality_unsupported') : '未接入'
  };
  return labels[dataQuality];
}

export function getMetricLabel(metricId: ReliabilityMetricId, t?: Translate): string {
  const labels: Record<ReliabilityMetricId, string> = {
    success_rate: t ? t('health.success_rate') : '成功率',
    availability: t ? t('health.availability') : '可用性',
    stability: t ? t('health.stability') : '稳定性',
    latency: t ? t('sla.response_time') : '响应时间',
    recovery_time: t ? t('sla.recovery_time') : '恢复时间',
    model_consistency: t ? t('health.model_consistency') : '模型一致性'
  };
  return labels[metricId];
}

export function getHealthSummary(healthScore: HealthScore, t?: Translate): string {
  if (healthScore.dataQuality === 'no_data') {
    return t ? t('health.summary_no_data') : '当前窗口暂无可评估数据';
  }

  if (healthScore.dataQuality === 'low_sample') {
    return t ? t('health.summary_low_sample') : '当前窗口样本不足，结果仅供参考';
  }

  if (healthScore.dataQuality === 'unsupported') {
    return t ? t('health.summary_unsupported') : '当前窗口关键指标尚未接入';
  }

  if (!healthScore.primaryMetricId) {
    return t ? t('health.summary_stable') : '当前窗口内未发现明显异常';
  }

  const metricLabel = getMetricLabel(healthScore.primaryMetricId, t);
  return t ? t('health.summary_primary_metric', { metric: metricLabel }) : `主要扣分项：${metricLabel}`;
}

export function calculateHealthScore(
  _successCount: number,
  _failureCount: number,
  details: UsageDetail[],
  nowMs: number = Date.now()
): HealthScore {
  const snapshot = buildReliabilitySnapshot(details, nowMs);
  const assessment = buildHealthAssessment(snapshot);
  return createHealthScoreFromAssessment(assessment);
}
