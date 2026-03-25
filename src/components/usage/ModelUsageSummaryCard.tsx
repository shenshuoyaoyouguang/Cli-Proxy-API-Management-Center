import { type CSSProperties, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconModelCluster } from '@/components/ui/icons';
import { formatPercent } from '@/utils/numberFormat';
import { formatCompactNumber, formatUsd } from '@/utils/usage';
import { type ModelStat } from './ModelStatsCard';
import styles from '@/pages/UsagePage.module.scss';
import cardStyles from './StatCards.module.scss';

export interface ModelUsageSummaryCardProps {
  modelStats: ModelStat[];
  loading: boolean;
  hasPrices: boolean;
}

function getSuccessRateColor(rate: number): string {
  if (rate >= 95) return '#22c55e'; // green
  if (rate >= 80) return '#eab308'; // yellow
  return '#ef4444'; // red
}

export function ModelUsageSummaryCard({
  modelStats,
  loading,
  hasPrices,
}: ModelUsageSummaryCardProps) {
  const { t } = useTranslation();

  const summary = useMemo(() => {
    if (!modelStats || modelStats.length === 0) {
      return null;
    }

    // Active models count
    const activeModels = modelStats.length;

    // Top model by requests
    const topByRequests = modelStats.reduce(
      (max, stat) => (stat.requests > max.requests ? stat : max),
      modelStats[0]
    );

    // Top model by cost (if hasPrices)
    const topByCost = hasPrices
      ? modelStats.reduce((max, stat) => (stat.cost > max.cost ? stat : max), modelStats[0])
      : null;

    // Overall success rate
    const totalRequests = modelStats.reduce((sum, stat) => sum + stat.requests, 0);
    const totalSuccess = modelStats.reduce((sum, stat) => sum + stat.successCount, 0);
    const overallSuccessRate = totalRequests > 0 ? (totalSuccess / totalRequests) * 100 : 100;

    // Max requests for progress bar
    const maxRequests = Math.max(...modelStats.map((s) => s.requests), 1);
    const maxCost = hasPrices ? Math.max(...modelStats.map((s) => s.cost), 0.01) : 0;

    return {
      activeModels,
      topByRequests,
      topByCost,
      overallSuccessRate,
      maxRequests,
      maxCost,
    };
  }, [modelStats, hasPrices]);

  const accentColor = '#6366f1'; // indigo

  return (
    <div
      className={`${styles.statCard} ${cardStyles.healthScoreCard}`}
      style={
        {
          '--accent': accentColor,
          '--accent-soft': 'rgba(99, 102, 241, 0.18)',
          '--accent-border': 'rgba(99, 102, 241, 0.5)',
        } as CSSProperties
      }
    >
      <div className={styles.statCardHeader}>
        <div className={styles.statLabelGroup}>
          <span className={styles.statLabel}>{t('model_usage_summary.title')}</span>
          <div className={cardStyles.cardHeaderMeta}>
            <span className={cardStyles.cardBadge}>{t('model_usage_summary.active_models')}</span>
          </div>
        </div>
        <span className={styles.statIconBadge}>
          <IconModelCluster size={16} />
        </span>
      </div>

      {loading ? (
        <div className={cardStyles.placeholderBody}>
          <span className={cardStyles.placeholderTitle}>{t('common.loading')}</span>
          <span className={cardStyles.placeholderText}>
            {t('model_usage_summary.no_data_desc')}
          </span>
        </div>
      ) : !summary ? (
        <div className={cardStyles.placeholderBody}>
          <span className={cardStyles.placeholderTitle}>
            {t('model_usage_summary.no_data_title')}
          </span>
          <span className={cardStyles.placeholderText}>
            {t('model_usage_summary.no_data_desc')}
          </span>
        </div>
      ) : (
        <div className={cardStyles.healthScoreContent}>
          {/* Active Models Count */}
          <div className={cardStyles.scoreSection}>
            <div className={cardStyles.scoreInfo}>
              <span className={cardStyles.scoreValue}>{summary.activeModels}</span>
              <span className={cardStyles.scoreTrend}>
                {t('model_usage_summary.active_models')}
              </span>
            </div>
          </div>

          {/* Metrics Section */}
          <div className={cardStyles.metricsSection}>
            {/* Top by Requests */}
            <div className={cardStyles.metricRow}>
              <div className={cardStyles.metricInfo}>
                <span className={cardStyles.metricLabel}>
                  {t('model_usage_summary.top_by_requests')}
                </span>
                <span className={cardStyles.metricValue}>{summary.topByRequests.model}</span>
              </div>
              <div className={cardStyles.metricBar}>
                <div
                  className={cardStyles.metricBarFill}
                  style={{
                    width: `${(summary.topByRequests.requests / summary.maxRequests) * 100}%`,
                    backgroundColor: accentColor,
                  }}
                />
              </div>
              <span className={cardStyles.metricEvidence}>
                {formatCompactNumber(summary.topByRequests.requests)}
              </span>
            </div>

            {/* Top by Cost (if hasPrices) */}
            {hasPrices && summary.topByCost && summary.topByCost.cost > 0 && (
              <div className={cardStyles.metricRow}>
                <div className={cardStyles.metricInfo}>
                  <span className={cardStyles.metricLabel}>
                    {t('model_usage_summary.top_by_cost')}
                  </span>
                  <span className={cardStyles.metricValue}>{summary.topByCost.model}</span>
                </div>
                <div className={cardStyles.metricBar}>
                  <div
                    className={cardStyles.metricBarFill}
                    style={{
                      width: `${(summary.topByCost.cost / summary.maxCost) * 100}%`,
                      backgroundColor: accentColor,
                    }}
                  />
                </div>
                <span className={cardStyles.metricEvidence}>
                  {formatUsd(summary.topByCost.cost)}
                </span>
              </div>
            )}

            {/* Overall Success Rate */}
            <div className={cardStyles.metricRow}>
              <div className={cardStyles.metricInfo}>
                <span className={cardStyles.metricLabel}>
                  {t('model_usage_summary.overall_success_rate')}
                </span>
              </div>
              <div className={cardStyles.metricBar}>
                <div
                  className={cardStyles.metricBarFill}
                  style={{
                    width: `${summary.overallSuccessRate}%`,
                    backgroundColor: getSuccessRateColor(summary.overallSuccessRate),
                  }}
                />
              </div>
              <span
                className={cardStyles.metricGrade}
                style={{ color: getSuccessRateColor(summary.overallSuccessRate) }}
              >
                {formatPercent(summary.overallSuccessRate / 100)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
