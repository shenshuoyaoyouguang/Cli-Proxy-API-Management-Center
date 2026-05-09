import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScopeKey } from '@/utils/helpers';
import type { ModelInfo } from '@/utils/models';

const mocks = vi.hoisted(() => {
  const persistedModels: ModelInfo[] = [{ name: 'gpt-4.1' }];
  const authState = {
    apiBase: 'http://server:3000',
    managementKey: 'management-key',
  };

  return {
    persistedModels,
    authState,
    cacheGetSpy: vi.fn(),
    cacheSetSpy: vi.fn(),
    fetchModelsSpy: vi.fn(),
  };
});

vi.mock('@/services/api/models', () => ({
  modelsApi: {
    fetchModels: mocks.fetchModelsSpy,
  },
}));

vi.mock('@/services/cache', () => ({
  CacheLayer: {
    get: mocks.cacheGetSpy,
    set: mocks.cacheSetSpy,
  },
}));

vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: () => mocks.authState,
  },
}));

import { useModelsStore } from './useModelsStore';

describe('useModelsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.apiBase = 'http://server:3000';
    mocks.authState.managementKey = 'management-key';
    mocks.cacheGetSpy.mockReturnValue(null);
    mocks.fetchModelsSpy.mockReset();
    mocks.cacheSetSpy.mockReset();
    useModelsStore.getState().clearCache();
    useModelsStore.setState({
      models: [],
      loading: false,
      error: null,
      cache: new Map(),
    });
  });

  it('hydrates the in-memory cache when restoring models from persistence', () => {
    mocks.cacheGetSpy.mockReturnValue({
      data: mocks.persistedModels,
      timestamp: Date.now(),
      scopeKey: buildScopeKey(mocks.authState.apiBase, mocks.authState.managementKey),
      maxAgeMs: 300000,
    });

    const restored = useModelsStore.getState().restoreFromPersistence('http://server:3000');

    expect(restored).toEqual(mocks.persistedModels);
    expect(mocks.cacheGetSpy).toHaveBeenCalledWith(
      'models',
      buildScopeKey(mocks.authState.apiBase, mocks.authState.managementKey)
    );
    expect(useModelsStore.getState().models).toEqual(mocks.persistedModels);
    expect(
      useModelsStore
        .getState()
        .cache.get(buildScopeKey(mocks.authState.apiBase, mocks.authState.managementKey))?.data
    ).toEqual(mocks.persistedModels);
    expect(
      useModelsStore
        .getState()
        .isCacheValid(buildScopeKey(mocks.authState.apiBase, mocks.authState.managementKey))
    ).toBe(true);
  });

  it('does not reuse memory or persistence cache across accounts on the same apiBase', async () => {
    const firstModels: ModelInfo[] = [{ name: 'gpt-4.1' }];
    const secondModels: ModelInfo[] = [{ name: 'claude-3.7-sonnet' }];

    mocks.fetchModelsSpy.mockResolvedValueOnce(firstModels).mockResolvedValueOnce(secondModels);

    const first = await useModelsStore.getState().fetchModels('http://server:3000', 'proxy-key');
    expect(first).toEqual(firstModels);
    expect(mocks.cacheSetSpy).toHaveBeenNthCalledWith(
      1,
      'models',
      firstModels,
      expect.objectContaining({
        scopeKey: buildScopeKey('http://server:3000', 'management-key'),
      })
    );

    mocks.authState.managementKey = 'other-management-key';

    const second = await useModelsStore.getState().fetchModels('http://server:3000', 'proxy-key');
    expect(second).toEqual(secondModels);
    expect(mocks.fetchModelsSpy).toHaveBeenCalledTimes(2);
    expect(mocks.cacheSetSpy).toHaveBeenNthCalledWith(
      2,
      'models',
      secondModels,
      expect.objectContaining({
        scopeKey: buildScopeKey('http://server:3000', 'other-management-key'),
      })
    );
  });
});
