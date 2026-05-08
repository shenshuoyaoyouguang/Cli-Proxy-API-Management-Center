import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storeState: {
    usage: null,
    loading: false,
    error: null,
    lastRefreshedAt: null,
    usageDetails: [] as Array<Record<string, unknown>>,
    loadUsageStats: vi.fn().mockResolvedValue(undefined),
  },
  notificationState: {
    showNotification: vi.fn(),
  },
  usageApi: {
    exportUsage: vi.fn(),
    importUsage: vi.fn(),
  },
  loadModelPrices: vi.fn(() => ({})),
  saveModelPrices: vi.fn(),
  syncPricesForModels: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/stores', () => ({
  USAGE_STATS_STALE_TIME_MS: 120000,
  useNotificationStore: <T,>(
    selector?: (state: typeof mocks.notificationState) => T
  ) => (typeof selector === 'function' ? selector(mocks.notificationState) : mocks.notificationState),
  useUsageStatsStore: <T,>(selector: (state: typeof mocks.storeState) => T) =>
    selector(mocks.storeState),
}));

vi.mock('@/services/api/usage', () => ({
  usageApi: mocks.usageApi,
}));

vi.mock('@/utils/usage', () => ({
  loadModelPrices: mocks.loadModelPrices,
  saveModelPrices: mocks.saveModelPrices,
}));

vi.mock('@/molecules/usage/priceAutoSync', () => ({
  syncPricesForModels: mocks.syncPricesForModels,
}));

import { useUsageData } from './useUsageData';

describe('useUsageData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mocks.storeState.usage = null;
    mocks.storeState.loading = false;
    mocks.storeState.error = null;
    mocks.storeState.lastRefreshedAt = null;
    mocks.storeState.usageDetails = [];
    mocks.storeState.loadUsageStats.mockResolvedValue(undefined);

    mocks.loadModelPrices.mockReturnValue({});
    mocks.syncPricesForModels.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects structurally invalid import payloads before calling the API', async () => {
    const { result } = renderHook(() => useUsageData());
    const file = new File([JSON.stringify({ invalid: true })], 'usage.json', {
      type: 'application/json',
    });
    const event = {
      target: {
        files: [file],
        value: 'selected-file',
      },
    } as unknown as ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleImportChange(event);
    });

    expect(mocks.usageApi.importUsage).not.toHaveBeenCalled();
    expect(mocks.notificationState.showNotification).toHaveBeenCalledWith(
      'usage_stats.import_invalid',
      'error'
    );
    expect((event.target as HTMLInputElement).value).toBe('');
  });

  it('retries model price sync after a failed attempt instead of permanently giving up', async () => {
    const updatedPrices = {
      'gpt-4.1': { prompt: 1, completion: 2, cache: 0.5 },
    };

    mocks.storeState.usageDetails = [
      {
        timestamp: '2026-01-08T12:00:00.000Z',
        source: 'tenant-a',
        auth_index: '1',
        failed: false,
        __modelName: 'gpt-4.1',
        tokens: {
          input_tokens: 10,
          output_tokens: 5,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 15,
        },
      },
    ];

    mocks.syncPricesForModels
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce(updatedPrices);

    renderHook(() => useUsageData());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.syncPricesForModels).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.syncPricesForModels).toHaveBeenCalledTimes(2);
    expect(mocks.saveModelPrices).toHaveBeenCalledWith(updatedPrices);
  });
});
