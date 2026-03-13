import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { formatCompactNumber } from '@/utils/usage';
import type { CredentialRow } from './hooks/usageAnalyticsSnapshot';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  rows: CredentialRow[];
  loading: boolean;
}

export function CredentialStatsCard({ rows, loading }: CredentialStatsCardProps) {
  const { t } = useTranslation();

  return (
    <Card title={t('usage_stats.credential_stats')} className={styles.detailsFixedCard}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length > 0 ? (
        <div className={styles.detailsScroll}>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage_stats.credential_name')}</th>
                  <th>{t('usage_stats.requests_count')}</th>
                  <th>{t('usage_stats.success_rate')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className={styles.modelCell}>
                      <span>{row.displayName}</span>
                      {row.type && <span className={styles.credentialType}>{row.type}</span>}
                    </td>
                    <td>
                      <span className={styles.requestCountCell}>
                        <span>{formatCompactNumber(row.total)}</span>
                        <span className={styles.requestBreakdown}>
                          (<span className={styles.statSuccess}>{row.success.toLocaleString()}</span>{' '}
                          <span className={styles.statFailure}>{row.failure.toLocaleString()}</span>)
                        </span>
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          row.successRate >= 95
                            ? styles.statSuccess
                            : row.successRate >= 80
                              ? styles.statNeutral
                              : styles.statFailure
                        }
                      >
                        {row.successRate.toFixed(1)}%
                      </span>
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
  );
}
