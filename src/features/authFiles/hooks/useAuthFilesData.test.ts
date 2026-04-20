import { act, createElement, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountHealthMap } from '@/types';

const mocks = vi.hoisted(() => {
  const authFilesApiMock = {
    list: vi.fn(),
    upload: vi.fn(),
  };
  const removeAccountsSpy = vi.fn();
  const showNotificationSpy = vi.fn();
  const showConfirmationSpy = vi.fn();
  const invalidateModelsCacheForFileSpy = vi.fn();
  const accountHealthStoreState = {
    healthMap: {},
    removeAccounts: removeAccountsSpy,
  };
  const notificationStoreState = {
    showNotification: showNotificationSpy,
    showConfirmation: showConfirmationSpy,
  };

  return {
    authFilesApiMock,
    removeAccountsSpy,
    showNotificationSpy,
    showConfirmationSpy,
    invalidateModelsCacheForFileSpy,
    accountHealthStoreState,
    notificationStoreState,
  };
});

const {
  authFilesApiMock,
  removeAccountsSpy,
  invalidateModelsCacheForFileSpy,
  accountHealthStoreState,
} = mocks as {
  authFilesApiMock: {
    list: ReturnType<typeof vi.fn>;
    upload: ReturnType<typeof vi.fn>;
  };
  removeAccountsSpy: ReturnType<typeof vi.fn>;
  showNotificationSpy: ReturnType<typeof vi.fn>;
  showConfirmationSpy: ReturnType<typeof vi.fn>;
  invalidateModelsCacheForFileSpy: ReturnType<typeof vi.fn>;
  accountHealthStoreState: {
    healthMap: AccountHealthMap;
    removeAccounts: ReturnType<typeof vi.fn>;
  };
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/services/api', () => ({
  authFilesApi: mocks.authFilesApiMock,
}));

vi.mock('@/stores', () => ({
  useAccountHealthStore: <T,>(
    selector: (state: typeof mocks.accountHealthStoreState) => T
  ) => selector(mocks.accountHealthStoreState),
  useNotificationStore: <T,>(
    selector?: (state: typeof mocks.notificationStoreState) => T
  ) => (typeof selector === 'function' ? selector(mocks.notificationStoreState) : mocks.notificationStoreState),
}));

vi.mock('./useAuthFilesModels', () => ({
  invalidateModelsCacheForFile: mocks.invalidateModelsCacheForFileSpy,
}));

import { useAuthFilesData, type UseAuthFilesDataResult } from './useAuthFilesData';

const renderUseAuthFilesData = async () => {
  const refreshKeyStats = vi.fn().mockResolvedValue(undefined);
  const container = document.createElement('div');
  document.body.appendChild(container);

  const resultRef: { current: UseAuthFilesDataResult | null } = { current: null };
  let root: Root | null = createRoot(container);

  function Harness() {
    const hookResult = useAuthFilesData({ refreshKeyStats });

    useEffect(() => {
      resultRef.current = hookResult;
    }, [hookResult]);

    return null;
  }

  await act(async () => {
    root?.render(createElement(Harness));
  });

  return {
    refreshKeyStats,
    getResult: () => {
      if (!resultRef.current) {
        throw new Error('expected useAuthFilesData result');
      }
      return resultRef.current;
    },
    unmount: async () => {
      await act(async () => {
        root?.unmount();
        root = null;
      });
      container.remove();
    },
  };
};

describe('useAuthFilesData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    accountHealthStoreState.healthMap = {
      'replacement.json': {
        degraded: true,
        degradedReason: '401_unauthorized',
        degradedStatus: 401,
        degradedMessage: '401 unauthorized',
        consecutiveFailures: 3,
        failureStatuses: [401, 401, 401],
        cooldownUntil: null,
        stale: false,
      },
    };
    authFilesApiMock.list.mockResolvedValue({
      files: [{ name: 'replacement.json', type: 'claude' }],
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('clears stale health only for successfully uploaded replacement files', async () => {
    authFilesApiMock.upload
      .mockResolvedValueOnce({
        status: 'ok',
        uploaded: 1,
        files: ['replacement.json'],
        failed: [],
      })
      .mockRejectedValueOnce(new Error('upload failed'));

    const harness = await renderUseAuthFilesData();
    const replacementFile = new File(['{}'], 'replacement.json', { type: 'application/json' });
    const failedFile = new File(['{}'], 'failed.json', { type: 'application/json' });
    const event = {
      target: {
        files: [replacementFile, failedFile],
        value: 'selected-files',
      },
    } as unknown as ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await harness.getResult().handleFileChange(event);
    });

    expect(removeAccountsSpy).toHaveBeenCalledWith(['replacement.json']);
    expect(removeAccountsSpy).not.toHaveBeenCalledWith(['replacement.json', 'failed.json']);
    expect(authFilesApiMock.list).toHaveBeenCalledTimes(1);
    expect(harness.refreshKeyStats).toHaveBeenCalledTimes(1);
    expect(invalidateModelsCacheForFileSpy).toHaveBeenCalledTimes(1);
    expect(invalidateModelsCacheForFileSpy).toHaveBeenCalledWith('replacement.json');
    expect((event.target as HTMLInputElement).value).toBe('');

    await harness.unmount();
  });
});
