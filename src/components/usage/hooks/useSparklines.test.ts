import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collectUsageDetailsSpy: vi.fn(),
}));

vi.mock('@/utils/usage', async () => {
  const actual = await vi.importActual<typeof import('@/utils/usage')>('@/utils/usage');
  mocks.collectUsageDetailsSpy.mockImplementation(actual.collectUsageDetails);
  return {
    ...actual,
    collectUsageDetails: mocks.collectUsageDetailsSpy,
  };
});

import { useSparklines } from './useSparklines';

describe('useSparklines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives RPM/TPM sparklines from rolling rate series and reuses provided usageDetails', () => {
    const nowMs = Date.parse('2026-01-08T12:00:00.000Z');
    const usageDetails = [
      {
        timestamp: new Date(nowMs - 60_000).toISOString(),
        source: 'tenant-a',
        auth_index: '1',
        failed: false,
        __modelName: 'gpt-4.1',
        __timestampMs: nowMs - 60_000,
        tokens: {
          input_tokens: 30,
          output_tokens: 30,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 60,
        },
      },
    ];

    const { result, rerender } = renderHook(
      (props: { usage: { apis: Record<string, unknown> } }) =>
        useSparklines({
          usage: props.usage,
          usageDetails,
          loading: false,
          modelPrices: {},
          nowMs,
        }),
      {
        initialProps: {
          usage: { apis: {} },
        },
      }
    );
    const requestPoints = result.current.requestsSparkline?.data.datasets[0].data ?? [];
    const rpmPoints = result.current.rpmSparkline?.data.datasets[0].data ?? [];
    const tpmPoints = result.current.tpmSparkline?.data.datasets[0].data ?? [];

    expect(mocks.collectUsageDetailsSpy).not.toHaveBeenCalled();
    expect(requestPoints[requestPoints.length - 1]).toBe(1);
    expect(rpmPoints[rpmPoints.length - 1]).toBeCloseTo(1 / 30, 5);
    expect(tpmPoints[tpmPoints.length - 1]).toBeCloseTo(2, 5);
    expect(rpmPoints[rpmPoints.length - 1]).not.toBe(requestPoints[requestPoints.length - 1]);

    rerender({ usage: { apis: { refreshed: {} } } });
    expect(mocks.collectUsageDetailsSpy).not.toHaveBeenCalled();
  });

  it('builds both 7d and 30d daily sparklines for metric cards', () => {
    const nowMs = Date.parse('2026-02-08T12:00:00.000Z');
    const usageDetails = Array.from({ length: 14 }, (_, index) => {
      const timestamp = nowMs - index * 24 * 60 * 60 * 1000;
      return {
        timestamp: new Date(timestamp).toISOString(),
        source: 'tenant-a',
        auth_index: '1',
        failed: false,
        __modelName: 'gpt-4.1',
        __timestampMs: timestamp,
        tokens: {
          input_tokens: 10 + index,
          output_tokens: 5,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 15 + index,
        },
      };
    });

    const { result } = renderHook(() =>
      useSparklines({
        usage: { apis: {} },
        usageDetails,
        loading: false,
        modelPrices: {},
        nowMs,
      })
    );

    expect(result.current.dayRpmSparkline['7d']?.period).toBe('7d');
    expect(result.current.dayRpmSparkline['30d']?.period).toBe('30d');
    expect(result.current.dayRpmSparkline['7d']?.data.labels).toHaveLength(7);
    expect(result.current.dayRpmSparkline['30d']?.data.labels).toHaveLength(30);
    expect(result.current.dayTpmSparkline['30d']?.data.datasets[0].data.some((value) => value > 0)).toBe(
      true
    );
  });
});
