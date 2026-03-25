import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '@/types';

// Mock dependencies
vi.mock('@/services/api/config', () => ({
  configApi: {
    getConfig: vi.fn(),
  },
}));

vi.mock('@/utils/constants', () => ({
  CACHE_EXPIRY_MS: 30 * 1000,
}));

import { useConfigStore } from './useConfigStore';
import { configApi } from '@/services/api/config';

describe('useConfigStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useConfigStore.setState({
      config: null,
      cache: new Map(),
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with null config and empty cache', () => {
      const state = useConfigStore.getState();
      expect(state.config).toBeNull();
      expect(state.cache).toEqual(new Map());
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('fetchConfig', () => {
    it('fetches full config successfully', async () => {
      const mockConfig = {
        debug: false,
        proxyUrl: 'http://localhost:8318',
        requestRetry: 3,
        raw: { debug: false },
      };

      vi.mocked(configApi.getConfig).mockResolvedValue(mockConfig as any);

      const result = await useConfigStore.getState().fetchConfig();

      expect(configApi.getConfig).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockConfig);
      expect(useConfigStore.getState().config).toEqual(mockConfig);
      expect(useConfigStore.getState().loading).toBe(false);
    });

    it('fetches specific section from config', async () => {
      const mockConfig = {
        debug: true,
        proxyUrl: 'http://localhost:8318',
        requestRetry: 3,
        raw: { debug: true },
      };

      vi.mocked(configApi.getConfig).mockResolvedValue(mockConfig as any);

      const result = await useConfigStore.getState().fetchConfig('debug');

      expect(result).toBe(true);
    });

    it('throws error on fetch failure', async () => {
      vi.mocked(configApi.getConfig).mockRejectedValue(new Error('Network error'));

      await expect(useConfigStore.getState().fetchConfig()).rejects.toThrow('Network error');

      expect(useConfigStore.getState().error).toBe('Network error');
      expect(useConfigStore.getState().loading).toBe(false);
    });

    it('sets loading state during fetch', async () => {
      let fetchPromise: Promise<Config>;
      vi.mocked(configApi.getConfig).mockImplementation(() => {
        fetchPromise = new Promise((resolve) => {
          setTimeout(() => resolve({ debug: false, raw: {} } as Config), 100);
        });
        return fetchPromise;
      });

      const fetchPromiseResult = useConfigStore.getState().fetchConfig();

      expect(useConfigStore.getState().loading).toBe(true);

      await fetchPromiseResult;
      expect(useConfigStore.getState().loading).toBe(false);
    });
  });

  describe('updateConfigValue', () => {
    it('updates boolean config value (debug)', () => {
      useConfigStore.setState({
        config: { debug: false, raw: { debug: false } } as any,
      });

      useConfigStore.getState().updateConfigValue('debug', true);

      expect(useConfigStore.getState().config?.debug).toBe(true);
    });

    it('updates string config value (proxy-url)', () => {
      useConfigStore.setState({
        config: { proxyUrl: '', raw: { 'proxy-url': '' } } as any,
      });

      useConfigStore.getState().updateConfigValue('proxy-url', 'http://proxy:8080');

      expect(useConfigStore.getState().config?.proxyUrl).toBe('http://proxy:8080');
    });

    it('updates number config value (request-retry)', () => {
      useConfigStore.setState({
        config: { requestRetry: 3, raw: { 'request-retry': 3 } } as any,
      });

      useConfigStore.getState().updateConfigValue('request-retry', 5);

      expect(useConfigStore.getState().config?.requestRetry).toBe(5);
    });

    it('updates raw config section', () => {
      useConfigStore.setState({
        config: { raw: {} } as any,
      });

      useConfigStore.getState().updateConfigValue('custom-section' as any, { foo: 'bar' });

      const config = useConfigStore.getState().config;
      expect(config?.raw).toHaveProperty('custom-section', { foo: 'bar' });
    });

    it('clears cache after updating value', () => {
      const cache = new Map();
      cache.set('debug', { data: false, timestamp: Date.now() });
      useConfigStore.setState({
        config: { debug: false, raw: { debug: false } } as any,
        cache,
      });

      useConfigStore.getState().updateConfigValue('debug', true);

      // Cache should be cleared for this section
      expect(useConfigStore.getState().cache.has('debug')).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('clears specific section cache', () => {
      const cache = new Map();
      cache.set('debug', { data: false, timestamp: Date.now() });
      cache.set('__full__', { data: {}, timestamp: Date.now() });
      useConfigStore.setState({ cache });

      useConfigStore.getState().clearCache('debug');

      expect(useConfigStore.getState().cache.has('debug')).toBe(false);
      expect(useConfigStore.getState().cache.has('__full__')).toBe(false);
    });

    it('clears all cache when no section specified', () => {
      const cache = new Map();
      cache.set('debug', { data: false, timestamp: Date.now() });
      cache.set('proxy-url', { data: '', timestamp: Date.now() });
      cache.set('__full__', { data: {}, timestamp: Date.now() });
      useConfigStore.setState({ cache });

      useConfigStore.getState().clearCache();

      expect(useConfigStore.getState().cache.size).toBe(0);
      expect(useConfigStore.getState().config).toBeNull();
      expect(useConfigStore.getState().error).toBeNull();
    });
  });

  describe('isCacheValid', () => {
    it('returns false when cache is empty', () => {
      const result = useConfigStore.getState().isCacheValid();
      expect(result).toBe(false);
    });

    it('returns true when cache is fresh', () => {
      const cache = new Map();
      cache.set('__full__', { data: {}, timestamp: Date.now() });
      useConfigStore.setState({ cache });

      const result = useConfigStore.getState().isCacheValid();
      expect(result).toBe(true);
    });

    it('returns false when cache is expired', () => {
      const cache = new Map();
      cache.set('__full__', { data: {}, timestamp: Date.now() - 60 * 1000 }); // 60 seconds ago
      useConfigStore.setState({ cache });

      const result = useConfigStore.getState().isCacheValid();
      expect(result).toBe(false);
    });

    it('checks specific section cache validity', () => {
      const cache = new Map();
      cache.set('debug', { data: false, timestamp: Date.now() });
      useConfigStore.setState({ cache });

      const result = useConfigStore.getState().isCacheValid('debug');
      expect(result).toBe(true);
    });
  });
});
