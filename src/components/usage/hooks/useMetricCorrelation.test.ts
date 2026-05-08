import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMetricCorrelation } from './useMetricCorrelation';

describe('useMetricCorrelation', () => {
  it('computes correlation from non-zero daily pairs only', () => {
    const nowMs = Date.parse('2026-02-08T12:00:00.000Z');
    const makeDetail = (daysAgo: number, inputTokens: number, outputTokens: number) => {
      const timestamp = nowMs - daysAgo * 24 * 60 * 60 * 1000;
      return {
        timestamp: new Date(timestamp).toISOString(),
        __timestampMs: timestamp,
        __modelName: 'gpt-4.1',
        failed: false,
        source: 'tenant-a',
        auth_index: '1',
        tokens: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: inputTokens + outputTokens,
        },
      };
    };

    const details = [
      makeDetail(0, 100, 50),
      makeDetail(1, 200, 100),
      makeDetail(2, 300, 150),
      makeDetail(10, 0, 0),
    ];

    const { result } = renderHook(() =>
      useMetricCorrelation(details, nowMs, {
        'gpt-4.1': { prompt: 1, completion: 2, cache: 0.5 },
      })
    );

    expect(result.current.sampleCount).toBe(3);
    expect(result.current.correlation).not.toBeNull();
    expect(result.current.correlation).toBeGreaterThan(0.99);
    expect(result.current.interpretationKey).toBe('very_strong');
  });
});
