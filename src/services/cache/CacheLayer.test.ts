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
});
