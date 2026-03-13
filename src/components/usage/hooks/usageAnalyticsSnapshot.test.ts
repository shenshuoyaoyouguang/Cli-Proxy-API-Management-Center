import { describe, expect, it } from 'vitest';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
import type { UsageDetail } from '@/utils/usage';
import {
  createAuthFileMap,
  createCredentialRows,
  createRequestEventRows,
  createTokenDistribution,
  filterUsageDetailsByTimeRange
} from './usageAnalyticsSnapshot';

const baseNow = Date.parse('2026-01-08T12:00:00.000Z');

const createDetail = (
  overrides: Partial<UsageDetail> & { minutesAgo: number; source?: string; auth_index?: number }
): UsageDetail => {
  const timestampMs = baseNow - overrides.minutesAgo * 60 * 1000;
  return {
    timestamp: new Date(timestampMs).toISOString(),
    source: overrides.source ?? 't:tenant-a',
    auth_index: overrides.auth_index ?? 1,
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
      createDetail({ minutesAgo: 8 * 60 })
    ];

    const filtered = filterUsageDetailsByTimeRange(details, '7h', baseNow);
    expect(filtered).toHaveLength(2);
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
        createDetail({ minutesAgo: 10, source: 'unknown-source', auth_index: 7, __modelName: 'model-b' }),
        createDetail({ minutesAgo: 5, source: 't:tenant-a', auth_index: 1, __modelName: 'model-a' })
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

  it('builds credential rows by merging provider candidates and auth-index fallback', () => {
    const authFileMap = createAuthFileMap([
      { name: 'Fallback Auth', authIndex: '9', type: 'gemini' }
    ]);
    const rows = createCredentialRows(
      [
        createDetail({ minutesAgo: 5, source: 't:tenant-a', auth_index: 1, failed: false }),
        createDetail({ minutesAgo: 4, source: 't:tenant-a', auth_index: 1, failed: true }),
        createDetail({ minutesAgo: 3, source: '', auth_index: 9, failed: false })
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
});
