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
import cardStyles from './StatCards.module.scss';

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
  enhanced?: boolean;
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
        <div className={cardStyles.enhancedMeta}>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.current')}</span>
            <span className={cardStyles.rateValue}>
              <RateNumber value={rateStats.rpm} />
            </span>
          </div>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.peak')}</span>
            <span className={cardStyles.rateValue}>
              <RateNumber value={rateStats.peakRpm} />
            </span>
          </div>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.total_requests')}</span>
            <span className={cardStyles.rateValue}>{rateStats.requestCount.toLocaleString()}</span>
          </div>
        </div>
      ),
      trend: sparklines.rpm,
      enhanced: true,
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
        <div className={cardStyles.enhancedMeta}>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.current')}</span>
            <span className={cardStyles.rateValue}>
              <RateNumber value={rateStats.tpm} />
            </span>
          </div>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.peak')}</span>
            <span className={cardStyles.rateValue}>
              <RateNumber value={rateStats.peakTpm} />
            </span>
          </div>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.total_tokens')}</span>
            <span className={cardStyles.rateValue}>
              <TokenNumber value={rateStats.tokenCount} />
            </span>
          </div>
        </div>
      ),
      trend: sparklines.tpm,
      enhanced: true,
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
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}:{' '}
            {loading ? '-' : <TokenNumber value={totalTokens} />}
          </span>
          {!hasPrices && (
            <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
      trend: hasPrices ? sparklines.cost : null,
    },
  ];

  return (
    <div className={styles.statsGrid}>
      {statsCards.map((card) => (
        <div
          key={card.key}
          className={`${styles.statCard} ${card.enhanced ? cardStyles.enhancedCard : ''}`}
          style={
            {
              '--accent': card.accent,
              '--accent-soft': card.accentSoft,
              '--accent-border': card.accentBorder,
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            <span className={styles.statIconBadge}>{card.icon}</span>
          </div>
          <div className={styles.statValue}>{card.value}</div>
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
