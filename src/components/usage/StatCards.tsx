import { type ReactNode, memo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';

const MemoizedLine = memo(Line);
import {
  IconDiamond,
  IconDollarSign,
  IconSatellite,
  IconTimer,
  IconTrendingUp,
} from '@/components/ui/icons';
import { TokenNumber, CostNumber, RateNumber } from '@/components/ui/SmartNumber';
import { SkeletonCard } from '@/components/ui/Skeleton';
import type { HealthScore } from '@/utils/usage/healthScore';
import type { SLAMetrics } from '@/utils/usage/slaCalculator';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import type { SparklineBundle } from './hooks/useSparklines';
import type { UsageSummaryMetrics } from './hooks/usageAnalyticsSnapshot';
import { HealthScoreCard } from './HealthScoreCard';
import { SLAMonitorCard } from './SLAMonitorCard';
import { ModelUsageSummaryCard } from './ModelUsageSummaryCard';
import type { ModelStat } from './ModelStatsCard';
import { STAT_COLORS, STATUS_COLORS } from '@/constants/colors';
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
  modelStats: ModelStat[];
  usageSummary: UsageSummaryMetrics;
  healthAssessment: HealthScore;
  slaAssessment: SLAMetrics;
  onAvailabilityDrillDown?: () => void;
  onSuccessRateDrillDown?: () => void;
  sparklines: {
    requests: SparklineBundle | null;
    tokens: SparklineBundle | null;
    rpm: SparklineBundle | null;
    tpm: SparklineBundle | null;
    cost: SparklineBundle | null;
  };
}

export const StatCards = memo(function StatCards({
  usage,
  loading,
  hasPrices,
  modelStats,
  usageSummary,
  healthAssessment,
  slaAssessment,
  onAvailabilityDrillDown,
  onSuccessRateDrillDown,
  sparklines,
}: StatCardsProps) {
  const { t } = useTranslation();

  const { totalTokens, tokenBreakdown, rateStats, totalCost } = usageSummary;

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
    {
      key: 'rpm',
      label: t('usage_stats.rpm_30m'),
      icon: <IconTimer size={16} />,
      accent: STAT_COLORS.rpm.accent,
      accentSoft: STAT_COLORS.rpm.soft,
      accentBorder: STAT_COLORS.rpm.border,
      value: loading ? '-' : <RateNumber value={rateStats.rpm} />,
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.peak')}: <RateNumber value={rateStats.peakRpm} />
          </span>
        </>
      ),
      trend: sparklines.rpm,
      size: 'small',
    },
    {
      key: 'tpm',
      label: t('usage_stats.tpm_30m'),
      icon: <IconTrendingUp size={16} />,
      accent: STAT_COLORS.tpm.accent,
      accentSoft: STAT_COLORS.tpm.soft,
      accentBorder: STAT_COLORS.tpm.border,
      value: loading ? '-' : <RateNumber value={rateStats.tpm} />,
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.peak')}: <RateNumber value={rateStats.peakTpm} />
          </span>
        </>
      ),
      trend: sparklines.tpm,
      size: 'small',
    },
    {
      key: 'cost',
      label: t('usage_stats.total_cost'),
      icon: <IconDollarSign size={16} />,
      accent: STAT_COLORS.cost.accent,
      accentSoft: STAT_COLORS.cost.soft,
      accentBorder: STAT_COLORS.cost.border,
      value: loading ? '-' : hasPrices ? <CostNumber value={totalCost} /> : '--',
      meta: (
        <>
          {!hasPrices && (
            <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
      trend: hasPrices ? sparklines.cost : null,
      size: 'small',
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

  const SKELETON_SIZES: StatCardData['size'][] = ['large', 'large', 'small', 'small', 'small'];

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
        <div className={styles.cardMedium}>
          <SkeletonCard rows={2} />
        </div>
        <div className={styles.cardMedium}>
          <SkeletonCard rows={2} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.statsGrid}>
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

      <HealthScoreCard
        assessment={healthAssessment}
        loading={loading}
        onAvailabilityDrillDown={onAvailabilityDrillDown}
        onSuccessRateDrillDown={onSuccessRateDrillDown}
      />

      <SLAMonitorCard assessment={slaAssessment} loading={loading} />

      <ModelUsageSummaryCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
    </div>
  );
});
