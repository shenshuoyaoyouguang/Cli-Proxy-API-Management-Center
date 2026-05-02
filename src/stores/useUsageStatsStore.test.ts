import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { KeyStats, UsageDetail } from '@/utils/usage';

type UsageSnapshot = Record<string, unknown>;
type UsageResponse = { usage: UsageSnapshot };
type BootstrapSnapshot = {
  scopeKey: string;
  usage: UsageSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  lastRefreshedAt: number | null;
  detailCount: number;
};

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

const createMockUsageDetail = (overrides: Partial<UsageDetail> = {}): UsageDetail => ({
  timestamp: new Date().toISOString(),
  source: 'test',
  auth_index: 0,
  tokens: {
    input_tokens: 100,
    output_tokens: 50,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 150,
  },
  failed: false,
  ...overrides,
});

const createMockKeyStats = (overrides: Partial<KeyStats> = {}): KeyStats => ({
  bySource: {},
  byAuthIndex: {},
  ...overrides,
});

const createMockUsageResponse = (usage: UsageSnapshot = {}): UsageResponse => ({
  usage,
});

const createMockAuthStorePartial = (
  apiBase = 'http://localhost:3000',
  managementKey = 'test-key'
) => ({
  apiBase,
  managementKey,
});

const createMockBootstrapSnapshot = (overrides: Partial<BootstrapSnapshot> = {}): BootstrapSnapshot => ({
  scopeKey: createScopeKey('http://localhost:3000', 'test-key'),
  usage: null,
  keyStats: createMockKeyStats(),
  usageDetails: [],
  lastRefreshedAt: null,
  detailCount: 0,
  ...overrides,
});

// Mock dependencies
vi.mock('@/services/api', () => ({
  usageApi: {
    getUsage: vi.fn(),
  },
}));

vi.mock('@/services/autoPersist', () => ({
  autoPersistService: {
    readBootstrapSnapshot: vi.fn(() => null),
    onUsageRefreshed: vi.fn(),
    clearRuntimeState: vi.fn(),
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
import { autoPersistService } from '@/services/autoPersist';

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

      vi.mocked(usageApi.getUsage).mockResolvedValue(createMockUsageResponse(mockUsage));

      await useUsageStatsStore.getState().loadUsageStats();

      expect(usageApi.getUsage).toHaveBeenCalledTimes(1);
      expect(autoPersistService.onUsageRefreshed).toHaveBeenCalledTimes(1);
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
        () => new Promise((resolve) => setTimeout(() => resolve(createMockUsageResponse()), 100))
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
      vi.mocked(usageApi.getUsage).mockResolvedValue(createMockUsageResponse());

      // Set recent refresh time but force refresh
      useUsageStatsStore.setState({
        lastRefreshedAt: Date.now(),
        scopeKey: createScopeKey('http://localhost:3000', 'test-key'),
      });

      await useUsageStatsStore.getState().loadUsageStats({ force: true });

      expect(usageApi.getUsage).toHaveBeenCalled();
    });

    it('updates scopeKey when connection changes', async () => {
      vi.mocked(usageApi.getUsage).mockResolvedValue(createMockUsageResponse());

      // Set different scope
      useUsageStatsStore.setState({
        scopeKey: createScopeKey('http://other:3000', 'other-key'),
      });

      const { useAuthStore } = await import('./useAuthStore');
      vi.mocked(useAuthStore.getState).mockReturnValue(
        createMockAuthStorePartial('http://localhost:3000', 'test-key') as ReturnType<typeof useAuthStore.getState>
      );

      await useUsageStatsStore.getState().loadUsageStats();

      expect(useUsageStatsStore.getState().scopeKey).toBe(createScopeKey('http://localhost:3000', 'test-key'));
    });

    it('accepts an empty fresh usage response instead of replaying bootstrap data', async () => {
      vi.mocked(autoPersistService.readBootstrapSnapshot).mockReturnValue(
        createMockBootstrapSnapshot({
          usage: {
            apis: {
              previous: {
                models: {
                  'gpt-4': { details: [{ timestamp: '2025-01-01T00:00:00Z' }] },
                },
              },
            },
          },
          keyStats: createMockKeyStats({
            bySource: { previous: { success: 1, failure: 0 } },
            byAuthIndex: { '0': { success: 1, failure: 0 } },
          }),
          usageDetails: [
            createMockUsageDetail({
              timestamp: '2025-01-01T00:00:00Z',
              source: 'previous',
              tokens: { input_tokens: 1, output_tokens: 1, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 2 },
            }),
          ],
          lastRefreshedAt: Date.now() - 60_000,
          detailCount: 1,
        })
      );
      vi.mocked(usageApi.getUsage).mockResolvedValue(createMockUsageResponse());

      await useUsageStatsStore.getState().loadUsageStats({ force: true });

      expect(useUsageStatsStore.getState().usage).toEqual({});
      expect(useUsageStatsStore.getState().usageDetails).toEqual([]);
    });

    it('prefers the snapshot with the higher total detail count during bootstrap', async () => {
      const scopeKey = createScopeKey('http://localhost:3000', 'test-key');
      const persistedDetails: UsageDetail[] = Array.from({ length: 5_100 }, (_, index) => ({
        timestamp: `2025-01-01T00:${String(index % 60).padStart(2, '0')}:00Z`,
        source: 'persisted',
        auth_index: 0,
        tokens: { input_tokens: 1, output_tokens: 1, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 2 },
        failed: false,
      }));
      const autoPersistDetails: UsageDetail[] = Array.from({ length: 5_000 }, (_, index) => ({
        timestamp: `2025-01-02T00:${String(index % 60).padStart(2, '0')}:00Z`,
        source: 'auto',
        auth_index: 0,
        tokens: { input_tokens: 1, output_tokens: 1, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 2 },
        failed: false,
      }));

      localStorage.setItem(
        `cli-proxy-usage-stats-cache-v1:${encodeURIComponent(scopeKey)}`,
        JSON.stringify({
          scopeKey,
          usage: { apis: { persisted: {} } },
          keyStats: {
            bySource: { persisted: { success: persistedDetails.length, failure: 0 } },
            byAuthIndex: { '0': { success: persistedDetails.length, failure: 0 } },
          },
          usageDetails: persistedDetails,
          detailCount: persistedDetails.length,
          lastRefreshedAt: Date.now(),
        })
      );

      vi.mocked(autoPersistService.readBootstrapSnapshot).mockReturnValue(
        createMockBootstrapSnapshot({
          scopeKey,
          usage: { apis: { auto: {} } },
          keyStats: createMockKeyStats({
            bySource: { auto: { success: 6_000, failure: 0 } },
            byAuthIndex: { '0': { success: 6_000, failure: 0 } },
          }),
          usageDetails: autoPersistDetails,
          lastRefreshedAt: Date.now(),
          detailCount: 6_000,
        })
      );

      await useUsageStatsStore.getState().loadUsageStats();

      expect(usageApi.getUsage).not.toHaveBeenCalled();
      expect(useUsageStatsStore.getState().usage).toEqual({ apis: { auto: {} } });
      expect(useUsageStatsStore.getState().usageDetails).toHaveLength(5_000);
    });

    it('does not treat lite auto-persist snapshots as fresh bootstrap data', async () => {
      vi.mocked(autoPersistService.readBootstrapSnapshot).mockReturnValue(
        createMockBootstrapSnapshot()
      );
      vi.mocked(usageApi.getUsage).mockResolvedValue(createMockUsageResponse({ apis: { live: {} } }));

      await useUsageStatsStore.getState().loadUsageStats();

      expect(usageApi.getUsage).toHaveBeenCalledTimes(1);
      expect(useUsageStatsStore.getState().usage).toEqual({ apis: { live: {} } });
    });
  });

  describe('clearUsageStats', () => {
    it('clears all usage stats', () => {
      useUsageStatsStore.setState({
        usage: { apis: {} },
        keyStats: { bySource: { 'k:test': { success: 1, failure: 0 } }, byAuthIndex: {} },
        usageDetails: [
          createMockUsageDetail({
            timestamp: '2025-01-01',
            source: 'test',
            tokens: {
              input_tokens: 0,
              output_tokens: 0,
              reasoning_tokens: 0,
              cached_tokens: 0,
              total_tokens: 0,
            },
          }),
        ],
        loading: false,
        error: null,
        lastRefreshedAt: Date.now(),
        scopeKey: createScopeKey('http://localhost:3000', 'test-key'),
      });

      useUsageStatsStore.getState().clearUsageStats();

      const state = useUsageStatsStore.getState();
      expect(autoPersistService.clearRuntimeState).toHaveBeenCalledWith(
        createScopeKey('http://localhost:3000', 'test-key'),
        { removePersisted: true }
      );
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
      vi.mocked(usageApi.getUsage).mockResolvedValue(createMockUsageResponse());

      await useUsageStatsStore.getState().loadUsageStats();

      expect(useUsageStatsStore.getState().lastRefreshedAt).not.toBeNull();
    });

    it('preserves keyStats structure after fetch', async () => {
      vi.mocked(usageApi.getUsage).mockResolvedValue(createMockUsageResponse());

      await useUsageStatsStore.getState().loadUsageStats();

      const state = useUsageStatsStore.getState();
      expect(state.keyStats).toHaveProperty('bySource');
      expect(state.keyStats).toHaveProperty('byAuthIndex');
    });
  });
});
