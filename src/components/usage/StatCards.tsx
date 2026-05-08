import { type ReactNode, memo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';

const MemoizedLine = memo(Line);
import {
  IconDiamond,
  IconSatellite,
} from '@/components/ui/icons';
import { TokenNumber } from '@/components/ui/SmartNumber';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import type { SparklineBundle, PeriodSparklineBundle } from './hooks/useSparklines';
import type { UsageSummaryMetrics } from './hooks/usageAnalyticsSnapshot';
import { RateMetricCard } from './RateMetricCard';
import { CostMetricCard } from './CostMetricCard';
import { MetricSummaryBanner } from './MetricSummaryBanner';
import { STAT_COLORS, STATUS_COLORS } from '@/constants/colors';
import { useMetricTrend } from './hooks/useMetricTrend';
import { useQuotaStatus } from './hooks/useQuotaStatus';
import { useMetricCorrelation } from './hooks/useMetricCorrelation';
import type { UsageDetail } from '@/atoms/usage/types';
import type { ModelPrice } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

interface StatCardData {
  key: string;
  label: string;
  icon: ReactNode;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  value: string | ReactNode;
  meta?: ReactNode;
  trend: SparklineBundle | null;
  size: 'large' | 'medium' | 'small';
}

export interface StatCardsProps {
  usage: UsagePayload | null;
  loading: boolean;
  hasPrices: boolean;
  usageSummary: UsageSummaryMetrics;
  usageDetails: UsageDetail[];
  modelPrices: Record<string, ModelPrice>;
  nowMs: number;
  onMetricDrillDown?: (metricType: string) => void;
  sparklines: {
    requests: SparklineBundle | null;
    tokens: SparklineBundle | null;
    rpm: SparklineBundle | null;
    tpm: SparklineBundle | null;
    cost: SparklineBundle | null;
    dayRpm: PeriodSparklineBundle;
    dayTpm: PeriodSparklineBundle;
    dayCost: PeriodSparklineBundle;
  };
}

export const StatCards = memo(function StatCards({
  usage,
  loading,
  hasPrices,
  usageSummary,
  usageDetails,
  modelPrices,
  nowMs,
  onMetricDrillDown,
  sparklines,
}: StatCardsProps) {
  const { t } = useTranslation();

  const { totalTokens, tokenBreakdown, rateStats, totalCost } = usageSummary;

  const rpmTrend = useMetricTrend(usageDetails, nowMs, 'rpm', modelPrices);
  const tpmTrend = useMetricTrend(usageDetails, nowMs, 'tpm', modelPrices);
  const costTrend = useMetricTrend(usageDetails, nowMs, 'cost', modelPrices);
  const quotaStatus = useQuotaStatus();
  const tpmCorrelation = useMetricCorrelation(usageDetails, nowMs, modelPrices);
  const weeklyCostPoints = sparklines.dayCost['7d']?.data.datasets[0]?.data ?? [];
  const dailyAvgCost =
    weeklyCostPoints.length > 0
      ? weeklyCostPoints.reduce((sum, value) => sum + value, 0) / weeklyCostPoints.length
      : undefined;

  const statsCards: StatCardData[] = [
    {
      key: 'requests',
      label: t('usage_stats.total_requests'),
      icon: <IconSatellite size={16} />,
      accent: STAT_COLORS.requests.accent,
      accentSoft: STAT_COLORS.requests.soft,
      accentBorder: STAT_COLORS.requests.border,
      value: loading ? '-' : (usage?.total_requests ?? 0).toLocaleString(),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            <span
              className={styles.statMetaDot}
              style={{ backgroundColor: STATUS_COLORS.success }}
            />
            {t('usage_stats.success_requests')}: {loading ? '-' : (usage?.success_count ?? 0)}
          </span>
          <span className={styles.statMetaItem}>
            <span
              className={styles.statMetaDot}
              style={{ backgroundColor: STATUS_COLORS.failure }}
            />
            {t('usage_stats.failed_requests')}: {loading ? '-' : (usage?.failure_count ?? 0)}
          </span>
        </>
      ),
      trend: sparklines.requests,
      size: 'large',
    },
    {
      key: 'tokens',
      label: t('usage_stats.total_tokens'),
      icon: <IconDiamond size={16} />,
      accent: STAT_COLORS.tokens.accent,
      accentSoft: STAT_COLORS.tokens.soft,
      accentBorder: STAT_COLORS.tokens.border,
      value: loading ? '-' : <TokenNumber value={totalTokens} />,
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cached_tokens')}:{' '}
            {loading ? '-' : <TokenNumber value={tokenBreakdown.cachedTokens} />}
          </span>
          <span className={styles.statMetaItem}>
            {t('usage_stats.reasoning_tokens')}:{' '}
            {loading ? '-' : <TokenNumber value={tokenBreakdown.reasoningTokens} />}
          </span>
        </>
      ),
      trend: sparklines.tokens,
      size: 'large',
    },
  ];

  const getCardSizeClass = (size: StatCardData['size']) => {
    switch (size) {
      case 'large':
        return styles.cardLarge;
      case 'medium':
        return styles.cardMedium;
      case 'small':
      default:
        return styles.cardSmall;
    }
  };

  const SKELETON_SIZES: StatCardData['size'][] = ['large', 'large'];

  if (loading && !usage) {
    return (
      <div className={styles.statsGrid}>
        {SKELETON_SIZES.map((size, index) => (
          <div
            key={`skeleton-${index}`}
            className={getCardSizeClass(size)}
            style={{ animationDelay: `${index * 50}ms` } as CSSProperties}
          >
            <SkeletonCard />
          </div>
        ))}
        <div className={styles.cardMedium} style={{ gridColumn: 'span 1' }}>
          <SkeletonCard />
        </div>
        <div className={styles.cardMedium} style={{ gridColumn: 'span 1' }}>
          <SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.statsGrid}>
      <MetricSummaryBanner
        rpmTrend={rpmTrend}
        tpmTrend={tpmTrend}
        costTrend={costTrend}
        loading={loading}
      />
      {statsCards.map((card, index) => (
        <div
          key={card.key}
          className={`${styles.statCard} ${getCardSizeClass(card.size)}`}
          style={
            {
              '--accent': card.accent,
              '--accent-soft': card.accentSoft,
              '--accent-border': card.accentBorder,
              animationDelay: `${index * 50}ms`,
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            <span className={styles.statIconBadge}>{card.icon}</span>
          </div>
          <div className={`${styles.statValue} ${card.size === 'small' ? styles.statValueSmall : ''}`}>
            {card.value}
          </div>
          {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
          <div className={styles.statTrend}>
            {card.trend ? (
              <MemoizedLine
                className={styles.sparkline}
                data={card.trend.data}
                options={sparklineOptions}
              />
            ) : (
              <div className={styles.statTrendPlaceholder}></div>
            )}
          </div>
        </div>
      ))}

      <div className={styles.metricCardRow}>
        <RateMetricCard
          metricType="rpm"
          currentValue={rateStats.rpm}
          peakValue={rateStats.peakRpm}
          trend={rpmTrend}
          sparklineData={sparklines.rpm}
          daySparklineData={sparklines.dayRpm}
          quotaStatus={quotaStatus.rpmItem}
          onDrilldown={onMetricDrillDown}
          loading={loading}
        />
        <RateMetricCard
          metricType="tpm"
          currentValue={rateStats.tpm}
          peakValue={rateStats.peakTpm}
          trend={tpmTrend}
          sparklineData={sparklines.tpm}
          daySparklineData={sparklines.dayTpm}
          quotaStatus={quotaStatus.tpmItem}
          onDrilldown={onMetricDrillDown}
          loading={loading}
        />
      </div>

      <div className={styles.costCardWrapper}>
        <CostMetricCard
          totalCost={totalCost}
          hasPrices={hasPrices}
          trend={costTrend}
          sparklineData={sparklines.cost}
          daySparklineData={sparklines.dayCost}
          quotaStatus={quotaStatus.monthlyItem}
          tpmCorrelation={tpmCorrelation}
          dailyAvgCost={dailyAvgCost}
          onDrilldown={onMetricDrillDown ? () => onMetricDrillDown('cost') : undefined}
          loading={loading}
        />
      </div>
    </div>
  );
});
