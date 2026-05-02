import { describe, expect, it } from 'vitest';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
import type { UsageDetail } from '@/utils/usage';
import {
  createAuthFileMap,
  createCredentialEfficiencyRows,
  createCredentialRows,
  createEfficiencyOverview,
  createModelEfficiencyRows,
  createRequestEventRows,
  createRequestEventRowsForRange,
  createRuntimeQualitySummary,
  createTokenDistribution,
  createUsageSummaryMetrics,
  filterUsageDetailsByTimeRange
} from './usageAnalyticsSnapshot';

const baseNow = Date.parse('2026-01-08T12:00:00.000Z');

const createDetail = (
  overrides: Partial<UsageDetail> & { minutesAgo: number; source?: string; auth_index?: string }
): UsageDetail => {
  const timestampMs = baseNow - overrides.minutesAgo * 60 * 1000;
  return {
    timestamp: new Date(timestampMs).toISOString(),
    source: overrides.source ?? 't:tenant-a',
    auth_index: overrides.auth_index ?? '1',
    failed: overrides.failed ?? false,
    tokens: {
      input_tokens: 10,
      output_tokens: 5,
      reasoning_tokens: 2,
      cached_tokens: 3,
      total_tokens: 20,
      ...(overrides.tokens || {})
    },
    __modelName: overrides.__modelName ?? 'model-a',
    __timestampMs: timestampMs
  };
};

describe('usageAnalyticsSnapshot helpers', () => {
  it('filters details by configured time range', () => {
    const details = [
      createDetail({ minutesAgo: 30 }),
      createDetail({ minutesAgo: 90 }),
      createDetail({ minutesAgo: 8 * 60 }),
      createDetail({ minutesAgo: 25 * 60 })
    ];

    const filtered = filterUsageDetailsByTimeRange(details, '1d', baseNow);
    expect(filtered).toHaveLength(3);
    expect(filtered[0].__timestampMs).toBeGreaterThan(filtered[1].__timestampMs!);
  });

  it('builds request rows with provider/auth-file display resolution and sorting', () => {
    const authFileMap = createAuthFileMap([
      { name: 'Auth File 7', authIndex: '7', type: 'claude' }
    ]);
    const sourceInfoMap = buildSourceInfoMap({
      claudeApiKeys: [{ apiKey: 'key-1', prefix: 'tenant-a' }]
    });
    const rows = createRequestEventRows(
      [
        createDetail({ minutesAgo: 10, source: 'unknown-source', auth_index: '7', __modelName: 'model-b' }),
        createDetail({ minutesAgo: 5, source: 't:tenant-a', auth_index: '1', __modelName: 'model-a' })
      ],
      sourceInfoMap,
      authFileMap,
      'en-US'
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].model).toBe('model-a');
    expect(rows[0].source).toBe('tenant-a');
    expect(rows[1].source).toBe('Auth File 7');
  });

  it('builds request rows for a fixed 24h range independent of page filters', () => {
    const rows = createRequestEventRowsForRange(
      [
        createDetail({ minutesAgo: 60, __modelName: 'model-a', failed: true }),
        createDetail({ minutesAgo: 23 * 60, __modelName: 'model-b', failed: false }),
        createDetail({ minutesAgo: 26 * 60, __modelName: 'model-c', failed: true })
      ],
      '1d',
      baseNow,
      buildSourceInfoMap({}),
      new Map(),
      'en-US'
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.model !== 'model-c')).toBe(true);
  });

  it('builds credential rows by merging provider candidates and auth-index fallback', () => {
    const authFileMap = createAuthFileMap([
      { name: 'Fallback Auth', authIndex: '9', type: 'gemini' }
    ]);
    const rows = createCredentialRows(
      [
        createDetail({ minutesAgo: 5, source: 't:tenant-a', auth_index: '1', failed: false }),
        createDetail({ minutesAgo: 4, source: 't:tenant-a', auth_index: '1', failed: true }),
        createDetail({ minutesAgo: 3, source: '', auth_index: '9', failed: false })
      ],
      {
        geminiApiKeys: [{ apiKey: 'gem-key', prefix: 'tenant-a' }],
        claudeApiKeys: [],
        codexApiKeys: [],
        vertexApiKeys: [],
        openaiCompatibility: []
      },
      authFileMap
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      displayName: 'tenant-a',
      total: 2,
      success: 1,
      failure: 1
    });
    expect(rows[1]).toMatchObject({
      displayName: 'Fallback Auth',
      total: 1,
      success: 1,
      failure: 0
    });
  });

  it('aggregates token distribution once from filtered details', () => {
    const distribution = createTokenDistribution([
      createDetail({ minutesAgo: 5, tokens: { input_tokens: 20, output_tokens: 10, cached_tokens: 5, reasoning_tokens: 1, total_tokens: 36 } }),
      createDetail({ minutesAgo: 4, tokens: { input_tokens: 4, output_tokens: 6, cached_tokens: 0, reasoning_tokens: 3, total_tokens: 13 } })
    ]);

    expect(distribution).toEqual({
      input: 24,
      output: 16,
      cached: 5,
      reasoning: 4
    });
  });

  it('aggregates usage summary metrics for stat cards in a single pass', () => {
    const summary = createUsageSummaryMetrics(
      [
        createDetail({ minutesAgo: 5, __modelName: 'model-a', tokens: { input_tokens: 20, output_tokens: 10, cached_tokens: 5, reasoning_tokens: 1, total_tokens: 36 } }),
        createDetail({ minutesAgo: 5, __modelName: 'model-a', tokens: { input_tokens: 4, output_tokens: 6, cached_tokens: 0, reasoning_tokens: 3, total_tokens: 13 } }),
        createDetail({ minutesAgo: 45, __modelName: 'model-b', tokens: { input_tokens: 10, output_tokens: 2, cached_tokens: 1, reasoning_tokens: 0, total_tokens: 13 } })
      ],
      {
        'model-a': { prompt: 1, completion: 2, cache: 0.5 },
        'model-b': { prompt: 1.5, completion: 3, cache: 0.5 }
      },
      baseNow
    );

    expect(summary.tokenBreakdown).toEqual({
      cachedTokens: 6,
      reasoningTokens: 4,
      inputTokens: 34,
      outputTokens: 18
    });
    expect(summary.rateStats.requestCount).toBe(2);
    expect(summary.rateStats.tokenCount).toBe(49);
    expect(summary.rateStats.peakRpm).toBe(2);
    expect(summary.rateStats.peakTpm).toBe(49);
    expect(summary.rateStats.rpm).toBeCloseTo(2 / 30, 5);
    expect(summary.rateStats.tpm).toBeCloseTo(49 / 30, 5);
    expect(summary.totalCost).toBeGreaterThan(0);
  });

  it('returns empty usage summary metrics without details or prices', () => {
    const summary = createUsageSummaryMetrics([], {}, baseNow);

    expect(summary).toEqual({
      tokenBreakdown: {
        cachedTokens: 0,
        reasoningTokens: 0,
        inputTokens: 0,
        outputTokens: 0
      },
      rateStats: {
        rpm: 0,
        tpm: 0,
        windowMinutes: 30,
        requestCount: 0,
        tokenCount: 0,
        peakRpm: 0,
        peakTpm: 0
      },
      totalCost: 0
    });
  });

  it('builds efficiency overview with failure waste signal and cost yield when prices exist', () => {
    const overview = createEfficiencyOverview(
      [
        createDetail({ minutesAgo: 6, __modelName: 'model-a', tokens: { input_tokens: 20, output_tokens: 10, cached_tokens: 10, reasoning_tokens: 0, total_tokens: 40 } }),
        createDetail({ minutesAgo: 5, __modelName: 'model-a', failed: true, tokens: { input_tokens: 20, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 20 } }),
        createDetail({ minutesAgo: 4, __modelName: 'model-b', tokens: { input_tokens: 10, output_tokens: 15, cached_tokens: 5, reasoning_tokens: 5, total_tokens: 35 } })
      ],
      {
        'model-a': { prompt: 1, completion: 2, cache: 0.5 },
        'model-b': { prompt: 1.5, completion: 3, cache: 0.5 }
      }
    );

    expect(overview.hasData).toBe(true);
    expect(overview.metrics.failureWasteRate).toBeCloseTo(20 / 95, 5);
    expect(overview.metrics.costYield).not.toBeNull();
    expect(overview.signals).toContain('high_failure_waste');
  });

  it('sorts model efficiency rows by lowest score first and degrades cost metrics without prices', () => {
    const rows = createModelEfficiencyRows(
      [
        createDetail({ minutesAgo: 5, __modelName: 'model-a', failed: true, tokens: { input_tokens: 30, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 30 } }),
        createDetail({ minutesAgo: 4, __modelName: 'model-b', tokens: { input_tokens: 10, output_tokens: 20, cached_tokens: 5, reasoning_tokens: 0, total_tokens: 35 } })
      ],
      {}
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].model).toBe('model-a');
    expect(rows[0].costYield).toBeNull();
    expect(rows[1].efficiencyScore).toBeGreaterThan(rows[0].efficiencyScore);
  });

  it('builds credential efficiency rows from resolved source labels and sorts low score first', () => {
    const authFileMap = createAuthFileMap([
      { name: 'Fallback Auth', authIndex: '7', type: 'claude' }
    ]);
    const sourceInfoMap = buildSourceInfoMap({
      claudeApiKeys: [{ apiKey: 'key-1', prefix: 'tenant-a' }]
    });

    const rows = createCredentialEfficiencyRows(
      [
        createDetail({ minutesAgo: 5, source: 't:tenant-a', auth_index: '1', failed: true, __modelName: 'model-a', tokens: { input_tokens: 20, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 20 } }),
        createDetail({ minutesAgo: 4, source: 't:tenant-a', auth_index: '1', __modelName: 'model-a', tokens: { input_tokens: 20, output_tokens: 10, cached_tokens: 5, reasoning_tokens: 0, total_tokens: 35 } }),
        createDetail({ minutesAgo: 3, source: '', auth_index: '7', __modelName: 'model-b', tokens: { input_tokens: 10, output_tokens: 12, cached_tokens: 2, reasoning_tokens: 1, total_tokens: 25 } })
      ],
      sourceInfoMap,
      authFileMap,
      {
        'model-a': { prompt: 1, completion: 2, cache: 0.5 },
        'model-b': { prompt: 1.5, completion: 3, cache: 0.5 }
      }
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].displayName).toBe('tenant-a');
    expect(rows[0].filterAuthIndex).toBe('1');
    expect(rows[0].filterSourceRaw).toBe('t:tenant-a');
    expect(rows[0].failureWasteRate).toBeGreaterThan(rows[1].failureWasteRate);
    expect(rows[1].displayName).toBe('Fallback Auth');
  });

  it('merges credential efficiency rows by resolved display name when auth index is absent', () => {
    const rows = createCredentialEfficiencyRows(
      [
        createDetail({ minutesAgo: 5, source: 't:tenant-a', auth_index: undefined, __modelName: 'model-a' }),
        createDetail({ minutesAgo: 4, source: 'tenant-a', auth_index: undefined, __modelName: 'model-a' })
      ],
      buildSourceInfoMap({}),
      new Map(),
      {}
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe('tenant-a');
    expect(rows[0].requests).toBe(2);
    expect(rows[0].filterSourceRaw).toBeNull();
  });

  it('returns an empty runtime quality summary when there are no requests', () => {
    const summary = createRuntimeQualitySummary({
      usage: { total_requests: 0, success_count: 0, failure_count: 0 },
      details: [],
      credentialRows: [],
      apiStats: [],
      modelStats: []
    });

    expect(summary).toMatchObject({
      hasData: false,
      status: 'empty',
      totalRequests: 0,
      failureCount: 0,
      abnormalWindowCount: 0,
      severeWindowCount: 0,
      affectedCredentialCount: 0,
      affectedEndpointCount: 0,
      primaryIncident: { type: 'none' }
    });
  });

  it('prefers credential incidents when runtime quality summary detects multiple risks', () => {
    const details = Array.from({ length: 20 }, (_, index) =>
      createDetail({
        minutesAgo: 5,
        failed: index < 2,
        source: 't:tenant-a',
        __modelName: 'model-a'
      })
    );

    const summary = createRuntimeQualitySummary({
      usage: { total_requests: 30, success_count: 27, failure_count: 3 },
      details,
      credentialRows: [
        { key: 'credential-1', displayName: 'tenant-a', type: 'claude', total: 30, success: 27, failure: 3, successRate: 90 }
      ],
      apiStats: [
        {
          endpoint: '/v1/messages',
          totalRequests: 30,
          successCount: 27,
          failureCount: 3,
          totalTokens: 600,
          totalCost: 0,
          models: {}
        }
      ],
      modelStats: [
        { model: 'model-a', requests: 30, successCount: 27, failureCount: 3 }
      ]
    });

    expect(summary.status).toBe('critical');
    expect(summary.abnormalWindowCount).toBe(1);
    expect(summary.affectedCredentialCount).toBe(1);
    expect(summary.primaryIncident).toMatchObject({
      type: 'credential',
      name: 'tenant-a',
      failureCount: 3
    });
  });

  it('falls back to endpoint incidents when no credential crosses the threshold', () => {
    const details = Array.from({ length: 20 }, (_, index) =>
      createDetail({
        minutesAgo: index,
        failed: index < 4,
        source: 't:tenant-b',
        __modelName: 'model-b'
      })
    );

    const summary = createRuntimeQualitySummary({
      usage: { total_requests: 40, success_count: 35, failure_count: 5 },
      details,
      credentialRows: [
        { key: 'credential-2', displayName: 'tenant-b', type: 'openai', total: 12, success: 9, failure: 3, successRate: 75 }
      ],
      apiStats: [
        {
          endpoint: '/v1/chat/completions',
          totalRequests: 40,
          successCount: 35,
          failureCount: 5,
          totalTokens: 900,
          totalCost: 0,
          models: {}
        }
      ],
      modelStats: [
        { model: 'model-b', requests: 40, successCount: 35, failureCount: 5 }
      ]
    });

    expect(summary.status).toBe('critical');
    expect(summary.affectedCredentialCount).toBe(0);
    expect(summary.affectedEndpointCount).toBe(1);
    expect(summary.primaryIncident).toMatchObject({
      type: 'endpoint',
      name: '/v1/chat/completions',
      failureCount: 5
    });
  });

  it('downgrades to warning when only model risk exceeds the threshold', () => {
    const summary = createRuntimeQualitySummary({
      usage: { total_requests: 100, success_count: 98, failure_count: 2 },
      details: [],
      credentialRows: [
        { key: 'credential-3', displayName: 'tenant-c', type: 'claude', total: 10, success: 9, failure: 1, successRate: 90 }
      ],
      apiStats: [
        {
          endpoint: '/v1/messages',
          totalRequests: 10,
          successCount: 9,
          failureCount: 1,
          totalTokens: 200,
          totalCost: 0,
          models: {}
        }
      ],
      modelStats: [
        { model: 'model-risky', requests: 40, successCount: 36, failureCount: 4 }
      ]
    });

    expect(summary.status).toBe('warning');
    expect(summary.affectedModelCount).toBe(1);
    expect(summary.primaryIncident).toMatchObject({
      type: 'model',
      name: 'model-risky',
      failureCount: 4
    });
  });
});
