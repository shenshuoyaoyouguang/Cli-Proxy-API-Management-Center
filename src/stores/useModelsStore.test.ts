import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '@/utils/models';

const mocks = vi.hoisted(() => {
  const persistedModels: ModelInfo[] = [{ name: 'gpt-4.1' }];

  return {
    persistedModels,
    cacheGetSpy: vi.fn(() => ({
      data: persistedModels,
      timestamp: Date.now(),
      scopeKey: 'http://server:3000::management-key',
      maxAgeMs: 300000,
    })),
  };
});

vi.mock('@/services/api/models', () => ({
  modelsApi: {
    fetchModels: vi.fn(),
  },
}));

vi.mock('@/services/cache', () => ({
  CacheLayer: {
    get: mocks.cacheGetSpy,
    set: vi.fn(),
  },
}));

vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({
      apiBase: 'http://server:3000',
      managementKey: 'management-key',
    }),
  },
}));

import { useModelsStore } from './useModelsStore';

describe('useModelsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelsStore.setState({
      models: [],
      loading: false,
      error: null,
      cache: new Map(),
    });
  });

  it('hydrates the in-memory cache when restoring models from persistence', () => {
    const restored = useModelsStore.getState().restoreFromPersistence('http://server:3000');

    expect(restored).toEqual(mocks.persistedModels);
    expect(mocks.cacheGetSpy).toHaveBeenCalledWith(
      'models',
      'http://server:3000::management-key'
    );
    expect(useModelsStore.getState().models).toEqual(mocks.persistedModels);
    expect(useModelsStore.getState().cache.get('http://server:3000')?.data).toEqual(
      mocks.persistedModels
    );
    expect(useModelsStore.getState().isCacheValid('http://server:3000')).toBe(true);
  });
});
