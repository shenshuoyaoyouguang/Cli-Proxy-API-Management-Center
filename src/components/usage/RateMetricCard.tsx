import { memo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { IconTimer, IconTrendingUp } from '@/components/ui/icons';
import { RateNumber } from '@/components/ui/SmartNumber';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import { TrendBadge } from './TrendBadge';
import { QuotaRing } from './QuotaRing';
import type {
  SparklineBundle,
  PeriodSparklineBundle,
  TrendPeriod,
} from './hooks/useSparklines';
import type { MetricTrend } from './hooks/useMetricTrend';
import type { QuotaStatusItem } from './hooks/useQuotaStatus';
import { STAT_COLORS } from '@/constants/colors';
import styles from './RateMetricCard.module.scss';

interface RateMetricCardProps {
  metricType: 'rpm' | 'tpm';
  currentValue: number;
  peakValue: number;
  trend: MetricTrend;
  sparklineData: SparklineBundle | null;
  daySparklineData?: PeriodSparklineBundle | null;
  quotaStatus?: QuotaStatusItem | null;
  onDrilldown?: (metricType: string) => void;
  loading?: boolean;
}

const MemoizedLine = memo(Line);

const ICONS = {
  rpm: IconTimer,
  tpm: IconTrendingUp,
};

const LABELS = {
  rpm: 'usage_stats.rpm_30m',
  tpm: 'usage_stats.tpm_30m',
};

export const RateMetricCard = memo(function RateMetricCard({
  metricType,
  currentValue,
  peakValue,
  trend,
  sparklineData,
  daySparklineData,
  quotaStatus,
  onDrilldown,
  loading = false,
}: RateMetricCardProps) {
  const { t } = useTranslation();
  const [activePeriod, setActivePeriod] = useState<TrendPeriod>(trend.currentPeriod);

  const colors = STAT_COLORS[metricType];
  const Icon = ICONS[metricType];
  const label = t(LABELS[metricType]);
  const chartErrorLabel = t('usage_stats.loading_error');

  const activeDelta = activePeriod === '7d' ? trend.delta7d : trend.delta30d;
  const activeDaySparklineData = daySparklineData?.[activePeriod] ?? daySparklineData?.['7d'] ?? null;
  const chartFallback = (
    <div className={styles.trendPlaceholder} role="status" aria-label={chartErrorLabel}>
      {chartErrorLabel}
    </div>
  );

  const handlePeriodToggle = () => {
    setActivePeriod((prev) => (prev === '7d' ? '30d' : '7d'));
  };

  if (loading) {
    return (
      <div
        className={styles.card}
        style={
          {
            '--accent': colors.accent,
            '--accent-soft': colors.soft,
            '--accent-border': colors.border,
          } as CSSProperties
        }
      >
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div
      className={styles.card}
      style={
        {
          '--accent': colors.accent,
          '--accent-soft': colors.soft,
          '--accent-border': colors.border,
        } as CSSProperties
      }
    >
      <div className={styles.header}>
        <div className={styles.labelGroup}>
          <span className={styles.iconBadge}>
            <Icon size={14} />
          </span>
          <span className={styles.label}>{label}</span>
        </div>
        <div className={styles.headerRight}>
          {quotaStatus && quotaStatus.alertLevel !== 'normal' && (
            <QuotaRing
              percentage={quotaStatus.usedPercent}
              size={28}
              strokeWidth={3}
              showLabel={true}
              alertLevel={quotaStatus.alertLevel}
            />
          )}
          <TrendBadge
            value={activeDelta}
            period={activePeriod}
            onPeriodToggle={handlePeriodToggle}
            variant="positive"
          />
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.mainValue}>
          <RateNumber value={currentValue} />
        </div>
        <div className={styles.sideInfo}>
          <div className={styles.peakInfo}>
            <span className={styles.peakLabel}>{t('usage_stats.peak')}:</span>
            <RateNumber value={peakValue} />
          </div>
          {onDrilldown && (
            <button
              className={styles.drilldownBtn}
              onClick={() => onDrilldown(metricType)}
              type="button"
            >
              <span>{t('common.details')}</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>

      <div className={styles.trend}>
        <ErrorBoundary fallback={chartFallback}>
          {activeDaySparklineData ? (
            <MemoizedLine
              className={styles.sparkline}
              data={activeDaySparklineData.data}
              options={sparklineOptions}
            />
          ) : sparklineData ? (
            <MemoizedLine
              className={styles.sparkline}
              data={sparklineData.data}
              options={sparklineOptions}
            />
          ) : (
            <div className={styles.trendPlaceholder} />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
});
