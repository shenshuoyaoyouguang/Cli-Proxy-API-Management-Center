import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTarget } from '@/components/ui/icons';
import {
  getStatusColor,
  getStatusLabel,
  getTierLabel,
  type SLACommitment,
  type SLAMetrics
} from '@/utils/usage/slaCalculator';
import { formatPercent } from '@/utils/numberFormat';
import styles from './SLAMonitorCard.module.scss';

interface SLAMonitorCardProps {
  assessment: SLAMetrics;
  loading: boolean;
}

function formatMissingTelemetry(metrics: SLAMetrics['missingTelemetry'], t: (key: string) => string): string {
  return metrics
    .map((metric) => {
      switch (metric) {
        case 'availability':
          return t('sla.availability');
        case 'success_rate':
          return t('sla.success_rate');
        case 'latency':
          return t('sla.response_time');
        case 'recovery_time':
          return t('sla.recovery_time');
        case 'stability':
          return t('health.stability');
        case 'model_consistency':
          return t('health.model_consistency');
        default:
          return metric;
      }
    })
    .join(', ');
}

function formatCommitmentValue(commitment: SLACommitment, t: (key: string) => string): string {
  if (commitment.current === null) {
    return commitment.status === 'unsupported' ? t('sla.telemetry_not_available') : '--';
  }

  if (commitment.unit === 'ratio') {
    return formatPercent(commitment.current);
  }

  if (commitment.unit === 'minutes') {
    return `${commitment.current.toLocaleString()} ${t('sla.minutes')}`;
  }

  return commitment.current < 1000
    ? `${Math.round(commitment.current)}ms`
    : `${(commitment.current / 1000).toFixed(1)}s`;
}

function formatCommitmentTarget(commitment: SLACommitment, t: (key: string) => string): string {
  if (commitment.target === null) {
    return '--';
  }

  if (commitment.unit === 'ratio') {
    return formatPercent(commitment.target);
  }

  if (commitment.unit === 'minutes') {
    return `${commitment.target.toLocaleString()} ${t('sla.minutes')}`;
  }

  return commitment.target < 1000
    ? `${Math.round(commitment.target)}ms`
    : `${(commitment.target / 1000).toFixed(1)}s`;
}

function SLAMetricRow({
  label,
  commitment,
  t
}: {
  label: string;
  commitment: SLACommitment;
  t: (key: string) => string;
}) {
  const color = getStatusColor(commitment.status);
  const statusLabel = getStatusLabel(commitment.status, t);
  const showProgress = commitment.unit === 'ratio' && commitment.current !== null && commitment.target !== null;
  const progress = showProgress ? Math.min((commitment.current! / commitment.target!) * 100, 100) : 0;

  return (
    <div className={styles.slaMetricRow}>
      <div className={styles.slaMetricHeader}>
        <span className={styles.slaMetricLabel}>{label}</span>
        <span className={styles.cardBadge} style={{ color, borderColor: `${color}40` }}>
          {statusLabel}
        </span>
      </div>
      <div className={styles.slaMetricValues}>
        <span className={styles.slaMetricCurrent}>{formatCommitmentValue(commitment, t)}</span>
        {commitment.target !== null && (
          <span className={styles.slaMetricTarget}>/ {formatCommitmentTarget(commitment, t)}</span>
        )}
      </div>
      {showProgress && (
        <div className={styles.slaProgressBar}>
          <div
            className={styles.slaProgressFill}
            style={{ width: `${progress}%`, backgroundColor: color }}
          />
        </div>
      )}
    </div>
  );
}

export function SLAMonitorCard({ assessment, loading }: SLAMonitorCardProps) {
  const { t } = useTranslation();
  const overallColor = getStatusColor(assessment.overallStatus);
  const tierLabel = getTierLabel(assessment.tier, t);

  return (
    <div
      className={styles.card}
      style={
        {
          '--accent': overallColor,
          '--accent-soft': `${overallColor}20`,
          '--accent-border': `${overallColor}50`
        } as CSSProperties
      }
    >
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardTitle}>
            <span className={styles.cardIcon}>
              <IconTarget size={16} />
            </span>
            {t('sla.title')}
          </div>
          <div className={styles.cardHeaderMeta}>
            <span className={styles.cardBadge}>{t('sla.window_30d')}</span>
            <span className={styles.cardBadge}>{getStatusLabel(assessment.overallStatus, t)}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className={styles.placeholderBody}>
          <span className={styles.placeholderTitle}>{t('common.loading')}</span>
          <span className={styles.placeholderText}>{t('sla.no_data_desc')}</span>
        </div>
      ) : !assessment.hasData ? (
        <div className={styles.placeholderBody}>
          <span className={styles.placeholderTitle}>{t('sla.no_data_title')}</span>
          <span className={styles.placeholderText}>{t('sla.no_data_desc')}</span>
        </div>
      ) : (
        <div className={styles.slaContent}>
          <div className={styles.tierSection}>
            <span className={styles.tierLabel}>{t('sla.tier')}</span>
            <span className={styles.tierValue}>{tierLabel}</span>
          </div>

          {assessment.tier === 'free' && (
            <div className={styles.slaNote}>{t('sla.note_free_tier')}</div>
          )}

          {assessment.missingTelemetry.length > 0 && (
            <div className={styles.slaNote}>
              {t('sla.missing_telemetry', { metrics: formatMissingTelemetry(assessment.missingTelemetry, t) })}
            </div>
          )}

          <div className={styles.slaMetricsSection}>
            <SLAMetricRow label={t('sla.availability')} commitment={assessment.commitments.availability} t={t} />
            <SLAMetricRow label={t('sla.success_rate')} commitment={assessment.commitments.successRate} t={t} />
            <SLAMetricRow label={t('sla.response_time')} commitment={assessment.commitments.responseTime} t={t} />
            <SLAMetricRow label={t('sla.recovery_time')} commitment={assessment.commitments.recoveryTime} t={t} />
          </div>

          <div className={styles.slaFooter}>
            <div className={styles.budgetSection}>
              <span className={styles.budgetLabel}>{t('sla.remaining_budget')}</span>
              <div className={styles.budgetValues}>
                <span className={styles.budgetItem}>
                  {t('sla.downtime')}: {assessment.remainingBudget.downtime} {t('sla.minutes')}
                </span>
                <span className={styles.budgetItem}>
                  {t('sla.errors')}: {assessment.remainingBudget.errors}
                </span>
              </div>
            </div>

            {assessment.compensation.eligible && (
              <div className={styles.compensationSection}>
                <span className={styles.compensationLabel}>{t('sla.compensation')}</span>
                <span className={styles.compensationValue}>
                  ${assessment.compensation.amount.toFixed(2)} ({assessment.compensation.percentage}%)
                </span>
              </div>
            )}

            <div className={styles.overallStatus} style={{ color: overallColor }}>
              {t('sla.overall_status')}: {getStatusLabel(assessment.overallStatus, t)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
