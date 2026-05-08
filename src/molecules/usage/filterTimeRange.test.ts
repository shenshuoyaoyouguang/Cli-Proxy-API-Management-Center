import { describe, expect, it } from 'vitest';
import { filterUsageByTimeRange } from './filterTimeRange';

describe('filterUsageByTimeRange', () => {
  it('keeps high-precision RFC3339 timestamps in range using the shared parser', () => {
    const nowMs = Date.parse('2026-01-08T12:00:00.000Z');
    const usage = filterUsageByTimeRange(
      {
        apis: {
          'POST /v1/chat/completions': {
            models: {
              minimax: {
                details: [
                  {
                    timestamp: '2026-01-08T11:59:59.123456Z',
                    usage: {
                      prompt_tokens: 120,
                      completion_tokens: 30,
                      total_tokens: 150,
                    },
                    failed: false,
                  },
                ],
              },
            },
          },
        },
      },
      '1d',
      nowMs
    ) as unknown as {
      total_tokens: number;
      total_requests: number;
      apis: Record<string, { models: Record<string, { details: unknown[] }> }>;
    };

    expect(usage.total_requests).toBe(1);
    expect(usage.total_tokens).toBe(150);
    expect(
      usage.apis['POST /v1/chat/completions'].models.minimax.details
    ).toHaveLength(1);
  });

  it('preserves aggregate-only snapshots when no details are available', () => {
    const usage = filterUsageByTimeRange(
      {
        total_requests: 12,
        total_tokens: 456,
        apis: {
          'POST /v1/chat/completions': {
            total_requests: 12,
            total_tokens: 456,
            models: {
              minimax: {
                total_requests: 12,
                total_tokens: 456,
                details: [],
              },
            },
          },
        },
      },
      '7d',
      Date.parse('2026-01-08T12:00:00.000Z')
    ) as unknown as {
      total_requests: number;
      total_tokens: number;
      apis: Record<string, { models: Record<string, { details: unknown[] }> }>;
    };

    expect(usage.total_requests).toBe(12);
    expect(usage.total_tokens).toBe(456);
    expect(
      usage.apis['POST /v1/chat/completions'].models.minimax.details
    ).toHaveLength(0);
  });

  it('keeps slightly future-dated records when server and client clocks drift a little', () => {
    const nowMs = Date.parse('2026-01-08T12:00:00.000Z');
    const usage = filterUsageByTimeRange(
      {
        apis: {
          'POST /v1/chat/completions': {
            models: {
              minimax: {
                details: [
                  {
                    timestamp: '2026-01-08T12:03:00.000Z',
                    usage: {
                      prompt_tokens: 12,
                      completion_tokens: 8,
                      total_tokens: 20,
                    },
                    failed: false,
                  },
                ],
              },
            },
          },
        },
      },
      '1d',
      nowMs
    ) as unknown as {
      total_requests: number;
      total_tokens: number;
    };

    expect(usage.total_requests).toBe(1);
    expect(usage.total_tokens).toBe(20);
  });
});
