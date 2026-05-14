import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { IconShield } from '@/components/ui/icons';
import { formatPercent } from '@/utils/numberFormat';
import type {
  RuntimeIncidentType,
  RuntimeQualityStatus,
  RuntimeQualitySummary
} from './hooks/usageAnalyticsSnapshot';
import styles from './RuntimeQualityCard.module.scss';

interface RuntimeQualityCardProps {
  summary: RuntimeQualitySummary;
  loading: boolean;
}

const STATUS_CLASS_BY_STATUS: Record<RuntimeQualityStatus, string> = {
  healthy: styles.statusHealthy,
  warning: styles.statusWarning,
  critical: styles.statusCritical,
  insufficient: styles.statusEmpty,
  empty: styles.statusEmpty
};

const STATUS_LABEL_KEY_BY_STATUS: Record<RuntimeQualityStatus, string> = {
  healthy: 'usage_quality.status_healthy',
  warning: 'usage_quality.status_warning',
  critical: 'usage_quality.status_critical',
  insufficient: 'usage_quality.status_insufficient',
  empty: 'usage_quality.status_empty'
};

const DESCRIPTION_KEY_BY_STATUS: Record<RuntimeQualityStatus, string> = {
  healthy: 'usage_quality.summary_healthy',
  warning: 'usage_quality.summary_warning',
  critical: 'usage_quality.summary_critical',
  insufficient: 'usage_quality.summary_insufficient',
  empty: 'usage_quality.summary_empty'
};

const INCIDENT_LABEL_KEY_BY_TYPE: Record<Exclude<RuntimeIncidentType, 'none'>, string> = {
  credential: 'usage_quality.incident_credential',
  endpoint: 'usage_quality.incident_endpoint',
  model: 'usage_quality.incident_model'
};

export function RuntimeQualityCard({ summary, loading }: RuntimeQualityCardProps) {
  const { t } = useTranslation();

  const statusLabel = t(STATUS_LABEL_KEY_BY_STATUS[summary.status]);
  const description = t(DESCRIPTION_KEY_BY_STATUS[summary.status]);
  const primaryIncident = summary.primaryIncident;
  const hasPrimaryIncident = primaryIncident.type !== 'none';

  const primaryIncidentTitle = hasPrimaryIncident
    ? `${t('usage_quality.check_first')}: ${primaryIncident.name}`
    : t('usage_quality.no_primary_incident');

  const primaryIncidentTypeLabel = hasPrimaryIncident
    ? t(INCIDENT_LABEL_KEY_BY_TYPE[primaryIncident.type as Exclude<RuntimeIncidentType, 'none'>])
    : '';

  const primaryIncidentMeta = hasPrimaryIncident
    ? `${primaryIncidentTypeLabel} · ${t('usage_quality.failure_rate')} ${formatPercent(primaryIncident.failureRate)} · ${t('usage_stats.failed_requests')} ${primaryIncident.failureCount.toLocaleString()}`
    : t('usage_quality.no_primary_incident_desc');

  return (
    <Card
      className={styles.card}
      title={
        <span className={styles.cardHeader}>
          <span className={styles.cardIcon}>
            <IconShield size={16} />
          </span>
          {t('usage_quality.title')}
        </span>
      }
      extra={
        <span className={`${styles.statusBadge} ${STATUS_CLASS_BY_STATUS[summary.status]}`}>
          {loading && !summary.hasData ? t('common.loading') : statusLabel}
        </span>
      }
    >
      <p className={styles.description}>{description}</p>

      {!summary.dataConsistent && summary.hasData && (
        <div className={styles.dataInconsistencyBanner}>
          {t('usage_quality.data_inconsistent')}
        </div>
      )}

      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('usage_quality.overall_success_rate')}</span>
          <strong className={styles.metricValue}>{summary.hasData ? formatPercent(summary.overallSuccessRate) : '--'}</strong>
          <span className={styles.metricHint}>
            {t('usage_stats.total_requests')}: {summary.totalRequests.toLocaleString()}
          </span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('usage_stats.failed_requests')}</span>
          <strong className={styles.metricValue}>{summary.hasData ? summary.failureCount.toLocaleString() : '--'}</strong>
          <span className={styles.metricHint}>{t('usage_quality.failure_volume_hint')}</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('usage_quality.abnormal_windows')}</span>
          <strong className={styles.metricValue}>{summary.hasData ? summary.abnormalWindowCount.toLocaleString() : '--'}</strong>
          <span className={styles.metricHint}>
            {t('usage_quality.severe_windows')}: {summary.severeWindowCount.toLocaleString()}
          </span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('usage_quality.affected_credentials')}</span>
          <strong className={styles.metricValue}>{summary.hasData ? summary.affectedCredentialCount.toLocaleString() : '--'}</strong>
          <span className={styles.metricHint}>{t('usage_stats.credential_stats')}</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t('usage_quality.affected_endpoints')}</span>
          <strong className={styles.metricValue}>{summary.hasData ? summary.affectedEndpointCount.toLocaleString() : '--'}</strong>
          <span className={styles.metricHint}>{t('usage_stats.api_details')}</span>
        </div>
      </div>

      <div className={styles.primaryIncidentCard}>
        <span className={styles.primaryIncidentLabel}>{t('usage_quality.primary_incident')}</span>
        <strong className={styles.primaryIncidentValue}>{primaryIncidentTitle}</strong>
        <span className={styles.primaryIncidentMeta}>{primaryIncidentMeta}</span>
      </div>
    </Card>
  );
}

export type { RuntimeQualityCardProps };
