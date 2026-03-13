import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Doughnut } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { TokenNumber } from '@/components/ui/SmartNumber';
import type { TokenDistribution } from './hooks/usageAnalyticsSnapshot';
import styles from './TokenDistributionChart.module.scss';

export interface TokenDistributionChartProps {
  distribution: TokenDistribution;
  loading: boolean;
  isDark: boolean;
}

interface TooltipContext {
  label: string;
  raw: unknown;
  parsed: unknown;
}

const TOKEN_COLORS = {
  input: { border: '#8b8680', bg: 'rgba(139, 134, 128, 0.8)' },
  output: { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.8)' },
  cached: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.8)' },
  reasoning: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.8)' }
};

export function TokenDistributionChart({
  distribution,
  loading,
  isDark
}: TokenDistributionChartProps) {
  const { t } = useTranslation();

  const total = distribution.input + distribution.output + distribution.cached + distribution.reasoning;

  const chartData = useMemo(() => {
    const data = [
      distribution.input,
      distribution.output,
      distribution.cached,
      distribution.reasoning
    ];

    return {
      labels: [
        t('usage_stats.input_tokens'),
        t('usage_stats.output_tokens'),
        t('usage_stats.cached_tokens'),
        t('usage_stats.reasoning_tokens')
      ],
      datasets: [
        {
          data,
          backgroundColor: [
            TOKEN_COLORS.input.bg,
            TOKEN_COLORS.output.bg,
            TOKEN_COLORS.cached.bg,
            TOKEN_COLORS.reasoning.bg
          ],
          borderColor: [
            TOKEN_COLORS.input.border,
            TOKEN_COLORS.output.border,
            TOKEN_COLORS.cached.border,
            TOKEN_COLORS.reasoning.border
          ],
          borderWidth: 2,
          hoverOffset: 4
        }
      ]
    };
  }, [distribution, t]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '60%',
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        titleColor: isDark ? '#e5e5e5' : '#1f2937',
        bodyColor: isDark ? '#d4d4d4' : '#4b5563',
        borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: (context: TooltipContext) => {
            const value = Number(context.raw);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
            return `${context.label}: ${value.toLocaleString()} (${percentage}%)`;
          }
        }
      }
    }
  }), [isDark, total]);

  const hasData = total > 0;

  return (
    <Card title={t('usage_stats.token_distribution')}>
      {loading ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : hasData ? (
        <div className={styles.container}>
          <div className={styles.chartWrapper}>
            <div className={styles.chart}>
              <Doughnut data={chartData} options={chartOptions} />
              <div className={styles.centerText}>
                <span className={styles.centerLabel}>{t('usage_stats.total')}</span>
                <span className={styles.centerValue}><TokenNumber value={total} /></span>
              </div>
            </div>
          </div>
          <div className={styles.legend}>
            {[
              { key: 'input', label: t('usage_stats.input_tokens'), value: distribution.input },
              { key: 'output', label: t('usage_stats.output_tokens'), value: distribution.output },
              { key: 'cached', label: t('usage_stats.cached_tokens'), value: distribution.cached },
              { key: 'reasoning', label: t('usage_stats.reasoning_tokens'), value: distribution.reasoning }
            ].map((item) => {
              const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
              const colorKey = item.key as keyof typeof TOKEN_COLORS;
              return (
                <div key={item.key} className={styles.legendItem}>
                  <div className={styles.legendHeader}>
                    <span
                      className={styles.legendDot}
                      style={{ backgroundColor: TOKEN_COLORS[colorKey].border }}
                    />
                    <span className={styles.legendLabel}>{item.label}</span>
                  </div>
                  <div className={styles.legendValue}>
                    <TokenNumber value={item.value} />
                    <span className={styles.legendPercent}>{percentage}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles.noData}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
