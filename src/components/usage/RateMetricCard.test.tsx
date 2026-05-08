import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RateMetricCard } from './RateMetricCard';
import type { PeriodSparklineBundle } from './hooks/useSparklines';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-chartjs-2', () => ({
  Line: ({ data }: { data: { labels: string[]; datasets: Array<{ data: number[] }> } }) => (
    <div data-testid="line-chart">
      {data.labels.join(',')}|{data.datasets[0]?.data.join(',')}
    </div>
  ),
}));

const createDaySparklines = (): PeriodSparklineBundle => ({
  '7d': {
    period: '7d',
    data: {
      labels: ['7d-label'],
      datasets: [
        {
          data: [7],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.18)',
          fill: true,
          tension: 0.45,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
  },
  '30d': {
    period: '30d',
    data: {
      labels: ['30d-label'],
      datasets: [
        {
          data: [30],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.18)',
          fill: true,
          tension: 0.45,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
  },
});

describe('RateMetricCard', () => {
  it('switches chart data together with the trend period toggle', () => {
    render(
      <RateMetricCard
        metricType="rpm"
        currentValue={1}
        peakValue={2}
        trend={{
          delta7d: 12.5,
          delta30d: -8.4,
          currentPeriod: '7d',
          currentValue: 1,
          previousValue: 0.8,
        }}
        sparklineData={null}
        daySparklineData={createDaySparklines()}
      />
    );

    expect(screen.getByTestId('line-chart').textContent).toContain('7d-label');

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByTestId('line-chart').textContent).toContain('30d-label');
  });
});
