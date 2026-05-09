import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveRouteState, getStoredRouteState, clearRouteState, type RouteState } from './useRouteRestore';

const ROUTE_STATE_KEY = 'cli-proxy-last-route-v1';

describe('useRouteRestore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('storage functions', () => {
    it('should save and retrieve route state', () => {
      saveRouteState('/usage', '?timeRange=7d', '#section');
      const stored = getStoredRouteState();

      expect(stored).not.toBeNull();
      expect(stored!.pathname).toBe('/usage');
      expect(stored!.search).toBe('?timeRange=7d');
      expect(stored!.hash).toBe('#section');
    });

    it('should save route state with defaults', () => {
      saveRouteState('/quota');
      const stored = getStoredRouteState();

      expect(stored).not.toBeNull();
      expect(stored!.pathname).toBe('/quota');
      expect(stored!.search).toBe('');
      expect(stored!.hash).toBe('');
    });

    it('should clear route state', () => {
      saveRouteState('/usage', '', '');
      clearRouteState();
      const stored = getStoredRouteState();

      expect(stored).toBeNull();
    });

    it('should return null for non-existent storage', () => {
      const stored = getStoredRouteState();
      expect(stored).toBeNull();
    });

    it('should return null for invalid JSON in storage', () => {
      localStorage.setItem(ROUTE_STATE_KEY, 'invalid-json');
      const stored = getStoredRouteState();
      expect(stored).toBeNull();
    });

    it('should return null for empty pathname', () => {
      localStorage.setItem(ROUTE_STATE_KEY, JSON.stringify({
        pathname: '',
        search: '',
        hash: '',
        timestamp: Date.now(),
      }));
      const stored = getStoredRouteState();
      expect(stored).toBeNull();
    });

    it('should return null for expired routes (30 min expiry)', () => {
      const expiredState = {
        pathname: '/usage',
        search: '',
        hash: '',
        timestamp: Date.now() - 31 * 60 * 1000, // 31 minutes ago
      };
      localStorage.setItem(ROUTE_STATE_KEY, JSON.stringify(expiredState));

      const stored = getStoredRouteState();
      expect(stored).toBeNull();
    });

    it('should accept routes within expiry window', () => {
      const validState = {
        pathname: '/usage',
        search: '',
        hash: '',
        timestamp: Date.now() - 29 * 60 * 1000, // 29 minutes ago
      };
      localStorage.setItem(ROUTE_STATE_KEY, JSON.stringify(validState));

      const stored = getStoredRouteState();
      expect(stored).not.toBeNull();
      expect(stored!.pathname).toBe('/usage');
    });

    it('should handle storage errors gracefully', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage error');
      });

      const stored = getStoredRouteState();
      expect(stored).toBeNull();
      getItemSpy.mockRestore();
    });

    it('should handle setItem errors gracefully', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(() => saveRouteState('/usage', '', '')).not.toThrow();
      setItemSpy.mockRestore();
    });

    it('should include timestamp when saving', () => {
      const beforeSave = Date.now();
      saveRouteState('/usage', '', '');
      const afterSave = Date.now();

      const stored = getStoredRouteState();
      expect(stored!.timestamp).toBeGreaterThanOrEqual(beforeSave);
      expect(stored!.timestamp).toBeLessThanOrEqual(afterSave);
    });

    it('should preserve pathname with special characters', () => {
      saveRouteState('/ai-providers/claude/model-settings', '?view=advanced', '#config-section');
      const stored = getStoredRouteState();

      expect(stored!.pathname).toBe('/ai-providers/claude/model-settings');
      expect(stored!.search).toBe('?view=advanced');
      expect(stored!.hash).toBe('#config-section');
    });

    it('should handle clearRouteState when storage is undefined', () => {
      const originalLocalStorage = global.localStorage;
      Object.defineProperty(global, 'localStorage', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      expect(() => clearRouteState()).not.toThrow();

      Object.defineProperty(global, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    });

    it('should handle saveRouteState when storage is undefined', () => {
      const originalLocalStorage = global.localStorage;
      Object.defineProperty(global, 'localStorage', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      expect(() => saveRouteState('/usage', '', '')).not.toThrow();

      Object.defineProperty(global, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    });

    it('should handle getStoredRouteState when storage is undefined', () => {
      const originalLocalStorage = global.localStorage;
      Object.defineProperty(global, 'localStorage', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const result = getStoredRouteState();
      expect(result).toBeNull();

      Object.defineProperty(global, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    });
  });
});