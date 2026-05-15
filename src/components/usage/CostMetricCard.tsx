import { memo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { IconDollarSign } from '@/components/ui/icons';
import { CostNumber } from '@/components/ui/SmartNumber';
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
import type { MetricCorrelation } from './hooks/useMetricCorrelation';
import { STAT_COLORS } from '@/constants/colors';
import styles from './CostMetricCard.module.scss';

interface CostMetricCardProps {
  totalCost: number;
  hasPrices: boolean;
  trend: MetricTrend;
  sparklineData: SparklineBundle | null;
  daySparklineData?: PeriodSparklineBundle | null;
  quotaStatus?: QuotaStatusItem | null;
  tpmCorrelation?: MetricCorrelation | null;
  dailyAvgCost?: number;
  loading?: boolean;
}

const MemoizedLine = memo(Line);

export const CostMetricCard = memo(function CostMetricCard({
  totalCost,
  hasPrices,
  trend,
  sparklineData,
  daySparklineData,
  quotaStatus,
  tpmCorrelation,
  dailyAvgCost,
  loading = false,
}: CostMetricCardProps) {
  const { t } = useTranslation();
  const [activePeriod, setActivePeriod] = useState<TrendPeriod>(trend.currentPeriod);

  const colors = STAT_COLORS.cost;
  const activeDelta = activePeriod === '7d' ? trend.delta7d : trend.delta30d;
  const activeDaySparklineData = daySparklineData?.[activePeriod] ?? daySparklineData?.['7d'] ?? null;
  const chartErrorLabel = t('usage_stats.loading_error');
  const chartFallback = (
    <div className={styles.trendPlaceholder} role="status" aria-label={chartErrorLabel}>
      {chartErrorLabel}
    </div>
  );

  const handlePeriodToggle = () => {
    setActivePeriod((prev) => (prev === '7d' ? '30d' : '7d'));
  };

  const predictedMonthly = dailyAvgCost && dailyAvgCost > 0 ? dailyAvgCost * 30 : null;

  if (loading) {
    return (
      <div
        className={styles.card}
        style={{
          '--accent': colors.accent,
          '--accent-soft': colors.soft,
          '--accent-border': colors.border,
        } as CSSProperties}
      >
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div
      className={styles.card}
      style={{
        '--accent': colors.accent,
        '--accent-soft': colors.soft,
        '--accent-border': colors.border,
      } as CSSProperties}
    >
      <div className={styles.header}>
        <div className={styles.labelGroup}>
          <span className={styles.iconBadge}>
            <IconDollarSign size={14} />
          </span>
          <span className={styles.label}>{t('usage_stats.total_cost')}</span>
        </div>
        <div className={styles.headerRight}>
          {quotaStatus && (
            <QuotaRing
              percentage={quotaStatus.usedPercent}
              size={28}
              strokeWidth={3}
              showLabel={true}
              alertLevel={quotaStatus.alertLevel}
            />
          )}
          {hasPrices && (
            <TrendBadge
              value={activeDelta}
              period={activePeriod}
              onPeriodToggle={handlePeriodToggle}
              variant="negative"
            />
          )}
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.mainValue}>
          {!hasPrices ? (
            <span className={styles.noPrice}>{t('usage_stats.cost_need_price')}</span>
          ) : (
            <>
              <CostNumber value={totalCost} />
              {predictedMonthly !== null && (
                <div className={styles.forecast}>
                  <span className={styles.forecastLabel}>{t('usage_stats.estimated_monthly')}:</span>
                  <CostNumber value={predictedMonthly} />
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.sideInfo}>
          {tpmCorrelation && tpmCorrelation.correlation !== null && (
            <div
              className={styles.correlation}
              title={t('usage_stats.tpm_cost_correlation_tooltip', {
                interpretation: t(
                  `usage_stats.correlation_${tpmCorrelation.interpretationKey}`
                ),
              })}
            >
              <span className={styles.correlationLabel}>
                {t('usage_stats.tpm_cost_correlation')}
              </span>
              <span className={styles.correlationValue}>
                {tpmCorrelation.correlation.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {hasPrices && (
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
      )}
    </div>
  );
});
