import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('@/services/api', () => ({
  usageApi: {
    getUsage: vi.fn(),
  },
}));

vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      apiBase: 'http://localhost:3000',
      managementKey: 'test-key',
    })),
  },
}));

vi.mock('@/utils/usage', () => ({
  collectUsageDetails: vi.fn((usageData) => {
    if (!usageData || typeof usageData !== 'object') return [];
    const apis = (usageData as Record<string, unknown>).apis;
    if (!apis || typeof apis !== 'object') return [];
    // Return mock details
    return [
      {
        timestamp: new Date().toISOString(),
        source: 'k:test-key',
        auth_index: 0,
        tokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        failed: false,
      },
    ];
  }),
  computeKeyStatsFromDetails: vi.fn(() => ({
    bySource: { 'k:test-key': { success: 1, failure: 0 } },
    byAuthIndex: { '0': { success: 1, failure: 0 } },
  })),
}));

vi.mock('@/i18n', () => ({
  default: {
    t: vi.fn((key: string) => key),
  },
}));

import { useUsageStatsStore } from './useUsageStatsStore';
import { usageApi } from '@/services/api';

const hashScopeSegment = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const createScopeKey = (apiBase: string, managementKey: string) =>
  `${apiBase}::${hashScopeSegment(managementKey)}`;

describe('useUsageStatsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    useUsageStatsStore.getState().clearUsageStats();
    // Reset store state
    useUsageStatsStore.setState({
      usage: null,
      keyStats: { bySource: {}, byAuthIndex: {} },
      usageDetails: [],
      loading: false,
      error: null,
      lastRefreshedAt: null,
      scopeKey: '',
    });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with null usage and empty stats', () => {
      const state = useUsageStatsStore.getState();
      expect(state.usage).toBeNull();
      expect(state.keyStats).toEqual({ bySource: {}, byAuthIndex: {} });
      expect(state.usageDetails).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('loadUsageStats', () => {
    it('fetches usage stats successfully', async () => {
      const mockUsage = {
        apis: {
          api1: {
            models: {
              'gpt-4': {
                details: [
                  {
                    timestamp: '2025-01-01T00:00:00Z',
                    source: 'test',
                    auth_index: 0,
                    tokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
                    failed: false,
                  },
                ],
              },
            },
          },
        },
      };

      vi.mocked(usageApi.getUsage).mockResolvedValue({ usage: mockUsage } as any);

      await useUsageStatsStore.getState().loadUsageStats();

      expect(usageApi.getUsage).toHaveBeenCalledTimes(1);
      expect(useUsageStatsStore.getState().usage).toEqual(mockUsage);
      expect(useUsageStatsStore.getState().loading).toBe(false);
      expect(useUsageStatsStore.getState().error).toBeNull();
    });

    it('throws error on fetch failure', async () => {
      vi.mocked(usageApi.getUsage).mockRejectedValue(new Error('Network error'));

      await expect(useUsageStatsStore.getState().loadUsageStats()).rejects.toThrow('Network error');

      expect(useUsageStatsStore.getState().error).toBe('Network error');
      expect(useUsageStatsStore.getState().loading).toBe(false);
    });

    it('sets loading state during fetch', async () => {
      vi.mocked(usageApi.getUsage).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ usage: {} } as any), 100))
      );

      const fetchPromise = useUsageStatsStore.getState().loadUsageStats();

      expect(useUsageStatsStore.getState().loading).toBe(true);

      await fetchPromise;
      expect(useUsageStatsStore.getState().loading).toBe(false);
    });

    it('skips fetch when data is fresh (no force)', async () => {
      // Set recent refresh time
      useUsageStatsStore.setState({
        lastRefreshedAt: Date.now(),
        scopeKey: createScopeKey('http://localhost:3000', 'test-key'),
      });

      await useUsageStatsStore.getState().loadUsageStats({ force: false });

      // Should NOT call API when data is fresh
      expect(usageApi.getUsage).not.toHaveBeenCalled();
    });

    it('fetches when force is true', async () => {
      vi.mocked(usageApi.getUsage).mockResolvedValue({ usage: {} } as any);

      // Set recent refresh time but force refresh
      useUsageStatsStore.setState({
        lastRefreshedAt: Date.now(),
        scopeKey: createScopeKey('http://localhost:3000', 'test-key'),
      });

      await useUsageStatsStore.getState().loadUsageStats({ force: true });

      expect(usageApi.getUsage).toHaveBeenCalled();
    });

    it('updates scopeKey when connection changes', async () => {
      vi.mocked(usageApi.getUsage).mockResolvedValue({ usage: {} } as any);

      // Set different scope
      useUsageStatsStore.setState({
        scopeKey: createScopeKey('http://other:3000', 'other-key'),
      });

      const { useAuthStore } = await import('./useAuthStore');
      vi.mocked(useAuthStore.getState).mockReturnValue({
        apiBase: 'http://localhost:3000',
        managementKey: 'test-key',
      } as any);

      await useUsageStatsStore.getState().loadUsageStats();

      expect(useUsageStatsStore.getState().scopeKey).toBe(createScopeKey('http://localhost:3000', 'test-key'));
    });
  });

  describe('clearUsageStats', () => {
    it('clears all usage stats', () => {
      useUsageStatsStore.setState({
        usage: { apis: {} } as any,
        keyStats: { bySource: { 'k:test': { success: 1, failure: 0 } }, byAuthIndex: {} },
        usageDetails: [
          {
            timestamp: '2025-01-01',
            source: 'test',
            auth_index: 0,
            tokens: {
              input_tokens: 0,
              output_tokens: 0,
              reasoning_tokens: 0,
              cached_tokens: 0,
              total_tokens: 0,
            },
            failed: false,
          },
        ],
        loading: false,
        error: null,
        lastRefreshedAt: Date.now(),
        scopeKey: createScopeKey('http://localhost:3000', 'test-key'),
      });

      useUsageStatsStore.getState().clearUsageStats();

      const state = useUsageStatsStore.getState();
      expect(state.usage).toBeNull();
      expect(state.keyStats).toEqual({ bySource: {}, byAuthIndex: {} });
      expect(state.usageDetails).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastRefreshedAt).toBeNull();
      expect(state.scopeKey).toBe('');
    });
  });

  describe('state updates', () => {
    it('updates lastRefreshedAt after successful fetch', async () => {
      vi.mocked(usageApi.getUsage).mockResolvedValue({ usage: {} } as any);

      await useUsageStatsStore.getState().loadUsageStats();

      expect(useUsageStatsStore.getState().lastRefreshedAt).not.toBeNull();
    });

    it('preserves keyStats structure after fetch', async () => {
      vi.mocked(usageApi.getUsage).mockResolvedValue({ usage: {} } as any);

      await useUsageStatsStore.getState().loadUsageStats();

      const state = useUsageStatsStore.getState();
      expect(state.keyStats).toHaveProperty('bySource');
      expect(state.keyStats).toHaveProperty('byAuthIndex');
    });
  });
});
