import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageDetail } from '@/utils/usage';

vi.mock('@/services/api/usage', () => ({
  usageApi: {
    autoPersistUsage: vi.fn(),
  },
}));

import { usageApi } from '@/services/api/usage';
import { AutoPersistService } from './AutoPersistService';

const createUsageDetails = (count: number): UsageDetail[] =>
  Array.from({ length: count }, (_, index) => ({
    timestamp: `2025-01-01T00:${String(index % 60).padStart(2, '0')}:00Z`,
    source: 'session',
    auth_index: '0',
    tokens: {
      input_tokens: 1,
      output_tokens: 1,
      reasoning_tokens: 0,
      cached_tokens: 0,
      total_tokens: 2,
    },
    failed: false,
  }));

describe('AutoPersistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('keeps newly arrived usage eligible for a later persist after an in-flight upload', async () => {
    let resolveFirstPersist: (() => void) | undefined;
    vi.mocked(usageApi.autoPersistUsage)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstPersist = () => resolve();
          }) as never
      )
      .mockResolvedValueOnce({} as never);

    const service = new AutoPersistService();
    const scopeKey = 'scope';

    service.onUsageRefreshed({
      scopeKey,
      usage: { apis: { first: {} } },
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: createUsageDetails(10),
      lastRefreshedAt: Date.now(),
    });

    vi.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(usageApi.autoPersistUsage).toHaveBeenCalledTimes(1);

    service.onUsageRefreshed({
      scopeKey,
      usage: { apis: { second: {} } },
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: createUsageDetails(20),
      lastRefreshedAt: Date.now(),
    });

    const finishFirstPersist = resolveFirstPersist;
    expect(finishFirstPersist).toBeTypeOf('function');
    if (!finishFirstPersist) {
      throw new Error('expected first persist resolver');
    }
    finishFirstPersist();
    await Promise.resolve();

    vi.advanceTimersByTime(60_000);
    await (service as unknown as { maybePersist: () => Promise<void> }).maybePersist();

    expect(usageApi.autoPersistUsage).toHaveBeenCalledTimes(2);

    service.clearRuntimeState(scopeKey, { removePersisted: true });
  });

  it('waits for the startup delay before the first auto-persist upload', async () => {
    vi.mocked(usageApi.autoPersistUsage).mockResolvedValue({} as never);

    const service = new AutoPersistService();

    service.onUsageRefreshed({
      scopeKey: 'startup-delay',
      usage: { apis: { first: {} } },
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: createUsageDetails(10),
      lastRefreshedAt: Date.now(),
    });

    expect(usageApi.autoPersistUsage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(29_999);
    await Promise.resolve();
    expect(usageApi.autoPersistUsage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(usageApi.autoPersistUsage).toHaveBeenCalledTimes(1);
  });

  it('stores lite fallback snapshots without freshness metadata', () => {
    const persistedValues = new Map<string, string>();
    const originalSetItem = Storage.prototype.setItem;
    const originalGetItem = Storage.prototype.getItem;
    let setItemAttempts = 0;

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      setItemAttempts += 1;
      if (setItemAttempts <= 2) {
        throw new Error('quota exceeded');
      }
      persistedValues.set(key, value);
      return originalSetItem.call(this, key, value);
    });
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string
    ) {
      if (persistedValues.has(key)) {
        return persistedValues.get(key) ?? null;
      }
      return originalGetItem.call(this, key);
    });

    const service = new AutoPersistService();
    const scopeKey = 'scope-lite';

    service.onUsageRefreshed({
      scopeKey,
      usage: { apis: { first: {} } },
      keyStats: { bySource: { first: { success: 10, failure: 0 } }, byAuthIndex: {} },
      usageDetails: createUsageDetails(10),
      lastRefreshedAt: Date.now(),
    });
    service.clearRuntimeState(scopeKey);

    expect(service.readBootstrapSnapshot(scopeKey)).toMatchObject({
      scopeKey,
      usage: null,
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: [],
      detailCount: 0,
      lastRefreshedAt: null,
    });

    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
  });

  it('does not recreate cleared persisted snapshots when an in-flight upload finishes', async () => {
    let resolvePersist: (() => void) | undefined;
    vi.mocked(usageApi.autoPersistUsage).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePersist = () => resolve();
        }) as never
    );

    const service = new AutoPersistService();
    const scopeKey = 'scope-cleared';
    const storageKey = `cli-proxy-usage-auto-persist-v1:${encodeURIComponent(scopeKey)}`;

    service.onUsageRefreshed({
      scopeKey,
      usage: { apis: { first: {} } },
      keyStats: { bySource: { first: { success: 10, failure: 0 } }, byAuthIndex: {} },
      usageDetails: createUsageDetails(10),
      lastRefreshedAt: Date.now(),
    });

    vi.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(localStorage.getItem(storageKey)).not.toBeNull();

    service.clearRuntimeState(scopeKey, { removePersisted: true });
    expect(service.readBootstrapSnapshot(scopeKey)).toBeNull();

    const finishPersist = resolvePersist;
    expect(finishPersist).toBeTypeOf('function');
    if (!finishPersist) {
      throw new Error('expected pending persist resolver');
    }
    finishPersist();
    await Promise.resolve();
    await Promise.resolve();

    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(service.readBootstrapSnapshot(scopeKey)).toBeNull();
  });
});
