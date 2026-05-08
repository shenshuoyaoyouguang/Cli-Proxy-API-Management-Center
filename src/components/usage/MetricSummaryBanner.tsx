import { memo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { STAT_COLORS } from '@/constants/colors';
import type { MetricTrend } from './hooks/useMetricTrend';
import styles from './MetricSummaryBanner.module.scss';

interface MetricSummaryBannerProps {
  rpmTrend: Pick<MetricTrend, 'delta7d' | 'delta30d'>;
  tpmTrend: Pick<MetricTrend, 'delta7d' | 'delta30d'>;
  costTrend: Pick<MetricTrend, 'delta7d' | 'delta30d'>;
  loading?: boolean;
}

function TrendChip({
  label,
  value,
  color,
  variant = 'positive',
}: {
  label: string;
  value: number | null;
  color: string;
  variant?: 'positive' | 'negative';
}) {
  if (value === null) return null;
  const isUp = value >= 0;
  const isPositiveSignal = variant === 'negative' ? !isUp : isUp;
  return (
    <span className={styles.chip} style={{ '--chip-color': color } as CSSProperties}>
      <span className={styles.chipLabel}>{label}</span>
      <span className={`${styles.chipValue} ${isPositiveSignal ? styles.up : styles.down}`}>
        {isUp ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
      </span>
    </span>
  );
}

export const MetricSummaryBanner = memo(function MetricSummaryBanner({
  rpmTrend,
  tpmTrend,
  costTrend,
  loading = false,
}: MetricSummaryBannerProps) {
  const { t } = useTranslation();

  if (loading) return null;

  const hasData =
    rpmTrend.delta7d !== null || tpmTrend.delta7d !== null || costTrend.delta7d !== null;
  if (!hasData) return null;

  const labelCost = t('usage_stats.total_cost');

  return (
    <div
      className={styles.banner}
      role="status"
      aria-live="polite"
      aria-label={t('usage_stats.weekly_summary')}
    >
      <span className={styles.bannerLabel}>{t('usage_stats.weekly_summary')}</span>
      <div className={styles.chips}>
        <TrendChip label="RPM" value={rpmTrend.delta7d} color={STAT_COLORS.rpm.accent} />
        <TrendChip label="TPM" value={tpmTrend.delta7d} color={STAT_COLORS.tpm.accent} />
        <TrendChip
          label={labelCost}
          value={costTrend.delta7d}
          color={STAT_COLORS.cost.accent}
          variant="negative"
        />
      </div>
    </div>
  );
});
