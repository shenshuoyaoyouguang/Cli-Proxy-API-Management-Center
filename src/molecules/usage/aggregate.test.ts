import { describe, expect, it } from 'vitest';
import {
  createAggregateOnlyUsageSnapshot,
  getApiStats,
  getModelStats,
  rehydrateUsageAggregatesFromDetails,
  mergeKeyStatsIncremental,
  subtractKeyStatsForDetails,
  computeKeyStatsFromDetails,
} from './aggregate';
import type { UsageDetail, KeyStats } from '@/atoms/usage/types';

describe('mergeKeyStatsIncremental', () => {
  const createDetail = (source: string, authIndex: string | null, failed: boolean): UsageDetail => ({
    timestamp: '2026-01-01T00:00:00.000Z',
    source,
    auth_index: authIndex,
    tokens: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0 },
    failed,
    __modelName: 'test',
  });

  it('should incrementally add new stats to existing stats', () => {
    const current: KeyStats = {
      bySource: { 'source-a': { success: 10, failure: 2 } },
      byAuthIndex: { 'auth-0': { success: 8, failure: 4 } },
    };
    const newDetails = [
      createDetail('source-a', 'auth-0', false),
      createDetail('source-a', 'auth-0', true),
    ];

    const result = mergeKeyStatsIncremental(current, newDetails);

    expect(result.bySource['source-a'].success).toBe(11);
    expect(result.bySource['source-a'].failure).toBe(3);
    expect(result.byAuthIndex['auth-0'].success).toBe(9);
    expect(result.byAuthIndex['auth-0'].failure).toBe(5);
  });

  it('should create new buckets for unseen sources', () => {
    const current: KeyStats = {
      bySource: { 'source-a': { success: 10, failure: 2 } },
      byAuthIndex: { 'auth-0': { success: 8, failure: 4 } },
    };
    const newDetails = [
      createDetail('source-b', 'auth-1', false),
    ];

    const result = mergeKeyStatsIncremental(current, newDetails);

    expect(result.bySource['source-b']).toEqual({ success: 1, failure: 0 });
    expect(result.byAuthIndex['auth-1']).toEqual({ success: 1, failure: 0 });
  });

  it('should not mutate the original stats object', () => {
    const current: KeyStats = {
      bySource: { 'source-a': { success: 10, failure: 2 } },
      byAuthIndex: { 'auth-0': { success: 8, failure: 4 } },
    };
    const newDetails = [createDetail('source-a', 'auth-0', false)];

    mergeKeyStatsIncremental(current, newDetails);

    expect(current.bySource['source-a'].success).toBe(10);
    expect(current.byAuthIndex['auth-0'].success).toBe(8);
  });
});

describe('subtractKeyStatsForDetails', () => {
  const createDetail = (source: string, authIndex: string | null, failed: boolean): UsageDetail => ({
    timestamp: '2026-01-01T00:00:00.000Z',
    source,
    auth_index: authIndex,
    tokens: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0 },
    failed,
    __modelName: 'test',
  });

  it('should subtract stats for removed details', () => {
    const current: KeyStats = {
      bySource: { 'source-a': { success: 10, failure: 2 } },
      byAuthIndex: { 'auth-0': { success: 8, failure: 4 } },
    };
    const removedDetails = [
      createDetail('source-a', 'auth-0', false),
      createDetail('source-a', 'auth-0', true),
    ];

    const result = subtractKeyStatsForDetails(current, removedDetails);

    expect(result.bySource['source-a'].success).toBe(9);
    expect(result.bySource['source-a'].failure).toBe(1);
    expect(result.byAuthIndex['auth-0'].success).toBe(7);
    expect(result.byAuthIndex['auth-0'].failure).toBe(3);
  });

  it('should remove buckets when count reaches zero', () => {
    const current: KeyStats = {
      bySource: { 'source-a': { success: 1, failure: 0 } },
      byAuthIndex: { 'auth-0': { success: 1, failure: 0 } },
    };
    const removedDetails = [
      createDetail('source-a', 'auth-0', false),
    ];

    const result = subtractKeyStatsForDetails(current, removedDetails);

    expect(result.bySource['source-a']).toBeUndefined();
    expect(result.byAuthIndex['auth-0']).toBeUndefined();
  });

  it('should not go below zero', () => {
    const current: KeyStats = {
      bySource: { 'source-a': { success: 0, failure: 0 } },
      byAuthIndex: { 'auth-0': { success: 0, failure: 0 } },
    };
    const removedDetails = [
      createDetail('source-a', 'auth-0', false),
      createDetail('source-a', 'auth-0', true),
    ];

    const result = subtractKeyStatsForDetails(current, removedDetails);

    expect(result.bySource['source-a']).toBeUndefined();
    expect(result.byAuthIndex['auth-0']).toBeUndefined();
  });

  it('should produce same result as full computation after trim', () => {
    const createDetail = (source: string, authIndex: string | null, failed: boolean): UsageDetail => ({
      timestamp: '2026-01-01T00:00:00.000Z',
      source,
      auth_index: authIndex,
      tokens: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 0 },
      failed,
      __modelName: 'test',
    });

    const existingDetails = Array.from({ length: 5 }, (_, i) =>
      createDetail(`source-${i % 3}`, `auth-${i % 2}`, i % 2 === 0)
    );
    const currentKeyStats = computeKeyStatsFromDetails(existingDetails);

    const newDetails = [
      createDetail('source-0', 'auth-0', false),
      createDetail('source-3', 'auth-1', true),
    ];

    const mergedStats = mergeKeyStatsIncremental(currentKeyStats, newDetails);
    const allDetails = [...existingDetails, ...newDetails];

    const MAX_LENGTH = 6;
    const needsTrim = allDetails.length > MAX_LENGTH;
    const trimmedDetails = needsTrim
      ? allDetails.slice(allDetails.length - MAX_LENGTH)
      : allDetails;
    const removedDetails = needsTrim
      ? allDetails.slice(0, allDetails.length - MAX_LENGTH)
      : [];

    let incrementalResult = mergedStats;
    if (needsTrim) {
      incrementalResult = subtractKeyStatsForDetails(mergedStats, removedDetails);
    }

    const fullResult = computeKeyStatsFromDetails(trimmedDetails);

    expect(incrementalResult).toEqual(fullResult);
  });
});

describe('usage aggregate token fallback', () => {
  it('derives model and api token totals from details when explicit total_tokens is zero', () => {
    const usage = {
      apis: {
        'POST /v1/chat/completions': {
          total_requests: 1,
          total_tokens: 0,
          models: {
            minimax: {
              total_requests: 1,
              total_tokens: 0,
              details: [
                {
                  timestamp: '2026-01-01T00:00:00.000Z',
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
    };

    const modelStats = getModelStats(usage, {});
    const apiStats = getApiStats(usage, {});

    expect(modelStats).toHaveLength(1);
    expect(modelStats[0]).toMatchObject({
      model: 'minimax',
      tokens: 150,
      successCount: 1,
      failureCount: 0,
    });

    expect(apiStats).toHaveLength(1);
    expect(apiStats[0]).toMatchObject({
      totalTokens: 150,
      successCount: 1,
      failureCount: 0,
    });
    expect(apiStats[0].models.minimax.tokens).toBe(150);
  });

  it('uses normalized detail tokens for cost calculation when usage is nested under the detail payload', () => {
    const usage = {
      apis: {
        'POST /v1/chat/completions': {
          total_requests: 1,
          total_tokens: 0,
          models: {
            'custom-model': {
              total_requests: 1,
              total_tokens: 0,
              details: [
                {
                  timestamp: '2026-01-01T00:00:00.000Z',
                  usage: {
                    prompt_tokens: 1_000_000,
                    completion_tokens: 500_000,
                    total_tokens: 1_500_000,
                  },
                  failed: false,
                },
              ],
            },
          },
        },
      },
    };

    const modelStats = getModelStats(usage, {
      'custom-model': { prompt: 1, completion: 2, cache: 0.5 },
    });

    expect(modelStats[0].tokens).toBe(1_500_000);
    expect(modelStats[0].cost).toBeGreaterThan(0);
  });

  it('rehydrates top-level and per-api usage aggregates from details for downstream consumers', () => {
    const usage = rehydrateUsageAggregatesFromDetails({
      total_requests: 0,
      success_count: 0,
      failure_count: 0,
      total_tokens: 0,
      apis: {
        'POST /v1/chat/completions': {
          total_requests: 0,
          success_count: 0,
          failure_count: 0,
          total_tokens: 0,
          models: {
            minimax: {
              total_requests: 0,
              success_count: 0,
              failure_count: 0,
              total_tokens: 0,
              details: [
                {
                  timestamp: '2026-01-01T00:00:00.000Z',
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
    });

    expect(usage.total_requests).toBe(1);
    expect(usage.success_count).toBe(1);
    expect(usage.failure_count).toBe(0);
    expect(usage.total_tokens).toBe(150);
    expect(
      (usage.apis as Record<string, { total_tokens: number }>)['POST /v1/chat/completions']
        .total_tokens
    ).toBe(150);
  });

  it('prefers detail-derived token totals over stale positive aggregate totals when details are present', () => {
    const usage = rehydrateUsageAggregatesFromDetails({
      total_requests: 9,
      success_count: 9,
      failure_count: 0,
      total_tokens: 300,
      apis: {
        'POST /v1/chat/completions': {
          total_requests: 9,
          success_count: 9,
          failure_count: 0,
          total_tokens: 300,
          models: {
            minimax: {
              total_requests: 9,
              success_count: 9,
              failure_count: 0,
              total_tokens: 300,
              details: [
                {
                  timestamp: '2026-01-01T00:00:00.000Z',
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
    });

    expect(usage.total_tokens).toBe(150);
    expect(
      (
        ((usage.apis as Record<string, unknown>)['POST /v1/chat/completions'] as {
          models: Record<string, { total_tokens: number }>;
        }).models.minimax.total_tokens
      )
    ).toBe(150);
  });

  it('treats explicit zero-token detail evidence as truth instead of falling back to stale positive aggregates', () => {
    const usage = rehydrateUsageAggregatesFromDetails({
      total_tokens: 300,
      apis: {
        'POST /v1/chat/completions': {
          total_tokens: 300,
          models: {
            minimax: {
              total_tokens: 300,
              details: [
                {
                  timestamp: '2026-01-01T00:00:00.000Z',
                  usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                  },
                  failed: false,
                },
              ],
            },
          },
        },
      },
    });

    expect(usage.total_tokens).toBe(0);
    expect(
      (
        ((usage.apis as Record<string, unknown>)['POST /v1/chat/completions'] as {
          models: Record<string, { total_tokens: number }>;
        }).models.minimax.total_tokens
      )
    ).toBe(0);
  });

  it('creates a compact aggregate-only snapshot that preserves counts but removes details arrays', () => {
    const usage = createAggregateOnlyUsageSnapshot({
      apis: {
        'POST /v1/chat/completions': {
          total_requests: 1,
          total_tokens: 0,
          models: {
            minimax: {
              total_requests: 1,
              total_tokens: 0,
              details: [
                {
                  timestamp: '2026-01-01T00:00:00.000Z',
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
    });

    const api = (usage.apis as Record<string, unknown>)['POST /v1/chat/completions'] as {
      total_tokens: number;
      models: Record<string, { details: unknown[]; total_tokens: number }>;
    };

    expect(api.total_tokens).toBe(150);
    expect(api.models.minimax.total_tokens).toBe(150);
    expect(api.models.minimax.details).toEqual([]);
  });
});
