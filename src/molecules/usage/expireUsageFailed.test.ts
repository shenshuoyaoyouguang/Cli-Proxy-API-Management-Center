import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { UsageDetail } from '@/atoms/usage/types';
import { expireUsageFailed as expireUsageFailedMolecule } from './expireUsageFailed';
import { FAILED_DETAIL_TTL_MS } from '@/atoms/usage/expireFailed';

const makeDetail = (overrides: Partial<UsageDetail> & { failed: boolean }): UsageDetail => ({
  timestamp: new Date().toISOString(),
  source: 'test',
  auth_index: null,
  tokens: {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
  },
  ...overrides,
});

const NOW = new Date('2025-06-01T12:00:00Z').getTime();

describe('expireUsageFailed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty result when both usage and usageDetails are empty', () => {
    const result = expireUsageFailedMolecule(null, []);
    expect(result.usage).toBeNull();
    expect(result.usageDetails).toEqual([]);
    expect(result.removedCount).toBe(0);
    expect(result.topLevelRemovedCount).toBe(0);
  });

  it('cleans only top-level usageDetails when usage is null', () => {
    const details = [
      makeDetail({ failed: true, __timestampMs: NOW - FAILED_DETAIL_TTL_MS - 1 }),
      makeDetail({ failed: false }),
    ];
    const result = expireUsageFailedMolecule(null, details);
    expect(result.usage).toBeNull();
    expect(result.usageDetails).toHaveLength(1);
    expect(result.removedCount).toBe(1);
    expect(result.topLevelRemovedCount).toBe(1);
  });

  it('cleans nested details inside usage snapshot', () => {
    const cutoff = NOW - FAILED_DETAIL_TTL_MS;
    const usage = {
      apis: {
        'api-1': {
          total_requests: 3,
          success_count: 1,
          failure_count: 2,
          total_tokens: 0,
          models: {
            'model-a': {
              total_requests: 3,
              success_count: 1,
              failure_count: 2,
              total_tokens: 0,
              details: [
                { failed: true, timestamp: new Date(cutoff - 1).toISOString(), __timestampMs: cutoff - 1 },
                { failed: true, timestamp: new Date(NOW).toISOString(), __timestampMs: NOW },
                { failed: false, timestamp: new Date(NOW).toISOString(), __timestampMs: NOW },
              ],
            },
          },
        },
      },
    };

    const result = expireUsageFailedMolecule(usage, []);
    expect(result.removedCount).toBe(1);
    expect(result.topLevelRemovedCount).toBe(0);

    const cleanedApis = (result.usage as Record<string, unknown>)?.apis as Record<string, unknown>;
    const apiEntry = cleanedApis['api-1'] as Record<string, unknown>;
    const models = apiEntry.models as Record<string, unknown>;
    const modelEntry = models['model-a'] as Record<string, unknown>;
    const details = modelEntry.details as unknown[];

    // One expired failed detail removed, one recent failed + one success kept
    expect(details).toHaveLength(2);
  });

  it('removes from both top-level and nested and sums removedCount correctly', () => {
    const cutoff = NOW - FAILED_DETAIL_TTL_MS;
    const usage = {
      apis: {
        'api-1': {
          total_requests: 1,
          success_count: 0,
          failure_count: 1,
          total_tokens: 0,
          models: {
            'model-a': {
              total_requests: 1,
              success_count: 0,
              failure_count: 1,
              total_tokens: 0,
              details: [
                { failed: true, timestamp: new Date(cutoff - 1).toISOString(), __timestampMs: cutoff - 1 },
              ],
            },
          },
        },
      },
    };

    const topLevelDetails = [
      makeDetail({ failed: true, __timestampMs: cutoff - 1 }),
      makeDetail({ failed: false }),
    ];

    const result = expireUsageFailedMolecule(usage, topLevelDetails);
    expect(result.removedCount).toBe(2); // 1 top-level + 1 nested
    expect(result.topLevelRemovedCount).toBe(1);
    expect(result.usageDetails).toHaveLength(1); // only success record left
  });

  it('does not modify input references', () => {
    const details = [
      makeDetail({ failed: true, __timestampMs: NOW - FAILED_DETAIL_TTL_MS - 1 }),
      makeDetail({ failed: false }),
    ];
    const usage = {
      apis: {
        'api-1': {
          total_requests: 1,
          success_count: 1,
          failure_count: 0,
          total_tokens: 0,
          models: {
            'model-a': {
              total_requests: 1,
              success_count: 1,
              failure_count: 0,
              total_tokens: 0,
              details: [{ failed: true, timestamp: new Date(NOW - FAILED_DETAIL_TTL_MS - 1).toISOString() }],
            },
          },
        },
      },
    };

    const detailsCopy = [...details];
    const usageCopy = JSON.parse(JSON.stringify(usage));

    expireUsageFailedMolecule(usage, details);

    expect(details).toEqual(detailsCopy);
    expect(usage).toEqual(usageCopy);
  });

  it('returns zero counts when nothing is expired', () => {
    const details = [
      makeDetail({ failed: true, __timestampMs: NOW - 1000 }),
    ];
    const result = expireUsageFailedMolecule(null, details);
    expect(result.removedCount).toBe(0);
    expect(result.topLevelRemovedCount).toBe(0);
    expect(result.usageDetails).toHaveLength(1);
  });

  it('handles usage with missing or malformed apis gracefully', () => {
    const usage = { total_requests: 0 };
    const result = expireUsageFailedMolecule(usage, []);
    expect(result.removedCount).toBe(0);
    expect(result.usage).not.toBeNull();
  });
});