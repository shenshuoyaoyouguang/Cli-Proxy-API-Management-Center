import { describe, expect, it } from 'vitest';
import {
  pickEarlierResetTime,
  minNullableNumber,
  getAntigravityQuotaInfo,
  findAntigravityModel,
  buildKimiQuotaRows,
} from './builders';

describe('pickEarlierResetTime', () => {
  it('returns next when current is undefined', () => {
    expect(pickEarlierResetTime(undefined, '2025-01-02')).toBe('2025-01-02');
  });

  it('returns current when next is undefined', () => {
    expect(pickEarlierResetTime('2025-01-01', undefined)).toBe('2025-01-01');
  });

  it('returns the earlier date', () => {
    expect(pickEarlierResetTime('2025-01-05', '2025-01-01')).toBe('2025-01-01');
    expect(pickEarlierResetTime('2025-01-01', '2025-01-05')).toBe('2025-01-01');
  });

  it('handles invalid date strings gracefully', () => {
    expect(pickEarlierResetTime('invalid', '2025-01-01')).toBe('2025-01-01');
    expect(pickEarlierResetTime('2025-01-01', 'invalid')).toBe('2025-01-01');
  });

  it('returns undefined when both are undefined', () => {
    expect(pickEarlierResetTime(undefined, undefined)).toBeUndefined();
  });
});

describe('minNullableNumber', () => {
  it('returns next when current is null', () => {
    expect(minNullableNumber(null, 5)).toBe(5);
  });

  it('returns current when next is null', () => {
    expect(minNullableNumber(5, null)).toBe(5);
  });

  it('returns the smaller value', () => {
    expect(minNullableNumber(3, 7)).toBe(3);
    expect(minNullableNumber(7, 3)).toBe(3);
  });

  it('returns null when both are null', () => {
    expect(minNullableNumber(null, null)).toBeNull();
  });

  it('handles equal values', () => {
    expect(minNullableNumber(5, 5)).toBe(5);
  });
});

describe('getAntigravityQuotaInfo', () => {
  it('returns null remainingFraction when entry is undefined', () => {
    const result = getAntigravityQuotaInfo(undefined);
    expect(result.remainingFraction).toBeNull();
    expect(result.resetTime).toBeUndefined();
    expect(result.displayName).toBeUndefined();
  });

  it('extracts quota info from entry', () => {
    const entry = {
      quotaInfo: {
        remainingFraction: 0.5,
        resetTime: '2025-01-01T00:00:00Z',
      },
      displayName: 'Test Model',
    };
    const result = getAntigravityQuotaInfo(entry);
    expect(result.remainingFraction).toBe(0.5);
    expect(result.resetTime).toBe('2025-01-01T00:00:00Z');
    expect(result.displayName).toBe('Test Model');
  });

  it('handles snake_case property names', () => {
    const entry = {
      quota_info: {
        remaining_fraction: 0.75,
        reset_time: '2025-01-02',
      },
    };
    const result = getAntigravityQuotaInfo(entry);
    expect(result.remainingFraction).toBe(0.75);
    expect(result.resetTime).toBe('2025-01-02');
  });

  it('handles missing quotaInfo gracefully', () => {
    const entry = { displayName: 'Model' };
    const result = getAntigravityQuotaInfo(entry);
    expect(result.remainingFraction).toBeNull();
    expect(result.displayName).toBe('Model');
  });
});

describe('findAntigravityModel', () => {
  const models = {
    'model-1': { displayName: 'GPT-4', quotaInfo: { remainingFraction: 0.5 } },
    'model-2': { displayName: 'Claude', quotaInfo: { remainingFraction: 0.3 } },
  };

  it('finds model by direct ID', () => {
    const result = findAntigravityModel(models, 'model-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('model-1');
  });

  it('finds model by displayName (case-insensitive)', () => {
    const result = findAntigravityModel(models, 'gpt-4');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('model-1');
  });

  it('returns null when model is not found', () => {
    const result = findAntigravityModel(models, 'non-existent');
    expect(result).toBeNull();
  });
});

describe('buildKimiQuotaRows', () => {
  it('returns empty array for empty payload', () => {
    expect(buildKimiQuotaRows({})).toEqual([]);
  });

  it('builds summary row from usage data', () => {
    const payload = {
      usage: { limit: 1000, used: 500 },
    };
    const rows = buildKimiQuotaRows(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('summary');
    expect(rows[0].used).toBe(500);
    expect(rows[0].limit).toBe(1000);
  });

  it('builds rows from limits array', () => {
    const payload = {
      limits: [
        { detail: { limit: 100, used: 50 }, window: { duration: 60, timeUnit: 'MINUTES' } },
        { detail: { limit: 200, used: 150 }, window: { duration: 24, timeUnit: 'HOURS' } },
      ],
    };
    const rows = buildKimiQuotaRows(payload);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('limit-0');
    expect(rows[1].id).toBe('limit-1');
  });

  it('calculates used from remaining when used is not provided', () => {
    const payload = {
      usage: { limit: 1000, remaining: 300 },
    };
    const rows = buildKimiQuotaRows(payload);
    expect(rows[0].used).toBe(700);
  });

  it('includes resetHint when available', () => {
    const payload = {
      usage: { limit: 1000, used: 500, reset_in: 3600 },
    };
    const rows = buildKimiQuotaRows(payload);
    expect(rows[0].resetHint).toBe('1h');
  });
});
