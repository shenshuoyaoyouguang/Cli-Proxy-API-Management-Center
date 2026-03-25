import { useMemo, type ReactNode, memo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
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
import {
  calculateCost,
  extractTotalTokens,
  type ModelPrice,
  type UsageDetail,
} from '@/utils/usage';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import type { SparklineBundle } from './hooks/useSparklines';
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

interface StatCardsSummary {
  tokenBreakdown: {
    cachedTokens: number;
    reasoningTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
  rateStats: {
    rpm: number;
    tpm: number;
    windowMinutes: number;
    requestCount: number;
    tokenCount: number;
    peakRpm: number;
    peakTpm: number;
  };
  totalCost: number;
}

export interface StatCardsProps {
  usage: UsagePayload | null;
  details: UsageDetail[];
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  nowMs: number;
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
  details: usageDetails,
  loading,
  modelPrices,
  nowMs,
  healthAssessment,
  slaAssessment,
  onAvailabilityDrillDown,
  onSuccessRateDrillDown,
  sparklines,
}: StatCardsProps) {
  const { t } = useTranslation();

  const hasPrices = Object.keys(modelPrices).length > 0;

  const modelStats = useMemo<ModelStat[]>(() => {
    if (!usage?.by_model) return [];

    return Object.entries(usage.by_model)
      .map(([model, data]) => {
        const requests = data.total || 0;
        const successCount = data.success || 0;
        const failureCount = data.failure || 0;
        const tokens = data.tokens || 0;
        const cost = hasPrices ? data.cost || 0 : 0;

        return {
          model,
          requests,
          successCount,
          failureCount,
          tokens,
          cost,
        };
      })
      .filter((m) => m.requests > 0);
  }, [usage, hasPrices]);

  const { tokenBreakdown, rateStats, totalCost } = useMemo<StatCardsSummary>(() => {
    const empty = {
      tokenBreakdown: { cachedTokens: 0, reasoningTokens: 0, inputTokens: 0, outputTokens: 0 },
      rateStats: {
        rpm: 0,
        tpm: 0,
        windowMinutes: 30,
        requestCount: 0,
        tokenCount: 0,
        peakRpm: 0,
        peakTpm: 0,
      },
      totalCost: 0,
    };

    if (!usage) return empty;
    if (!usageDetails.length) return empty;

    let cachedTokens = 0;
    let reasoningTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCost = 0;

    const now = nowMs;
    const windowMinutes = 30;
    const windowStart = now - windowMinutes * 60 * 1000;
    let requestCount = 0;
    let tokenCount = 0;
    const hasValidNow = Number.isFinite(now) && now > 0;

    const minuteBuckets = new Map<number, { requests: number; tokens: number }>();

    usageDetails.forEach((detail) => {
      const tokens = detail.tokens;
      const cached = Math.max(
        typeof tokens.cached_tokens === 'number' ? Math.max(tokens.cached_tokens, 0) : 0,
        typeof tokens.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0
      );
      cachedTokens += cached;
      if (typeof tokens.reasoning_tokens === 'number') {
        reasoningTokens += tokens.reasoning_tokens;
      }
      if (typeof tokens.input_tokens === 'number') {
        inputTokens += tokens.input_tokens;
      }
      if (typeof tokens.output_tokens === 'number') {
        outputTokens += tokens.output_tokens;
      }

      const timestamp = detail.__timestampMs ?? 0;
      if (
        hasValidNow &&
        Number.isFinite(timestamp) &&
        timestamp >= windowStart &&
        timestamp <= now
      ) {
        requestCount += 1;
        tokenCount += extractTotalTokens(detail);

        const minuteKey = Math.floor(timestamp / 60000);
        const existing = minuteBuckets.get(minuteKey);
        if (existing) {
          existing.requests += 1;
          existing.tokens += extractTotalTokens(detail);
        } else {
          minuteBuckets.set(minuteKey, { requests: 1, tokens: extractTotalTokens(detail) });
        }
      }

      if (hasPrices) {
        totalCost += calculateCost(detail, modelPrices);
      }
    });

    let peakRpm = 0;
    let peakTpm = 0;
    minuteBuckets.forEach((bucket) => {
      peakRpm = Math.max(peakRpm, bucket.requests);
      peakTpm = Math.max(peakTpm, bucket.tokens);
    });

    const denominator = windowMinutes > 0 ? windowMinutes : 1;

    return {
      tokenBreakdown: { cachedTokens, reasoningTokens, inputTokens, outputTokens },
      rateStats: {
        rpm: requestCount / denominator,
        tpm: tokenCount / denominator,
        windowMinutes,
        requestCount,
        tokenCount,
        peakRpm,
        peakTpm,
      },
      totalCost,
    };
  }, [hasPrices, modelPrices, nowMs, usage, usageDetails]);

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
      value: loading ? '-' : <TokenNumber value={usage?.total_tokens ?? 0} />,
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
            {loading ? '-' : <TokenNumber value={usage?.total_tokens ?? 0} />}
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
              <Line
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
