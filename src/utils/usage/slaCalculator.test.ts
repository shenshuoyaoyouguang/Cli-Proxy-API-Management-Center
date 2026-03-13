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
  auth_index: number;
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
    auth_index: 0,
    __modelName: params.modelName,
    __timestampMs: timestampMs
  };
};

describe('calculateSLAMetrics availability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts models at 50% success rate as downtime', () => {

    const details = [
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: true }),
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: true }),
      createDetail({ minutesAgo: 1, modelName: 'model-b', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-b', failed: true })
    ];

    const metrics = calculateSLAMetrics('basic', 4, 2, details);

    // model-a: 2 success / 2 failure => success rate 50% => down
    // model-b: 1 success / 1 failure => success rate 50% => down
    // total weight = 6, down weight = 6
    expect(metrics.commitments.availability.current).toBeCloseTo(0, 5);
  });

  it('weights downtime by model request volume', () => {
    const details = [
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-b', failed: false }),
      createDetail({ minutesAgo: 1, modelName: 'model-b', failed: true })
    ];

    const metrics = calculateSLAMetrics('basic', 5, 1, details);

    // model-a: 4 success / 0 failure => success rate 100% => up
    // model-b: 1 success / 1 failure => success rate 50% => down
    // total weight = 6, down weight = 2
    expect(metrics.commitments.availability.current).toBeCloseTo(1 - 2 / 6, 5);
  });

  it('returns full availability when no requests in window', () => {
    const details = [
      createDetail({ minutesAgo: 99999, modelName: 'model-a', failed: true })
    ];

    const metrics = calculateSLAMetrics('basic', 1, 1, details);
    expect(metrics.commitments.availability.current).toBe(1);
  });
});
