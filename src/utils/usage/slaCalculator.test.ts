import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateSLAMetrics } from './slaCalculator';

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

describe('calculateSLAMetrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds SLA metrics from reliability snapshot', () => {
    const details = [
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: true }),
      createDetail({ minutesAgo: 1, modelName: 'model-b', failed: false })
    ];

    const metrics = calculateSLAMetrics('basic', 2, 1, details, undefined, baseNow);

    expect(metrics.hasData).toBe(true);
    expect(metrics.commitments.availability.current).not.toBeNull();
    expect(metrics.commitments.successRate.current).toBeCloseTo(2 / 3, 5);
    expect(metrics.overallStatus).toBe('breached');
    expect(metrics.missingTelemetry).toEqual(['latency', 'recovery_time']);
  });

  it('marks free tier as unsupported instead of faking SLA success', () => {
    const details = [createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false })];

    const metrics = calculateSLAMetrics('free', 1, 0, details, undefined, baseNow);

    expect(metrics.hasData).toBe(true);
    expect(metrics.overallStatus).toBe('unsupported');
    expect(metrics.commitments.availability.status).toBe('unsupported');
    expect(metrics.compensation.eligible).toBe(false);
  });

  it('computes compensation when availability drops below contract thresholds', () => {
    const details = [
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: true }),
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: true }),
      createDetail({ minutesAgo: 2, modelName: 'model-a', failed: true }),
      createDetail({ minutesAgo: 2, modelName: 'model-a', failed: true })
    ];

    const metrics = calculateSLAMetrics('pro', 0, 4, details, 100, baseNow);

    expect(metrics.commitments.availability.current).toBe(0);
    expect(metrics.compensation.eligible).toBe(true);
    expect(metrics.compensation.percentage).toBe(50);
    expect(metrics.compensation.amount).toBe(50);
  });

  it('returns no data when all requests are outside the active window', () => {
    const details = [createDetail({ minutesAgo: 99999, modelName: 'model-a', failed: true })];

    const metrics = calculateSLAMetrics('basic', 1, 1, details, undefined, baseNow);

    expect(metrics.hasData).toBe(false);
    expect(metrics.dataQuality).toBe('no_data');
    expect(metrics.commitments.availability.current).toBeNull();
  });
});
