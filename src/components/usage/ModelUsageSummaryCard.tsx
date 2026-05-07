import { type CSSProperties, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconModelCluster } from '@/components/ui/icons';
import { formatPercent } from '@/utils/numberFormat';
import { formatCompactNumber, formatUsd } from '@/utils/usage';
import { SUCCESS_RATE_COLORS, MODEL_USAGE_SUMMARY } from '@/constants/colors';
import { type ModelStat } from './ModelStatsCard';
import styles from './ModelUsageSummaryCard.module.scss';

export interface ModelUsageSummaryCardProps {
  modelStats: ModelStat[];
  loading: boolean;
  hasPrices: boolean;
}

function getSuccessRateColor(rate: number): string {
  if (rate >= 95) return SUCCESS_RATE_COLORS.excellent;
  if (rate >= 80) return SUCCESS_RATE_COLORS.good;
  return SUCCESS_RATE_COLORS.poor;
}

export const ModelUsageSummaryCard = memo(function ModelUsageSummaryCard({
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

  const accentColor = MODEL_USAGE_SUMMARY.accent;

  return (
    <div
      className={styles.card}
      style={
        {
          '--accent': accentColor,
          '--accent-soft': MODEL_USAGE_SUMMARY.soft,
          '--accent-border': MODEL_USAGE_SUMMARY.border,
        } as CSSProperties
      }
    >
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardTitle}>
            <span className={styles.cardIcon}>
              <IconModelCluster size={16} />
            </span>
            {t('model_usage_summary.title')}
          </div>
          <div className={styles.cardHeaderMeta}>
            <span className={styles.cardBadge}>{t('model_usage_summary.active_models')}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className={styles.placeholderBody}>
          <span className={styles.placeholderTitle}>{t('common.loading')}</span>
          <span className={styles.placeholderText}>
            {t('model_usage_summary.no_data_desc')}
          </span>
        </div>
      ) : !summary ? (
        <div className={styles.placeholderBody}>
          <span className={styles.placeholderTitle}>
            {t('model_usage_summary.no_data_title')}
          </span>
          <span className={styles.placeholderText}>
            {t('model_usage_summary.no_data_desc')}
          </span>
        </div>
      ) : (
        <div className={styles.healthScoreContent}>
          {/* Active Models Count */}
          <div className={styles.scoreSection}>
            <div className={styles.scoreInfo}>
              <span className={styles.scoreValue}>{summary.activeModels}</span>
              <span className={styles.scoreTrend}>
                {t('model_usage_summary.active_models')}
              </span>
            </div>
          </div>

          {/* Metrics Section */}
          <div className={styles.metricsSection}>
            {/* Top by Requests */}
            <div className={styles.metricRow}>
              <div className={styles.metricInfo}>
                <span className={styles.metricLabel}>
                  {t('model_usage_summary.top_by_requests')}
                </span>
                <span className={styles.metricValue}>{summary.topByRequests.model}</span>
              </div>
              <div className={styles.metricBar}>
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${(summary.topByRequests.requests / summary.maxRequests) * 100}%`,
                    backgroundColor: accentColor,
                  }}
                />
              </div>
              <span className={styles.metricEvidence}>
                {formatCompactNumber(summary.topByRequests.requests)}
              </span>
            </div>

            {/* Top by Cost (if hasPrices) */}
            {hasPrices && summary.topByCost && summary.topByCost.cost > 0 && (
              <div className={styles.metricRow}>
                <div className={styles.metricInfo}>
                  <span className={styles.metricLabel}>
                    {t('model_usage_summary.top_by_cost')}
                  </span>
                  <span className={styles.metricValue}>{summary.topByCost.model}</span>
                </div>
                <div className={styles.metricBar}>
                  <div
                    className={styles.metricBarFill}
                    style={{
                      width: `${(summary.topByCost.cost / summary.maxCost) * 100}%`,
                      backgroundColor: accentColor,
                    }}
                  />
                </div>
                <span className={styles.metricEvidence}>
                  {formatUsd(summary.topByCost.cost)}
                </span>
              </div>
            )}

            {/* Overall Success Rate */}
            <div className={styles.metricRow}>
              <div className={styles.metricInfo}>
                <span className={styles.metricLabel}>
                  {t('model_usage_summary.overall_success_rate')}
                </span>
              </div>
              <div className={styles.metricBar}>
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${summary.overallSuccessRate}%`,
                    backgroundColor: getSuccessRateColor(summary.overallSuccessRate),
                  }}
                />
              </div>
              <span
                className={styles.metricGrade}
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
});
