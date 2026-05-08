import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './TrendBadge.module.scss';

interface TrendBadgeProps {
  value: number | null;
  period: '7d' | '30d';
  onPeriodToggle?: () => void;
  variant?: 'positive' | 'negative';
  loading?: boolean;
}

export const TrendBadge = memo(function TrendBadge({
  value,
  period,
  onPeriodToggle,
  variant = 'positive',
  loading = false,
}: TrendBadgeProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <span className={`${styles.badge} ${styles.loading}`}>
        <span className={styles.skeleton} />
      </span>
    );
  }

  if (value === null || value === 0) {
    return (
      <span className={`${styles.badge} ${styles.neutral}`}>
        <span className={styles.skeleton} />
      </span>
    );
  }

  const isUp = value > 0;
  const absValue = Math.abs(value);
  const isPositiveSignal = variant === 'negative' ? !isUp : isUp;
  const colorClass = isPositiveSignal ? styles.up : styles.down;
  const periodLabel = period === '7d' ? t('usage_stats.range_7d') : t('usage_stats.range_30d');

  const tooltip = t('usage_stats.trend_tooltip', {
    direction: isUp ? '▲' : '▼',
    value: absValue.toFixed(1),
    period: periodLabel,
  });

  return (
    <button
      className={`${styles.badge} ${styles.interactive} ${colorClass}`}
      onClick={onPeriodToggle}
      title={tooltip}
      aria-label={tooltip}
      type="button"
    >
      <span className={styles.arrow}>{isUp ? '▲' : '▼'}</span>
      <span className={styles.value}>{absValue.toFixed(1)}%</span>
      <span className={styles.period}>{period}</span>
    </button>
  );
});
