import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMetricTrend } from './useMetricTrend';

describe('useMetricTrend', () => {
  it('aggregates recent and previous buckets with a single detail pass while preserving trend semantics', () => {
    const nowMs = Date.parse('2026-02-08T12:00:00.000Z');
    const details = [
      {
        timestamp: new Date(nowMs - 1 * 60 * 60 * 1000).toISOString(),
        __timestampMs: nowMs - 1 * 60 * 60 * 1000,
        __modelName: 'gpt-4.1',
        failed: false,
        source: 'tenant-a',
        auth_index: '1',
        tokens: {
          input_tokens: 20,
          output_tokens: 10,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 30,
        },
      },
      {
        timestamp: new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString(),
        __timestampMs: nowMs - 2 * 24 * 60 * 60 * 1000,
        __modelName: 'gpt-4.1',
        failed: false,
        source: 'tenant-a',
        auth_index: '1',
        tokens: {
          input_tokens: 30,
          output_tokens: 20,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 50,
        },
      },
      {
        timestamp: new Date(nowMs - 8 * 24 * 60 * 60 * 1000).toISOString(),
        __timestampMs: nowMs - 8 * 24 * 60 * 60 * 1000,
        __modelName: 'gpt-4.1',
        failed: false,
        source: 'tenant-a',
        auth_index: '1',
        tokens: {
          input_tokens: 10,
          output_tokens: 10,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 20,
        },
      },
      {
        timestamp: new Date(nowMs - 35 * 24 * 60 * 60 * 1000).toISOString(),
        __timestampMs: nowMs - 35 * 24 * 60 * 60 * 1000,
        __modelName: 'gpt-4.1',
        failed: false,
        source: 'tenant-a',
        auth_index: '1',
        tokens: {
          input_tokens: 10,
          output_tokens: 5,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 15,
        },
      },
    ];

    const { result } = renderHook(() =>
      useMetricTrend(details, nowMs, 'rpm', {
        'gpt-4.1': { prompt: 1, completion: 2, cache: 0.5 },
      })
    );

    expect(result.current.currentValue).toBeCloseTo(2 / 168, 8);
    expect(result.current.previousValue).toBeCloseTo(1 / 168, 8);
    expect(result.current.delta7d).toBeCloseTo(100, 5);
    expect(result.current.delta30d).toBeGreaterThan(0);
  });
});
