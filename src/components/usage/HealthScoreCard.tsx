import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconHeart } from '@/components/ui/icons';
import {
  getDataQualityLabel,
  getGradeColor,
  getGradeLabel,
  getHealthSummary,
  getMetricStatusLabel,
  type HealthScore,
  type MetricScore
} from '@/utils/usage/healthScore';
import { formatPercent } from '@/utils/numberFormat';
import styles from './HealthScoreCard.module.scss';

interface HealthScoreCardProps {
  assessment: HealthScore;
  loading: boolean;
  onAvailabilityDrillDown?: () => void;
  onSuccessRateDrillDown?: () => void;
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const circumference = 2 * Math.PI * 36;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={styles.scoreRingContainer}>
      <svg className={styles.scoreRingSvg} viewBox="0 0 80 80">
        <circle
          className={styles.scoreRingBg}
          cx="40"
          cy="40"
          r="36"
          fill="none"
          strokeWidth="6"
        />
        <circle
          className={styles.scoreRingProgress}
          cx="40"
          cy="40"
          r="36"
          fill="none"
          strokeWidth="6"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <div className={styles.scoreRingText}>
        <span className={styles.scoreValue}>{score}</span>
      </div>
    </div>
  );
}

function formatMetricValue(metricId: 'successRate' | 'availability' | 'stability', metric: MetricScore): string {
  if (metric.value === null) {
    return '--';
  }

  if (metricId === 'stability') {
    return `σ ${(metric.value * 100).toFixed(1)}%`;
  }

  return formatPercent(metric.value);
}

function getMetricNote(
  metricId: 'successRate' | 'availability' | 'stability',
  t: (key: string) => string
): string {
  if (metricId === 'successRate') {
    return t('health.metric_help_success_rate');
  }
  if (metricId === 'availability') {
    return t('health.metric_help_availability');
  }
  return t('health.metric_help_stability');
}

function MetricRow({
  label,
  metricId,
  metric,
  t
}: {
  label: string;
  metricId: 'successRate' | 'availability' | 'stability';
  metric: MetricScore;
  t: (key: string) => string;
}) {
  const color = getGradeColor(metric.grade);
  const gradeLabel = getGradeLabel(metric.grade, t);
  const statusLabel = getMetricStatusLabel(metric.status, t);

  return (
    <div className={styles.metricRow}>
      <div className={styles.metricInfo}>
        <span className={styles.metricLabel}>{label}</span>
        <span className={styles.metricValue}>{formatMetricValue(metricId, metric)}</span>
      </div>
      <div className={styles.metricBar}>
        <div
          className={styles.metricBarFill}
          style={{ width: `${metric.score}%`, backgroundColor: color }}
        />
      </div>
      <div className={styles.metricMeta}>
        <span className={styles.metricGrade} style={{ color }}>
          {gradeLabel}
        </span>
        <span className={styles.metricEvidence}>
          {statusLabel} · {Math.round(metric.weight * 100)}%
        </span>
        <span className={styles.metricEvidence}>{getMetricNote(metricId, t)}</span>
      </div>
    </div>
  );
}

export function HealthScoreCard({
  assessment,
  loading,
  onAvailabilityDrillDown,
  onSuccessRateDrillDown
}: HealthScoreCardProps) {
  const { t } = useTranslation();

  const color = getGradeColor(assessment.grade);
  const gradeLabel = getGradeLabel(assessment.grade, t);
  const dataQualityLabel = getDataQualityLabel(assessment.dataQuality, t);
  const trendLabel =
    assessment.trend === 'up'
      ? t('health.trend_up')
      : assessment.trend === 'down'
        ? t('health.trend_down')
        : assessment.trend === 'unknown'
          ? t('health.trend_unknown')
          : t('health.trend_stable');

  return (
    <div
      className={styles.card}
      style={
        {
          '--accent': color,
          '--accent-soft': `${color}20`,
          '--accent-border': `${color}50`
        } as CSSProperties
      }
    >
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardTitle}>
            <span className={styles.cardIcon}>
              <IconHeart size={16} />
            </span>
            {t('health.title')}
          </div>
          <div className={styles.cardHeaderMeta}>
            <span className={styles.cardBadge}>{t('health.window_24h')}</span>
            <span className={styles.cardBadge}>{dataQualityLabel}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className={styles.placeholderBody}>
          <span className={styles.placeholderTitle}>{t('common.loading')}</span>
          <span className={styles.placeholderText}>{t('health.summary_no_data')}</span>
        </div>
      ) : !assessment.hasData ? (
        <div className={styles.placeholderBody}>
          <span className={styles.placeholderTitle}>{t('health.no_data_title')}</span>
          <span className={styles.placeholderText}>{t('health.no_data_desc')}</span>
        </div>
      ) : (
        <div className={styles.healthScoreContent}>
          <div className={styles.scoreSection}>
            <ScoreRing score={assessment.overall} color={color} />
            <div className={styles.scoreInfo}>
              <span className={styles.scoreGrade} style={{ color }}>
                {gradeLabel}
              </span>
              <span className={styles.scoreTrend}>{trendLabel}</span>
            </div>
          </div>

          <div className={styles.summaryText}>{getHealthSummary(assessment, t)}</div>

          <div className={styles.metricsSection}>
            <MetricRow
              label={t('health.success_rate')}
              metricId="successRate"
              metric={assessment.metrics.successRate}
              t={t}
            />
            <MetricRow
              label={t('health.availability')}
              metricId="availability"
              metric={assessment.metrics.availability}
              t={t}
            />
            <MetricRow
              label={t('health.stability')}
              metricId="stability"
              metric={assessment.metrics.stability}
              t={t}
            />
          </div>

          <div className={styles.healthFooter}>
            <div className={styles.metricEvidence}>
              {assessment.healthyDayStreak > 0
                ? t('health.healthy_day_streak', { days: assessment.healthyDayStreak })
                : t('health.trend_stable')}
            </div>
            <div className={styles.actionRow}>
              <Button variant="ghost" size="sm" onClick={onAvailabilityDrillDown} disabled={!onAvailabilityDrillDown}>
                {t('health.action_service_health')}
              </Button>
              <Button variant="ghost" size="sm" onClick={onSuccessRateDrillDown} disabled={!onSuccessRateDrillDown}>
                {t('health.action_request_events')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
