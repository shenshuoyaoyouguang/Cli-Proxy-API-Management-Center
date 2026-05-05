import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/stores/useNotificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ showNotification: vi.fn() })),
  },
}));

import { pendingRequests, generateDedupKey, scheduleCleanup } from './useApiDedupe';

describe('useApiDedupe', () => {
  beforeEach(() => {
    pendingRequests.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    pendingRequests.clear();
  });

  describe('generateDedupKey', () => {
    it('generates consistent key for same inputs', () => {
      const key1 = generateDedupKey('/api/test', 'GET', { page: 1 });
      const key2 = generateDedupKey('/api/test', 'GET', { page: 1 });
      expect(key1).toBe(key2);
    });

    it('generates different keys for different methods', () => {
      const getKey = generateDedupKey('/api/test', 'GET');
      const postKey = generateDedupKey('/api/test', 'POST');
      expect(getKey).not.toBe(postKey);
    });

    it('generates different keys for different URLs', () => {
      const key1 = generateDedupKey('/api/test1', 'GET');
      const key2 = generateDedupKey('/api/test2', 'GET');
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different params', () => {
      const key1 = generateDedupKey('/api/test', 'GET', { page: 1 });
      const key2 = generateDedupKey('/api/test', 'GET', { page: 2 });
      expect(key1).not.toBe(key2);
    });

    it('handles undefined params', () => {
      const key = generateDedupKey('/api/test', 'GET');
      expect(key).toBe('GET:/api/test:');
    });
  });

  describe('pendingRequests dedup', () => {
    it('stores and retrieves pending requests', () => {
      const key = generateDedupKey('/api/test', 'GET');
      const abortController = new AbortController();
      pendingRequests.set(key, {
        promise: Promise.resolve('data'),
        abortController,
        timestamp: Date.now(),
      });

      expect(pendingRequests.has(key)).toBe(true);
      expect(pendingRequests.get(key)?.promise).toBeInstanceOf(Promise);
    });

    it('removes pending requests', () => {
      const key = generateDedupKey('/api/test', 'GET');
      const abortController = new AbortController();
      pendingRequests.set(key, {
        promise: Promise.resolve('data'),
        abortController,
        timestamp: Date.now(),
      });

      pendingRequests.delete(key);
      expect(pendingRequests.has(key)).toBe(false);
    });

    it('expires old requests on cleanup', () => {
      vi.useFakeTimers();

      const key = generateDedupKey('/api/test', 'GET');
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, 'abort');
      pendingRequests.set(key, {
        promise: Promise.resolve('data'),
        abortController,
        timestamp: Date.now() - 60000,
      });
      scheduleCleanup();

      vi.advanceTimersByTime(10000);

      expect(pendingRequests.has(key)).toBe(false);
      expect(abortSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('scheduleCleanup', () => {
    it('is exported as a function', () => {
      expect(typeof scheduleCleanup).toBe('function');
    });
  });
});
