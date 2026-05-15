import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUsageAnalyticsSnapshot } from './useUsageAnalyticsSnapshot';

describe('useUsageAnalyticsSnapshot', () => {
  it('derives aggregate consumers from filteredDetails instead of the raw usage tree', () => {
    const nowMs = Date.parse('2026-01-08T12:00:00.000Z');
    const detailTimestamp = new Date(nowMs - 60_000).toISOString();

    const usage = {
      total_requests: 99,
      success_count: 88,
      failure_count: 11,
      total_tokens: 9999,
      apis: {
        'POST /v1/chat/completions': {
          total_requests: 99,
          success_count: 88,
          failure_count: 11,
          total_tokens: 9999,
          models: {
            'gpt-stale': {
              total_requests: 99,
              success_count: 88,
              failure_count: 11,
              total_tokens: 9999,
              details: [],
            },
          },
        },
      },
    };

    const usageDetails = [
      {
        timestamp: detailTimestamp,
        source: 'tenant-a',
        auth_index: '1',
        failed: false,
        __modelName: 'gpt-live',
        __timestampMs: nowMs - 60_000,
        __endpoint: 'POST /v1/chat/completions',
        tokens: {
          input_tokens: 100,
          output_tokens: 50,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 150,
        },
      },
    ];

    const { result } = renderHook(() =>
      useUsageAnalyticsSnapshot({
        usage,
        usageDetails,
        timeRange: 'all',
        modelPrices: {},
        nowMs,
        authFileMap: new Map(),
        locale: 'zh-CN',
        geminiKeys: [],
        claudeConfigs: [],
        codexConfigs: [],
        vertexConfigs: [],
        openaiProviders: [],
        aliasReverseMap: new Map(),
      })
    );

    expect(result.current.filteredUsage).toEqual(
      expect.objectContaining({
        total_requests: 1,
        success_count: 1,
        failure_count: 0,
        total_tokens: 150,
      })
    );
    expect(result.current.apiStats).toEqual([
      expect.objectContaining({
        endpoint: 'POST /v1/chat/completions',
        totalRequests: 1,
        totalTokens: 150,
      }),
    ]);
    expect(result.current.modelStats).toEqual([
      expect.objectContaining({
        model: 'gpt-live',
        requests: 1,
        tokens: 150,
      }),
    ]);
    expect(result.current.runtimeQualitySummary.totalRequests).toBe(1);
  });
});
