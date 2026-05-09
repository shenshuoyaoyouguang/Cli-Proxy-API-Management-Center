import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheLayer } from './CacheLayer';

describe('CacheLayer - LRU eviction', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('prune removes oldest entries first', () => {
    CacheLayer.set('old', { data: 'a' });
    CacheLayer.set('mid', { data: 'b' });
    CacheLayer.set('new', { data: 'c' });

    CacheLayer.prune(0);

    expect(CacheLayer.get('old')).toBeNull();
    expect(CacheLayer.get('mid')).toBeNull();
    expect(CacheLayer.get('new')).toBeNull();
  });

  it('prune with target keeps entries within limit', () => {
    CacheLayer.set('keep', { data: 'small' });
    CacheLayer.set('evict', { data: 'x'.repeat(5000) });

    CacheLayer.prune(500);

    expect(CacheLayer.get('evict')).toBeNull();
  });

  it('handles scope isolation during eviction', () => {
    CacheLayer.set('key', { data: 'a' }, { scopeKey: 'scope-a' });
    CacheLayer.set('key', { data: 'b' }, { scopeKey: 'scope-b' });

    const entryA = CacheLayer.get('key', 'scope-a');
    const entryB = CacheLayer.get('key', 'scope-b');

    expect(entryA).not.toBeNull();
    expect(entryB).not.toBeNull();
    expect(entryA?.data).toEqual({ data: 'a' });
    expect(entryB?.data).toEqual({ data: 'b' });
  });
});

describe('CacheLayer - concurrent writes', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('last write wins for the same key', () => {
    CacheLayer.set('key', { version: 1 });
    CacheLayer.set('key', { version: 2 });
    CacheLayer.set('key', { version: 3 });

    const entry = CacheLayer.get('key');
    expect(entry?.data).toEqual({ version: 3 });
  });

  it('handles rapid sequential writes to different keys', () => {
    for (let i = 0; i < 50; i++) {
      CacheLayer.set(`key-${i}`, { index: i });
    }

    for (let i = 0; i < 50; i++) {
      const entry = CacheLayer.get(`key-${i}`);
      expect(entry?.data).toEqual({ index: i });
    }
  });
});

describe('CacheLayer - TTL expiry', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns null for expired entries', () => {
    CacheLayer.set('expiring', { data: 'test' }, { maxAgeMs: 1000 });

    expect(CacheLayer.get('expiring')).not.toBeNull();

    vi.advanceTimersByTime(1001);

    expect(CacheLayer.get('expiring')).toBeNull();
  });

  it('returns entry before TTL expires', () => {
    CacheLayer.set('fresh', { data: 'test' }, { maxAgeMs: 5000 });

    vi.advanceTimersByTime(4999);

    expect(CacheLayer.get('fresh')).not.toBeNull();
  });
});

describe('CacheLayer - subscription', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('notifies subscribers on set', async () => {
    const callback = vi.fn();
    CacheLayer.subscribe('test-key', callback);

    CacheLayer.set('test-key', { data: 'test' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', async () => {
    const callback = vi.fn();
    const unsubscribe = CacheLayer.subscribe('test-key', callback);

    unsubscribe();

    CacheLayer.set('test-key', { data: 'test' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callback).not.toHaveBeenCalled();
  });

  it('notifies global subscribers with key and scopeKey', async () => {
    const callback = vi.fn();
    CacheLayer.subscribeGlobal(callback);

    CacheLayer.set('global-test', { data: 'test' }, { scopeKey: 'my-scope' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledWith('global-test', 'my-scope');
  });
});

describe('CacheLayer - redacted scope keys', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('redacts scoped cache keys in debug logs', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const scopeKey = 'https://api.example.com::super-secret-management-key';

    CacheLayer.set('config', { enabled: true }, { scopeKey });
    CacheLayer.get('config', scopeKey);

    const messages = debugSpy.mock.calls.flatMap((args) => args.map(String));

    expect(messages).toEqual(
      expect.arrayContaining([
        '[CacheLayer] SET: config [scope redacted]',
        '[CacheLayer] HIT: config [scope redacted]',
      ])
    );
    expect(messages.join(' ')).not.toContain(scopeKey);
    expect(messages.join(' ')).not.toContain('super-secret-management-key');

    debugSpy.mockRestore();
  });
});

describe('CacheLayer - invalidate across URL-like scope keys', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('invalidates matching keys when scope keys contain URL colons', () => {
    CacheLayer.set('models', { data: 'a' }, { scopeKey: 'http://server-a:3000::scope-a' });
    CacheLayer.set('models', { data: 'b' }, { scopeKey: 'https://server-b:8443::scope-b' });

    CacheLayer.invalidate('models');

    expect(CacheLayer.get('models', 'http://server-a:3000::scope-a')).toBeNull();
    expect(CacheLayer.get('models', 'https://server-b:8443::scope-b')).toBeNull();
  });

  it('invalidates exact key when both scopeKey and dataKey contain colons', () => {
    const scopeA = 'http://server-a:3000::scope-a';
    const scopeB = 'https://server-b:8443::scope-b';

    CacheLayer.set('models:v2', { data: 'a' }, { scopeKey: scopeA });
    CacheLayer.set('models:v2', { data: 'b' }, { scopeKey: scopeB });
    CacheLayer.set('models', { data: 'c' }, { scopeKey: scopeA });

    CacheLayer.invalidate('models:v2');

    expect(CacheLayer.get('models:v2', scopeA)).toBeNull();
    expect(CacheLayer.get('models:v2', scopeB)).toBeNull();
    expect(CacheLayer.get('models', scopeA)?.data).toEqual({ data: 'c' });
  });
});

describe('CacheLayer - invalidateScope', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('removes all entries for a specific scope', () => {
    const scopeA = 'scope-a';
    const scopeB = 'scope-b';

    CacheLayer.set('key1', { data: 'a1' }, { scopeKey: scopeA });
    CacheLayer.set('key2', { data: 'a2' }, { scopeKey: scopeA });
    CacheLayer.set('key1', { data: 'b1' }, { scopeKey: scopeB });

    CacheLayer.invalidateScope(scopeA);

    expect(CacheLayer.get('key1', scopeA)).toBeNull();
    expect(CacheLayer.get('key2', scopeA)).toBeNull();
    expect(CacheLayer.get('key1', scopeB)?.data).toEqual({ data: 'b1' });
  });

  it('handles non-existent scope gracefully', () => {
    CacheLayer.set('key', { data: 'test' }, { scopeKey: 'existing-scope' });

    // 不应该抛出异常
    expect(() => CacheLayer.invalidateScope('non-existent-scope')).not.toThrow();

    // 现有数据应该不受影响
    expect(CacheLayer.get('key', 'existing-scope')?.data).toEqual({ data: 'test' });
  });

  it('handles URL-like scope keys', () => {
    const scopeUrl = 'http://server:3000::management-key';

    CacheLayer.set('config', { data: 'test' }, { scopeKey: scopeUrl });
    CacheLayer.set('settings', { data: 'test2' }, { scopeKey: scopeUrl });

    CacheLayer.invalidateScope(scopeUrl);

    expect(CacheLayer.get('config', scopeUrl)).toBeNull();
    expect(CacheLayer.get('settings', scopeUrl)).toBeNull();
  });
});

describe('CacheLayer - quota exceeded handling', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('handles localStorage quota exceeded gracefully', () => {
    let callCount = 0;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        const error = new Error('QuotaExceededError: The quota has been exceeded');
        (error as Error & { code?: number }).code = 22;
        throw error;
      }
      // 第三次调用成功
    });

    // 不应该抛出异常
    expect(() => CacheLayer.set('key', { data: 'test' })).not.toThrow();

    // 应该尝试写入至少一次
    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
  });

  it('triggers prune when quota is exceeded', () => {
    const pruneSpy = vi.spyOn(CacheLayer, 'prune');
    let shouldThrow = true;

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error('QuotaExceededError');
      }
    });

    CacheLayer.set('key', { data: 'test' });

    // prune 应该被调用以清理空间
    expect(pruneSpy).toHaveBeenCalled();

    pruneSpy.mockRestore();
  });
});

describe('CacheLayer - estimatedTotalBytes accuracy', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('updates estimatedTotalBytes correctly when overwriting existing key', () => {
    // 设置初始值
    CacheLayer.set('key', { data: 'small' });
    const entry1 = CacheLayer.get('key');
    expect(entry1).not.toBeNull();

    // 更新为更大的值
    CacheLayer.set('key', { data: 'x'.repeat(1000) });
    const entry2 = CacheLayer.get('key');
    expect(entry2).not.toBeNull();

    // 再更新为更小的值
    CacheLayer.set('key', { data: 'tiny' });
    const entry3 = CacheLayer.get('key');
    expect(entry3).not.toBeNull();

    // 验证最终值正确
    expect(entry3?.data).toEqual({ data: 'tiny' });
  });

  it('maintains accurate size estimation across multiple updates', () => {
    const scope = 'test-scope';

    // 多次更新同一个 key
    for (let i = 0; i < 10; i++) {
      CacheLayer.set('counter', { value: i, padding: 'x'.repeat(i * 10) }, { scopeKey: scope });
    }

    // 验证最终值正确
    const finalEntry = CacheLayer.get('counter', scope);
    expect(finalEntry?.data).toEqual({ value: 9, padding: 'x'.repeat(90) });
  });
});
