import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScopeKey } from '@/utils/helpers';

const mocks = vi.hoisted(() => {
  const authState = {
    apiBase: 'http://localhost:3000',
    managementKey: 'management-key',
  };

  return {
    authState,
    listSpy: vi.fn(),
  };
});

vi.mock('@/services/api/authFiles', () => ({
  authFilesApi: {
    list: mocks.listSpy,
  },
}));

vi.mock('@/stores', () => ({
  USAGE_STATS_STALE_TIME_MS: 120000,
  useAuthStore: <T,>(selector: (state: { apiBase: string; managementKey: string }) => T) =>
    selector(mocks.authState),
}));

vi.mock('./usageAnalyticsSnapshot', () => ({
  createAuthFileMap: (files: Array<{ authIndex?: number; name: string; type?: string }>) =>
    new Map(
      files.map((file) => [
        String(file.authIndex ?? file.name),
        { name: file.name, type: file.type ?? '' },
      ])
    ),
}));

import { invalidateAuthFilesMapCache, useAuthFilesMap } from './useAuthFilesMap';

type HookResult = ReturnType<typeof useAuthFilesMap>;

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderUseAuthFilesMap = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const resultRef: { current: HookResult | null } = { current: null };
  let root: Root | null = createRoot(container);

  function Harness() {
    const hookResult = useAuthFilesMap();

    useEffect(() => {
      resultRef.current = hookResult;
    }, [hookResult]);

    return null;
  }

  await act(async () => {
    root?.render(createElement(Harness));
  });

  return {
    getResult: () => {
      if (!resultRef.current) {
        throw new Error('expected useAuthFilesMap result');
      }
      return resultRef.current;
    },
    flush: flushEffects,
    unmount: async () => {
      await act(async () => {
        root?.unmount();
        root = null;
      });
      container.remove();
    },
  };
};

describe('useAuthFilesMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAuthFilesMapCache();
    mocks.authState.apiBase = 'http://localhost:3000';
    mocks.authState.managementKey = 'management-key';
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    invalidateAuthFilesMapCache();
  });

  it('invalidates cached auth files with the same hashed scope key used by mutations', async () => {
    mocks.listSpy
      .mockResolvedValueOnce({
        files: [{ name: 'file-a.json', type: 'claude', authIndex: 1 }],
      })
      .mockResolvedValueOnce({
        files: [{ name: 'file-b.json', type: 'gemini', authIndex: 2 }],
      });

    const first = await renderUseAuthFilesMap();
    await first.flush();

    expect(mocks.listSpy).toHaveBeenCalledTimes(1);
    expect(first.getResult().authFiles.map((item) => item.name)).toEqual(['file-a.json']);

    invalidateAuthFilesMapCache(
      buildScopeKey(mocks.authState.apiBase, mocks.authState.managementKey)
    );

    await first.unmount();

    const second = await renderUseAuthFilesMap();
    await second.flush();

    expect(mocks.listSpy).toHaveBeenCalledTimes(2);
    expect(second.getResult().authFiles.map((item) => item.name)).toEqual(['file-b.json']);

    await second.unmount();
  });
});
