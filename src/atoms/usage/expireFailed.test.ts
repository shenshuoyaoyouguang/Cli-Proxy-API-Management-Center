import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { expireFailedDetails, FAILED_DETAIL_TTL_MS } from './expireFailed';
import type { UsageDetail } from './types';

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

describe('expireFailedDetails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array and zero removedCount for empty input', () => {
    const result = expireFailedDetails([]);
    expect(result.details).toEqual([]);
    expect(result.removedCount).toBe(0);
  });

  it('keeps all success records untouched', () => {
    const details = [
      makeDetail({ failed: false }),
      makeDetail({ failed: false }),
    ];
    const result = expireFailedDetails(details);
    expect(result.details).toHaveLength(2);
    expect(result.removedCount).toBe(0);
  });

  it('keeps failed records within TTL', () => {
    const details = [
      makeDetail({ failed: true, __timestampMs: Date.now() - FAILED_DETAIL_TTL_MS / 2 }),
    ];
    const result = expireFailedDetails(details);
    expect(result.details).toHaveLength(1);
    expect(result.removedCount).toBe(0);
  });

  it('removes failed records older than TTL', () => {
    const details = [
      makeDetail({ failed: true, __timestampMs: Date.now() - FAILED_DETAIL_TTL_MS - 1 }),
    ];
    const result = expireFailedDetails(details);
    expect(result.details).toHaveLength(0);
    expect(result.removedCount).toBe(1);
  });

  it('only removes expired failed records in a mixed set', () => {
    const now = Date.now();
    const details = [
      makeDetail({ failed: false }),
      makeDetail({ failed: true, __timestampMs: now - FAILED_DETAIL_TTL_MS / 2 }),
      makeDetail({ failed: true, __timestampMs: now - FAILED_DETAIL_TTL_MS - 1 }),
    ];
    const result = expireFailedDetails(details);
    expect(result.details).toHaveLength(2);
    expect(result.removedCount).toBe(1);
    expect(result.details.every((d) => d.failed === false || d.__timestampMs === now - FAILED_DETAIL_TTL_MS / 2)).toBe(true);
  });

  it('conservatively keeps failed records with unparseable timestamps', () => {
    const details = [
      makeDetail({ failed: true, __timestampMs: undefined, timestamp: 'invalid' }),
    ];
    const result = expireFailedDetails(details);
    expect(result.details).toHaveLength(1);
    expect(result.removedCount).toBe(0);
  });

  it('respects custom ttlMs', () => {
    const now = Date.now();
    const customTtl = 60 * 1000; // 1 minute
    const details = [
      // 2 minutes ago — should be removed with customTtl
      makeDetail({ failed: true, __timestampMs: now - 120_000 }),
      // 30 seconds ago — should be kept with customTtl
      makeDetail({ failed: true, __timestampMs: now - 30_000 }),
    ];
    const result = expireFailedDetails(details, customTtl);
    expect(result.details).toHaveLength(1);
    expect(result.removedCount).toBe(1);
  });
});

describe('FAILED_DETAIL_TTL_MS', () => {
  it('equals 24 hours in milliseconds', () => {
    expect(FAILED_DETAIL_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});