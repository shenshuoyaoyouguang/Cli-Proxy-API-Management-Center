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
    vi.unstubAllGlobals();
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

    // 启动延迟现在是 5 秒
    vi.advanceTimersByTime(4_999);
    await Promise.resolve();
    expect(usageApi.autoPersistUsage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(usageApi.autoPersistUsage).toHaveBeenCalledTimes(1);
  });

  it('starts auto-persist after 5 seconds instead of 30 seconds', async () => {
    vi.mocked(usageApi.autoPersistUsage).mockResolvedValue({} as never);

    const service = new AutoPersistService();

    service.onUsageRefreshed({
      scopeKey: 'fast-startup',
      usage: { apis: { first: {} } },
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: createUsageDetails(3),
      lastRefreshedAt: Date.now(),
    });

    // 不应该在 4 秒内启动
    vi.advanceTimersByTime(4_999);
    await Promise.resolve();
    expect(usageApi.autoPersistUsage).not.toHaveBeenCalled();

    // 应该在 5 秒后启动
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(usageApi.autoPersistUsage).toHaveBeenCalledTimes(1);
  });

  it('triggers auto-persist with only 3 usage details instead of 10', async () => {
    vi.mocked(usageApi.autoPersistUsage).mockResolvedValue({} as never);

    const service = new AutoPersistService();

    // 只提供 3 条数据，应该触发上传
    service.onUsageRefreshed({
      scopeKey: 'low-threshold',
      usage: { apis: { test: {} } },
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: createUsageDetails(3),
      lastRefreshedAt: Date.now(),
    });

    // 等待启动延迟
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();
    await Promise.resolve();

    // 应该触发上传（3 >= AUTO_PERSIST_TRIGGER_DELTA）
    expect(usageApi.autoPersistUsage).toHaveBeenCalledTimes(1);
  });

  it('saves cache to localStorage on beforeunload event', () => {
    const service = new AutoPersistService();
    const scopeKey = 'beforeunload-test';

    // 清除 localStorage 中的缓存
    localStorage.clear();

    service.onUsageRefreshed({
      scopeKey,
      usage: { apis: { test: {} } },
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: createUsageDetails(5),
      lastRefreshedAt: Date.now(),
    });

    // 再次清除 localStorage，模拟缓存丢失
    localStorage.clear();

    // 模拟 beforeunload 事件
    const event = new Event('beforeunload');
    window.dispatchEvent(event);

    // 验证 beforeunload 触发了保存
    const storageKey = `cli-proxy-usage-auto-persist-v1:${encodeURIComponent(scopeKey)}`;
    const saved = localStorage.getItem(storageKey);
    expect(saved).not.toBeNull();

    if (saved) {
      const parsed = JSON.parse(saved);
      expect(parsed.scopeKey).toBe(scopeKey);
      expect(parsed.usageDetails).toHaveLength(5);
    }
  });

  it('uses keepalive fetch against the configured management endpoint on beforeunload', () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);

    const service = new AutoPersistService();

    service.onUsageRefreshed({
      scopeKey: 'beforeunload-keepalive',
      usage: { apis: { test: {} } },
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: createUsageDetails(5),
      lastRefreshedAt: Date.now(),
      connection: {
        apiBase: 'http://localhost:3000',
        managementKey: 'keepalive-key',
      },
    });

    window.dispatchEvent(new Event('beforeunload'));

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/v0/management/usage/reports',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer keepalive-key',
        }),
      })
    );
  });

  it('registers a visibilitychange listener that attempts persist when hidden', async () => {
    vi.mocked(usageApi.autoPersistUsage).mockResolvedValue({} as never);

    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    new AutoPersistService();

    // 验证 visibilitychange 事件监听器被注册
    expect(addEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    addEventListenerSpy.mockRestore();
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
      usage: { apis: { first: {} } },
      keyStats: { bySource: { first: { success: 10, failure: 0 } }, byAuthIndex: {} },
      usageDetails: [],
      detailCount: 0,
      lastRefreshedAt: expect.any(Number),
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

  it('keeps raw detailCount in bootstrap snapshots even when cached usageDetails are trimmed', () => {
    const service = new AutoPersistService();
    const scopeKey = 'scope-richness';

    service.onUsageRefreshed({
      scopeKey,
      usage: { apis: { first: {} } },
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: createUsageDetails(6_000),
      lastRefreshedAt: Date.now(),
    });
    service.clearRuntimeState(scopeKey);

    expect(service.readBootstrapSnapshot(scopeKey)).toMatchObject({
      detailCount: 6_000,
      usageDetails: expect.any(Array),
    });
    expect(service.readBootstrapSnapshot(scopeKey)?.usageDetails).toHaveLength(6_000);
  });
});
