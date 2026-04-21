import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheLayer } from './CacheLayer';

describe('CacheLayer', () => {
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
  });
});
