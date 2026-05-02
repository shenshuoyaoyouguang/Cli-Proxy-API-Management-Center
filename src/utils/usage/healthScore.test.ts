import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateHealthScore } from './healthScore';

const baseNow = Date.parse('2025-01-01T00:00:00.000Z');

const createDetail = (params: {
  minutesAgo: number;
  modelName: string;
  failed: boolean;
}): {
  timestamp: string;
  failed: boolean;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cached_tokens: number;
    total_tokens: number;
  };
  source: string;
  auth_index: string | null;
  __modelName: string;
  __timestampMs: number;
} => {
  const timestampMs = baseNow - params.minutesAgo * 60 * 1000;
  return {
    timestamp: new Date(timestampMs).toISOString(),
    failed: params.failed,
    tokens: {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      total_tokens: 0
    },
    source: 'test',
    auth_index: '0',
    __modelName: params.modelName,
    __timestampMs: timestampMs
  };
};

describe('calculateHealthScore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks low-sample stability as unknown while still computing recent health', () => {
    const details = [
      createDetail({ minutesAgo: 10, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 9, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 8, modelName: 'model-a', failed: true }),
      createDetail({ minutesAgo: 7, modelName: 'model-b', failed: false })
    ];

    const health = calculateHealthScore(3, 1, details, baseNow);

    expect(health.hasData).toBe(true);
    expect(health.metrics.successRate.value).toBeCloseTo(0.75, 5);
    expect(health.metrics.availability.value).not.toBeNull();
    expect(health.metrics.stability.value).toBeNull();
    expect(health.metrics.stability.dataQuality).toBe('low_sample');
    expect(health.dataQuality).toBe('low_sample');
  });

  it('returns excellent health for stable high availability traffic', () => {
    const details = Array.from({ length: 24 }, (_, index) =>
      createDetail({ minutesAgo: index * 60, modelName: 'model-a', failed: false })
    );

    const health = calculateHealthScore(24, 0, details, baseNow);

    expect(health.hasData).toBe(true);
    expect(health.grade).toBe('excellent');
    expect(health.metrics.successRate.score).toBe(100);
    expect(health.metrics.availability.score).toBe(100);
    expect(health.metrics.stability.score).toBe(100);
  });

  it('detects downward trend when the recent 7d segment degrades', () => {
    const recentSegment = Array.from({ length: 24 }, (_, index) =>
      createDetail({
        minutesAgo: index,
        modelName: 'model-a',
        failed: index % 2 === 0
      })
    );
    const previousSegment = Array.from({ length: 24 }, (_, index) =>
      createDetail({
        minutesAgo: 8 * 24 * 60 + index,
        modelName: 'model-a',
        failed: false
      })
    );

    const health = calculateHealthScore(36, 12, [...recentSegment, ...previousSegment], baseNow);

    expect(health.hasData).toBe(true);
    expect(health.trend).toBe('down');
    expect(health.dataQuality).toBe('ok');
  });

  it('returns unknown/empty states when no recent data exists', () => {
    const details = [createDetail({ minutesAgo: 99999, modelName: 'model-a', failed: true })];

    const health = calculateHealthScore(1, 0, details, baseNow);

    expect(health.hasData).toBe(false);
    expect(health.dataQuality).toBe('no_data');
    expect(health.metrics.successRate.value).toBeNull();
    expect(health.metrics.availability.value).toBeNull();
    expect(health.grade).toBe('unknown');
  });
});
