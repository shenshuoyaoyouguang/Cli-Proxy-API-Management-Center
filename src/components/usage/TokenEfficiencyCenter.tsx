import { useMemo, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { IconDollarSign, IconExternalLink, IconTarget, IconTrendingUp, IconZap } from '@/components/ui/icons';
import { formatPercent } from '@/utils/numberFormat';
import { formatCompactNumber } from '@/utils/usage';
import type {
  CredentialEfficiencyRow,
  EfficiencyOverview,
  EfficiencySignal,
  ModelEfficiencyRow
} from './hooks/usageAnalyticsSnapshot';
import styles from './TokenEfficiencyCenter.module.scss';

export interface EfficiencyDrilldown {
  type: 'model' | 'credential' | 'none';
  value?: string;
}

interface TokenEfficiencyCenterProps {
  overview: EfficiencyOverview;
  modelRows: ModelEfficiencyRow[];
  credentialRows: CredentialEfficiencyRow[];
  loading: boolean;
  onDrilldownChange: (drilldown: EfficiencyDrilldown) => void;
}

const SIGNAL_PRIORITY: EfficiencySignal[] = [
  'high_failure_waste',
  'low_cache_reuse',
  'low_output_yield',
  'low_cost_yield',
  'cost_not_enabled'
];

const getSignalTone = (signal: EfficiencySignal) => {
  switch (signal) {
    case 'high_failure_waste':
    case 'low_cost_yield':
      return styles.statFailure;
    case 'low_cache_reuse':
    case 'low_output_yield':
      return styles.statNeutral;
    case 'cost_not_enabled':
    default:
      return styles.statSubtle;
  }
};

const getScoreTone = (score: number) => {
  if (score >= 85) return styles.statSuccess;
  if (score >= 70) return styles.statNeutral;
  return styles.statFailure;
};

export function TokenEfficiencyCenter({
  overview,
  modelRows,
  credentialRows,
  loading,
  onDrilldownChange
}: TokenEfficiencyCenterProps) {
  const { t } = useTranslation();

  const topSignals = useMemo(() => {
    return [...overview.signals]
      .sort((left, right) => SIGNAL_PRIORITY.indexOf(left) - SIGNAL_PRIORITY.indexOf(right))
      .slice(0, 3);
  }, [overview.signals]);

  const rankingHint = (
    <span className={styles.tokenEfficiencyTableHint}>
      <IconExternalLink size={14} />
      {t('usage_stats.drilldown_hint')}
    </span>
  );

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    drilldown: EfficiencyDrilldown
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onDrilldownChange(drilldown);
    }
  };

  const topModelRows = modelRows.slice(0, 5);
  const topCredentialRows = credentialRows.slice(0, 5);

  if (loading || !overview.hasData) {
    return null;
  }

  return (
    <div className={styles.tokenEfficiencySection}>
      <Card
        className={styles.card}
        title={
          <span className={styles.cardHeader}>
            <span className={styles.cardIcon}>
              <IconZap size={16} />
            </span>
            {t('usage_stats.token_efficiency_center')}
          </span>
        }
      >
        <div className={styles.tokenEfficiencyOverview}>
          <div className={styles.tokenEfficiencyHero}>
            <div>
              <div className={styles.tokenEfficiencyScoreLabel}>{t('usage_stats.efficiency_score')}</div>
              <div className={styles.tokenEfficiencyScoreRow}>
                <span className={styles.tokenEfficiencyScoreValue}>{overview.efficiencyScore}</span>
                <span className={`${styles.tokenEfficiencyGrade} ${getScoreTone(overview.efficiencyScore)}`}>
                  {overview.grade}
                </span>
                {!overview.costEnabled && (
                  <span className={styles.costDisabledBadge}>
                    {t('usage_stats.score_cost_disabled')}
                  </span>
                )}
              </div>
              <div className={styles.tokenEfficiencySubtle}>
                {t('usage_stats.request_events_count', { count: overview.requestCount })} ·{' '}
                {t('usage_stats.total_tokens')}: {formatCompactNumber(overview.totalTokens)}
              </div>
              <div className={styles.tokenEfficiencyHint}>{t('usage_stats.drilldown_hint')}</div>
            </div>
            <div className={styles.tokenEfficiencySignals}>
              {topSignals.map((signal) => (
                <span key={signal} className={`${styles.tokenEfficiencySignal} ${getSignalTone(signal)}`}>
                  {t(`usage_stats.signal_${signal}`)}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.tokenEfficiencyMetrics}>
            <div className={styles.tokenEfficiencyMetricCard}>
              <div className={styles.tokenEfficiencyMetricHeader}>
                <span>{t('usage_stats.cache_hit_rate')}</span>
                <IconZap size={16} />
              </div>
              <div className={styles.tokenEfficiencyMetricValue}>{formatPercent(overview.metrics.cacheReuseRate)}</div>
            </div>
            <div className={styles.tokenEfficiencyMetricCard}>
              <div className={styles.tokenEfficiencyMetricHeader}>
                <span>{t('usage_stats.output_efficiency')}</span>
                <IconTrendingUp size={16} />
              </div>
              <div className={styles.tokenEfficiencyMetricValue}>{formatPercent(overview.metrics.outputYield)}</div>
            </div>
            <div className={styles.tokenEfficiencyMetricCard}>
              <div className={styles.tokenEfficiencyMetricHeader}>
                <span>{t('usage_stats.failure_waste_rate')}</span>
                <IconTarget size={16} />
              </div>
              <div className={styles.tokenEfficiencyMetricValue}>{formatPercent(overview.metrics.failureWasteRate)}</div>
            </div>
            <div className={styles.tokenEfficiencyMetricCard}>
              <div className={styles.tokenEfficiencyMetricHeader}>
                <span>{t('usage_stats.cost_efficiency')}</span>
                <IconDollarSign size={16} />
              </div>
              <div className={styles.tokenEfficiencyMetricValue}>
                {overview.metrics.costYield === null
                  ? '--'
                  : `${formatCompactNumber(overview.metrics.costYield)} tokens/$`}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className={styles.detailsGrid}>
        <Card
          className={styles.detailsFixedCard}
          title={t('usage_stats.model_efficiency_ranking')}
          extra={rankingHint}
        >
          {topModelRows.length > 0 ? (
            <div className={styles.detailsScroll}>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('usage_stats.model_name')}</th>
                      <th>{t('usage_stats.requests_count')}</th>
                      <th>{t('usage_stats.failure_waste_rate')}</th>
                      <th>{t('usage_stats.efficiency_score')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topModelRows.map((row) => (
                      <tr
                        key={row.model}
                        className={styles.tokenEfficiencyClickableRow}
                        onClick={() => onDrilldownChange({ type: 'model', value: row.model })}
                        onKeyDown={(event) => handleRowKeyDown(event, { type: 'model', value: row.model })}
                        tabIndex={0}
                        role="button"
                        aria-label={`${row.model} ${t('usage_stats.view_details')}`}
                      >
                        <td className={styles.modelCell}>{row.model}</td>
                        <td>{row.requests.toLocaleString()}</td>
                        <td>{formatPercent(row.failureWasteRate)}</td>
                        <td>
                          <div className={styles.tokenEfficiencyScoreCell}>
                            <span className={getScoreTone(row.efficiencyScore)}>{row.efficiencyScore}</span>
                            <span className={styles.tokenEfficiencyAction}>{t('usage_stats.view_details')}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.no_data')}</div>
          )}
        </Card>

        <Card
          className={styles.detailsFixedCard}
          title={t('usage_stats.credential_efficiency_ranking')}
          extra={rankingHint}
        >
          {topCredentialRows.length > 0 ? (
            <div className={styles.detailsScroll}>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('usage_stats.credential_name')}</th>
                      <th>{t('usage_stats.requests_count')}</th>
                      <th>{t('usage_stats.failure_waste_rate')}</th>
                      <th>{t('usage_stats.efficiency_score')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCredentialRows.map((row) => (
                      <tr
                        key={row.key}
                        className={styles.tokenEfficiencyClickableRow}
                        onClick={() =>
                          onDrilldownChange({
                            type: 'credential',
                            value: JSON.stringify({
                              source: row.filterSourceRaw,
                              authIndex: row.filterAuthIndex,
                              fallbackSource: row.filterSource
                            })
                          })
                        }
                        onKeyDown={(event) =>
                          handleRowKeyDown(event, {
                            type: 'credential',
                            value: JSON.stringify({
                              source: row.filterSourceRaw,
                              authIndex: row.filterAuthIndex,
                              fallbackSource: row.filterSource
                            })
                          })
                        }
                        tabIndex={0}
                        role="button"
                        aria-label={`${row.displayName} ${t('usage_stats.view_details')}`}
                      >
                        <td className={styles.modelCell}>
                          <span>{row.displayName}</span>
                          {row.type && <span className={styles.credentialType}>{row.type}</span>}
                        </td>
                        <td>{row.requests.toLocaleString()}</td>
                        <td>{formatPercent(row.failureWasteRate)}</td>
                        <td>
                          <div className={styles.tokenEfficiencyScoreCell}>
                            <span className={getScoreTone(row.efficiencyScore)}>{row.efficiencyScore}</span>
                            <span className={styles.tokenEfficiencyAction}>{t('usage_stats.view_details')}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.no_data')}</div>
          )}
        </Card>
      </div>
    </div>
  );
}
