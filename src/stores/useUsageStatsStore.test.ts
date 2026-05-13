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
  auth_index: '0',
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
    getUsageEvents: vi.fn(),
    getUsageQueue: vi.fn(),
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
  createAggregateOnlyUsageSnapshot: vi.fn((usageData) => usageData),
  collectUsageDetails: vi.fn((usageData) => {
    if (!usageData || typeof usageData !== 'object') return [];
    const apis = (usageData as Record<string, unknown>).apis;
    if (!apis || typeof apis !== 'object') return [];
    return [
      {
        timestamp: new Date().toISOString(),
        source: 'k:test-key',
        auth_index: '0',
        tokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        failed: false,
      },
    ];
  }),
  collectUsageDetailsFromEvents: vi.fn((events) => {
    if (!Array.isArray(events) || events.length === 0) return [];
    return events as UsageDetail[];
  }),
  computeKeyStatsFromDetails: vi.fn(() => ({
    bySource: { 'k:test-key': { success: 1, failure: 0 } },
    byAuthIndex: { '0': { success: 1, failure: 0 } },
  })),
  mergeKeyStatsIncremental: vi.fn((current: { bySource: Record<string, { success: number; failure: number }>; byAuthIndex: Record<string, { success: number; failure: number }> }, newDetails: UsageDetail[]) => {
    const bySource: Record<string, { success: number; failure: number }> = {};
    const byAuthIndex: Record<string, { success: number; failure: number }> = {};
    Object.entries(current.bySource).forEach(([key, bucket]) => {
      bySource[key] = { ...bucket };
    });
    Object.entries(current.byAuthIndex).forEach(([key, bucket]) => {
      byAuthIndex[key] = { ...bucket };
    });
    newDetails.forEach((detail) => {
      const source = detail.source;
      const authIndexKey = detail.auth_index ?? null;
      const isFailed = detail.failed === true;
      if (source) {
        if (!bySource[source]) {
          bySource[source] = { success: 0, failure: 0 };
        }
        bySource[source] = {
          success: bySource[source].success + (isFailed ? 0 : 1),
          failure: bySource[source].failure + (isFailed ? 1 : 0),
        };
      }
      if (authIndexKey !== null) {
        if (!byAuthIndex[authIndexKey]) {
          byAuthIndex[authIndexKey] = { success: 0, failure: 0 };
        }
        byAuthIndex[authIndexKey] = {
          success: byAuthIndex[authIndexKey].success + (isFailed ? 0 : 1),
          failure: byAuthIndex[authIndexKey].failure + (isFailed ? 1 : 0),
        };
      }
    });
    return { bySource, byAuthIndex };
  }),
  subtractKeyStatsForDetails: vi.fn((current: { bySource: Record<string, { success: number; failure: number }>; byAuthIndex: Record<string, { success: number; failure: number }> }) => {
    return { ...current };
  }),
  getDetailTimestampMs: vi.fn((detail: UsageDetail) => detail.__timestampMs ?? Date.parse(detail.timestamp)),
  normalizeAuthIndex: vi.fn((value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
  }),
  normalizeUsageSourceId: vi.fn((value: unknown) => (typeof value === 'string' ? value : '')),
}));

vi.mock('@/i18n', () => ({
  default: {
    t: vi.fn((key: string) => key),
  },
}));

import { useUsageStatsStore } from './useUsageStatsStore';
import { usageApi } from '@/services/api';
import { autoPersistService } from '@/services/autoPersist';
import { collectUsageDetails, mergeKeyStatsIncremental } from '@/utils/usage';
import { usageSSEService } from '@/services/sse';

describe('useUsageStatsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(autoPersistService.readBootstrapSnapshot).mockReturnValue(null);
    vi.mocked(usageApi.getUsageEvents).mockResolvedValue([]);
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
      lastSeq: null,
    });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
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
                    auth_index: '0',
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

    it('falls back to usage stream when /usage returns 404 and normalizes the current backend snapshot', async () => {
      const endpoint = 'POST /v1/chat/completions';
      const notFound = Object.assign(new Error('Request failed with status code 404'), {
        status: 404,
      });
      const fullSnapshotPayload = {
        seq: 21,
        timestamp: '2026-01-01T00:05:00.000Z',
        usage: {
          apis: {
            [endpoint]: {
              request_count: 3,
              success_count: 2,
              failure_count: 1,
              total_tokens: {
                input_tokens: 180,
                output_tokens: 70,
                reasoning_tokens: 0,
                cached_tokens: 0,
                total_tokens: 250,
              },
            },
          },
          models: {
            'gpt-4.1': {
              endpoint,
              request_count: 3,
              success_count: 2,
              failure_count: 1,
              token_delta: {
                input_tokens: 180,
                output_tokens: 70,
                reasoning_tokens: 0,
                cached_tokens: 0,
                total_tokens: 250,
              },
            },
          },
        },
        usageDetails: [
          {
            timestamp: '2026-01-01T00:00:00.000Z',
            source: 'k:test-key',
            auth_index: '0',
            endpoint,
            model: 'gpt-4.1',
            tokens: {
              input_tokens: 100,
              output_tokens: 50,
              reasoning_tokens: 0,
              cached_tokens: 0,
              total_tokens: 150,
            },
            failed: false,
          },
        ],
      };

      vi.mocked(usageApi.getUsage).mockRejectedValue(notFound);
      vi.mocked(usageApi.getUsageEvents).mockRejectedValue(notFound);
      vi.mocked(usageApi.getUsageQueue).mockResolvedValue([]);
      const awaitFullSnapshotSpy = vi.spyOn(usageSSEService, 'awaitFullSnapshot');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            `event: usage:full\ndata: ${JSON.stringify(fullSnapshotPayload)}\n\n`,
            {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            }
          )
        )
      );

      await useUsageStatsStore.getState().loadUsageStats({ force: true });

      expect(awaitFullSnapshotSpy).toHaveBeenCalledWith(
        'http://localhost:3000',
        'test-key',
        expect.objectContaining({
          timeoutMs: 8000,
        })
      );
      expect(usageApi.getUsageQueue).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/v0/management/usage/stream',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/event-stream',
            Authorization: 'Bearer test-key',
          }),
        })
      );
      expect(useUsageStatsStore.getState().usage).toEqual(
        expect.objectContaining({
          total_requests: 3,
          success_count: 2,
          failure_count: 1,
          total_tokens: 250,
          apis: {
            [endpoint]: expect.objectContaining({
              total_requests: 3,
              success_count: 2,
              failure_count: 1,
              total_tokens: 250,
              models: {
                'gpt-4.1': expect.objectContaining({
                  total_requests: 3,
                  success_count: 2,
                  failure_count: 1,
                  total_tokens: 250,
                  details: [
                    expect.objectContaining({
                      timestamp: '2026-01-01T00:00:00.000Z',
                      source: 'k:test-key',
                      auth_index: '0',
                    }),
                  ],
                }),
              },
            }),
          },
        })
      );
      expect(useUsageStatsStore.getState().usageDetails).toEqual([
        expect.objectContaining({
          source: 'k:test-key',
          auth_index: '0',
          __modelName: 'gpt-4.1',
        }),
      ]);
      expect(useUsageStatsStore.getState().lastSeq).toBe(21);
    });

    it('throws error on fetch failure', async () => {
      vi.mocked(usageApi.getUsage).mockRejectedValue(new Error('Network error'));

      await expect(useUsageStatsStore.getState().loadUsageStats()).rejects.toThrow('Network error');

      expect(useUsageStatsStore.getState().error).toBe('Network error');
      expect(useUsageStatsStore.getState().loading).toBe(false);
    });

    it('reuses the current store snapshot instead of replaying a stale full snapshot when SSE is already connected', async () => {
      const notFound = Object.assign(new Error('Request failed with status code 404'), {
        status: 404,
      });
      const currentUsage = {
        total_requests: 4,
        success_count: 3,
        failure_count: 1,
        total_tokens: 320,
        apis: {
          'POST /v1/chat/completions': {
            total_requests: 4,
            success_count: 3,
            failure_count: 1,
            total_tokens: 320,
            models: {},
          },
        },
      };
      const currentUsageDetails = [
        createMockUsageDetail({
          source: 'live-source',
          auth_index: '2',
          __modelName: 'gpt-4.1',
          __timestampMs: Date.parse('2026-01-01T00:05:00.000Z'),
        }),
      ];

      useUsageStatsStore.setState({
        usage: currentUsage,
        keyStats: createMockKeyStats(),
        usageDetails: currentUsageDetails,
        loading: false,
        error: null,
        lastRefreshedAt: Date.parse('2026-01-01T00:05:00.000Z'),
        scopeKey: createScopeKey('http://localhost:3000', 'test-key'),
        lastSeq: 42,
      });

      vi.mocked(usageApi.getUsage).mockRejectedValue(notFound);
      vi.mocked(usageApi.getUsageEvents).mockRejectedValue(notFound);
      const awaitFullSnapshotSpy = vi.spyOn(usageSSEService, 'awaitFullSnapshot');
      const getConnectionStatusSpy = vi
        .spyOn(usageSSEService, 'getConnectionStatus')
        .mockReturnValue('connected');

      await useUsageStatsStore.getState().loadUsageStats({ force: true });

      expect(awaitFullSnapshotSpy).not.toHaveBeenCalled();
      expect(getConnectionStatusSpy).toHaveBeenCalled();
      expect(useUsageStatsStore.getState().usage).toEqual(currentUsage);
      expect(useUsageStatsStore.getState().usageDetails).toEqual(currentUsageDetails);
      expect(useUsageStatsStore.getState().lastSeq).toBe(42);
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

    it('clears loading state when the request is canceled without surfacing an error', async () => {
      const aborted = Object.assign(new Error('Request aborted'), { name: 'AbortError' });
      vi.mocked(usageApi.getUsage).mockRejectedValue(aborted);

      await expect(useUsageStatsStore.getState().loadUsageStats()).resolves.toBeUndefined();

      expect(useUsageStatsStore.getState().loading).toBe(false);
      expect(useUsageStatsStore.getState().error).toBeNull();
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
        auth_index: '0',
        tokens: { input_tokens: 1, output_tokens: 1, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 2 },
        failed: false,
      }));
      const autoPersistDetails: UsageDetail[] = Array.from({ length: 5_000 }, (_, index) => ({
        timestamp: `2025-01-02T00:${String(index % 60).padStart(2, '0')}:00Z`,
        source: 'auto',
        auth_index: '0',
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

    it('rebuilds cached usageDetails from raw usage snapshots to heal stale zero-token caches', async () => {
      const scopeKey = createScopeKey('http://localhost:3000', 'test-key');

      localStorage.setItem(
        `cli-proxy-usage-stats-cache-v1:${encodeURIComponent(scopeKey)}`,
        JSON.stringify({
          scopeKey,
          usage: {
            apis: {
              persisted: {
                models: {
                  minimax: {
                    details: [{ timestamp: '2026-01-01T00:00:00.000Z' }],
                  },
                },
              },
            },
          },
          keyStats: createMockKeyStats(),
          usageDetails: [],
          lastRefreshedAt: Date.now(),
        })
      );

      await useUsageStatsStore.getState().loadUsageStats();

      expect(usageApi.getUsage).not.toHaveBeenCalled();
      expect(useUsageStatsStore.getState().usageDetails).toHaveLength(1);
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

    it('caps persisted usageDetails while preserving the full detailCount for bootstrap decisions', async () => {
      const largeUsageDetails: UsageDetail[] = Array.from({ length: 5_500 }, (_, index) => ({
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, index % 60, 0)).toISOString(),
        source: `source-${index}`,
        auth_index: String(index),
        tokens: {
          input_tokens: 1,
          output_tokens: 1,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 2,
        },
        failed: false,
        __timestampMs: Date.UTC(2026, 0, 1, 0, index % 60, 0) + index,
      }));

      vi.mocked(collectUsageDetails).mockReturnValueOnce(largeUsageDetails);
      vi.mocked(usageApi.getUsage).mockResolvedValue(createMockUsageResponse({ apis: { live: {} } }));

      await useUsageStatsStore.getState().loadUsageStats({ force: true });

      const scopeKey = createScopeKey('http://localhost:3000', 'test-key');
      const raw = localStorage.getItem(
        `cli-proxy-usage-stats-cache-v1:${encodeURIComponent(scopeKey)}`
      );
      const persisted = raw ? (JSON.parse(raw) as BootstrapSnapshot) : null;

      expect(persisted).not.toBeNull();
      expect(persisted?.detailCount).toBe(5_500);
      expect(persisted?.usageDetails.length).toBe(5_000);
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

  describe('SSE state updates', () => {
    it('requests full correction and starts a forced refresh when delta arrives without a base snapshot', () => {
      const requestFullCorrectionSpy = vi
        .spyOn(usageSSEService, 'requestFullCorrection')
        .mockImplementation(() => {});

      vi.mocked(usageApi.getUsage).mockImplementation(() => new Promise(() => {}));
      vi.mocked(usageApi.getUsageEvents).mockImplementation(() => new Promise(() => {}));

      useUsageStatsStore.getState().applyDelta({
        seq: 1,
        timestamp: Date.parse('2026-01-01T00:01:00.000Z'),
        requestCount: 1,
        successCount: 1,
        failureCount: 0,
        tokenDelta: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        details: [],
      });

      expect(requestFullCorrectionSpy).toHaveBeenCalledTimes(1);
      expect(vi.mocked(usageApi.getUsage)).toHaveBeenCalledTimes(1);
      expect(useUsageStatsStore.getState().loading).toBe(true);
    });

    it('requests full correction and starts a forced refresh when delta sequence gaps are detected', () => {
      const requestFullCorrectionSpy = vi
        .spyOn(usageSSEService, 'requestFullCorrection')
        .mockImplementation(() => {});

      vi.mocked(usageApi.getUsage).mockImplementation(() => new Promise(() => {}));
      vi.mocked(usageApi.getUsageEvents).mockImplementation(() => new Promise(() => {}));

      useUsageStatsStore.setState({
        usage: { apis: {} },
        keyStats: createMockKeyStats(),
        usageDetails: [],
        loading: false,
        error: null,
        lastRefreshedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        scopeKey: createScopeKey('http://localhost:3000', 'test-key'),
        lastSeq: 10,
      });

      useUsageStatsStore.getState().applyDelta({
        seq: 12,
        timestamp: Date.parse('2026-01-01T00:01:00.000Z'),
        requestCount: 1,
        successCount: 1,
        failureCount: 0,
        tokenDelta: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        details: [],
      });

      expect(requestFullCorrectionSpy).toHaveBeenCalledTimes(1);
      expect(vi.mocked(usageApi.getUsage)).toHaveBeenCalledTimes(1);
      expect(useUsageStatsStore.getState().loading).toBe(true);
    });

    it('appends delta details without mutating usage.apis and persists the merged snapshot', () => {
      const receivedAt = Date.parse('2026-01-01T00:01:30.000Z');
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(receivedAt);
      const scopeKey = createScopeKey('http://localhost:3000', 'test-key');
      const endpoint = 'POST /v1/chat/completions';
      const existingDetail = createMockUsageDetail({
        timestamp: '2026-01-01T00:00:00.000Z',
        source: 'baseline-source',
        auth_index: '0',
        __modelName: 'gpt-4.1',
        __timestampMs: Date.parse('2026-01-01T00:00:00.000Z'),
      });
      const usage = {
        total_requests: 1,
        success_count: 1,
        failure_count: 0,
        total_tokens: 150,
        prompt_tokens: 100,
        completion_tokens: 50,
        apis: {
          [endpoint]: {
            models: {
              'gpt-4.1': {
                total_requests: 1,
                success_count: 1,
                failure_count: 0,
                total_tokens: 150,
                details: [
                  {
                    timestamp: '2026-01-01T00:00:00.000Z',
                    source: 'baseline-source',
                    auth_index: '0',
                    tokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
                    failed: false,
                  },
                ],
              },
            },
          },
        },
      };
      const endpointBucket = (usage.apis as Record<string, unknown>)[endpoint];

      useUsageStatsStore.setState({
        usage,
        keyStats: createMockKeyStats(),
        usageDetails: [existingDetail],
        loading: false,
        error: null,
        lastRefreshedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        scopeKey,
        lastSeq: 10,
      });

      useUsageStatsStore.getState().applyDelta({
        seq: 11,
        timestamp: Date.parse('2026-01-01T00:01:00.000Z'),
        requestCount: 1,
        successCount: 0,
        failureCount: 1,
        tokenDelta: {
          promptTokens: 30,
          completionTokens: 20,
          totalTokens: 50,
        },
        details: [
          {
            model: 'gpt-4.1',
            source: 'live-source',
            timestamp: Date.parse('2026-01-01T00:01:00.000Z'),
            success: false,
            tokens: {
              prompt: 30,
              completion: 20,
              total: 50,
            },
          },
        ],
      });

      const state = useUsageStatsStore.getState();
      const persistedRaw = localStorage.getItem(
        `cli-proxy-usage-stats-cache-v1:${encodeURIComponent(scopeKey)}`
      );
      const persisted = persistedRaw ? (JSON.parse(persistedRaw) as BootstrapSnapshot) : null;

      expect(state.usageDetails).toHaveLength(2);
      expect(state.usageDetails[1]).toMatchObject({
        source: 'live-source',
        auth_index: null,
        failed: true,
        __modelName: 'gpt-4.1',
      });
      expect((state.usage?.apis as Record<string, unknown>)[endpoint]).toBe(endpointBucket);
      expect((state.usage?.apis as Record<string, unknown>)['live-source']).toBeUndefined();
      expect(vi.mocked(collectUsageDetails)).not.toHaveBeenCalled();
      expect(vi.mocked(mergeKeyStatsIncremental)).toHaveBeenCalled();
      expect(autoPersistService.onUsageRefreshed).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeKey,
          usage: state.usage,
          usageDetails: state.usageDetails,
          lastRefreshedAt: receivedAt,
        })
      );
      expect(persisted).not.toBeNull();
      expect(persisted?.detailCount).toBe(2);
      expect(persisted?.usageDetails).toHaveLength(2);

      nowSpy.mockRestore();
    });

    it('merges modelBreakdown into usage.apis without mutating the previous snapshot', () => {
      const scopeKey = createScopeKey('http://localhost:3000', 'test-key');
      const endpoint = 'POST /v1/chat/completions';
      const usage = {
        total_requests: 1,
        success_count: 1,
        failure_count: 0,
        total_tokens: 150,
        prompt_tokens: 100,
        completion_tokens: 50,
        apis: {
          [endpoint]: {
            total_requests: 1,
            success_count: 1,
            failure_count: 0,
            total_tokens: 150,
            models: {
              'gpt-4.1': {
                total_requests: 1,
                success_count: 1,
                failure_count: 0,
                total_tokens: 150,
                details: [],
              },
            },
          },
        },
      };
      const originalApis = usage.apis;
      const originalEndpointBucket = (usage.apis as Record<string, unknown>)[endpoint];

      useUsageStatsStore.setState({
        usage,
        keyStats: createMockKeyStats(),
        usageDetails: [],
        loading: false,
        error: null,
        lastRefreshedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        scopeKey,
        lastSeq: 10,
      });

      useUsageStatsStore.getState().applyDelta({
        seq: 11,
        timestamp: Date.parse('2026-01-01T00:01:00.000Z'),
        requestCount: 1,
        successCount: 1,
        failureCount: 0,
        tokenDelta: {
          promptTokens: 30,
          completionTokens: 20,
          totalTokens: 50,
        },
        modelBreakdown: [
          {
            endpoint,
            model: 'gpt-4o-mini',
            requestCount: 1,
            successCount: 1,
            failureCount: 0,
            tokenDelta: {
              promptTokens: 30,
              completionTokens: 20,
              totalTokens: 50,
            },
          },
        ],
        details: [
          {
            model: 'gpt-4o-mini',
            source: 'live-source',
            timestamp: Date.parse('2026-01-01T00:01:00.000Z'),
            success: true,
            tokens: {
              prompt: 30,
              completion: 20,
              total: 50,
            },
          },
        ],
      });

      const state = useUsageStatsStore.getState();
      const nextApis = state.usage?.apis as Record<string, unknown>;
      const nextEndpointBucket = nextApis[endpoint] as Record<string, unknown>;
      const nextModels = nextEndpointBucket.models as Record<string, unknown>;

      expect(nextApis).not.toBe(originalApis);
      expect(nextEndpointBucket).not.toBe(originalEndpointBucket);
      expect((originalEndpointBucket as { models: Record<string, unknown> }).models).not.toHaveProperty('gpt-4o-mini');
      expect(nextModels['gpt-4o-mini']).toMatchObject({
        total_requests: 1,
        success_count: 1,
        failure_count: 0,
        total_tokens: 50,
      });
      expect(nextEndpointBucket).toMatchObject({
        total_requests: 2,
        success_count: 2,
        failure_count: 0,
        total_tokens: 200,
      });
    });

    it('prefers usageDetails from a full snapshot payload when provided', () => {
      const scopeKey = createScopeKey('http://localhost:3000', 'test-key');
      const snapshotDetails = [
        createMockUsageDetail({
          timestamp: '2026-01-01T00:05:00.000Z',
          source: 'snapshot-source',
          auth_index: '5',
          __modelName: 'claude-3.7-sonnet',
          __timestampMs: Date.parse('2026-01-01T00:05:00.000Z'),
        }),
      ];

      useUsageStatsStore.setState({
        scopeKey,
        lastSeq: 20,
      });

      useUsageStatsStore.getState().applyFullSnapshot({
        seq: 21,
        timestamp: Date.parse('2026-01-01T00:05:00.000Z'),
        usage: { apis: { live: {} } },
        usageDetails: snapshotDetails,
      });

      expect(vi.mocked(collectUsageDetails)).not.toHaveBeenCalled();
      expect(useUsageStatsStore.getState().usageDetails).toHaveLength(1);
      expect(useUsageStatsStore.getState().usageDetails[0]).toMatchObject(snapshotDetails[0]);
      expect(useUsageStatsStore.getState().lastSeq).toBe(21);
    });

    it('backfills __modelName from raw usage:full details when the snapshot payload includes model', () => {
      const scopeKey = createScopeKey('http://localhost:3000', 'test-key');

      useUsageStatsStore.setState({
        scopeKey,
        lastSeq: 20,
      });

      useUsageStatsStore.getState().applyFullSnapshot({
        seq: 21,
        timestamp: Date.parse('2026-01-01T00:05:00.000Z'),
        usage: { apis: { live: {} } },
        usageDetails: [
          {
            timestamp: '2026-01-01T00:05:00.000Z',
            source: 'snapshot-source',
            auth_index: '5',
            tokens: {
              input_tokens: 100,
              output_tokens: 50,
              reasoning_tokens: 0,
              cached_tokens: 0,
              total_tokens: 150,
            },
            failed: false,
            model: 'claude-3.7-sonnet',
          } as UsageDetail & { model: string },
        ],
      });

      expect(useUsageStatsStore.getState().usageDetails).toEqual([
        expect.objectContaining({
          __modelName: 'claude-3.7-sonnet',
          __timestampMs: Date.parse('2026-01-01T00:05:00.000Z'),
        }),
      ]);
    });

    it('normalizes current backend usage:full snapshots before writing them into store state', () => {
      const endpoint = 'POST /v1/chat/completions';
      const scopeKey = createScopeKey('http://localhost:3000', 'test-key');

      useUsageStatsStore.setState({
        scopeKey,
        lastSeq: 20,
      });

      useUsageStatsStore.getState().applyFullSnapshot({
        seq: 21,
        timestamp: Date.parse('2026-01-01T00:05:00.000Z'),
        usage: {
          apis: {
            [endpoint]: {
              request_count: 2,
              success_count: 1,
              failure_count: 1,
              total_tokens: {
                input_tokens: 120,
                output_tokens: 30,
                reasoning_tokens: 0,
                cached_tokens: 0,
                total_tokens: 150,
              },
            },
          },
          models: {
            'gpt-4.1': {
              endpoint,
              request_count: 2,
              success_count: 1,
              failure_count: 1,
              token_delta: {
                input_tokens: 120,
                output_tokens: 30,
                reasoning_tokens: 0,
                cached_tokens: 0,
                total_tokens: 150,
              },
            },
          },
        },
        usageDetails: [
          {
            timestamp: '2026-01-01T00:05:00.000Z',
            source: 'snapshot-source',
            auth_index: '5',
            endpoint,
            model: 'gpt-4.1',
            tokens: {
              input_tokens: 100,
              output_tokens: 50,
              reasoning_tokens: 0,
              cached_tokens: 0,
              total_tokens: 150,
            },
            failed: false,
          } as UsageDetail & { endpoint: string; model: string },
        ],
      });

      expect(useUsageStatsStore.getState().usage).toEqual(
        expect.objectContaining({
          total_requests: 2,
          success_count: 1,
          failure_count: 1,
          total_tokens: 150,
          apis: {
            [endpoint]: expect.objectContaining({
              total_requests: 2,
              success_count: 1,
              failure_count: 1,
              total_tokens: 150,
              models: {
                'gpt-4.1': expect.objectContaining({
                  total_requests: 2,
                  total_tokens: 150,
                }),
              },
            }),
          },
        })
      );
      expect(useUsageStatsStore.getState().lastSeq).toBe(21);
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
