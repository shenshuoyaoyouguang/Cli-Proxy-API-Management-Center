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

describe('calculateHealthScore responsiveness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('averages model success rates without weighting', () => {
    const details = [
      createDetail({ minutesAgo: 10, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 10, modelName: 'model-a', failed: false }),
      createDetail({ minutesAgo: 10, modelName: 'model-a', failed: true }),
      createDetail({ minutesAgo: 10, modelName: 'model-b', failed: false })
    ];

    const health = calculateHealthScore(3, 1, details);

    // model-a success rate = 2/3, model-b success rate = 1
    const expected = (2 / 3 + 1) / 2;
    expect(health.metrics.responsiveness.value).toBeCloseTo(expected, 5);
  });

  it('returns perfect responsiveness when no model data in window', () => {
    const details = [
      createDetail({ minutesAgo: 99999, modelName: 'model-a', failed: true })
    ];

    const health = calculateHealthScore(1, 0, details);
    expect(health.metrics.responsiveness.value).toBe(1);
  });

  it('averages across models with empty names as unknown', () => {
    const details = [
      createDetail({ minutesAgo: 5, modelName: '', failed: false }),
      createDetail({ minutesAgo: 5, modelName: 'model-b', failed: true })
    ];

    const health = calculateHealthScore(1, 1, details);

    // unknown model success rate = 1, model-b success rate = 0
    expect(health.metrics.responsiveness.value).toBeCloseTo(0.5, 5);
  });
});
