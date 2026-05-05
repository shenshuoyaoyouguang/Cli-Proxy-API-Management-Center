import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

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
  useNotificationStore: Object.assign(
    (selector: (state: { showNotification: () => void }) => unknown) =>
      selector({ showNotification: vi.fn() }),
    { getState: vi.fn(() => ({ showNotification: vi.fn() })) }
  ),
}));

import { apiClient } from '@/services/api/client';
import { useApi, useGet, usePost } from './useApiCore';
import { pendingRequests } from './useApiDedupe';

describe('useApiCore - retry behavior', () => {
  beforeEach(() => {
    pendingRequests.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    pendingRequests.clear();
    vi.useRealTimers();
  });

  it('retries on failure up to retryCount', async () => {
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ data: 'success' });

    const { result } = renderHook(() =>
      useApi('/api/test', 'GET', { retryCount: 2, dedup: false })
    );

    let executePromise: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await executePromise;
    });

    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });

  it('does not retry after abort', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    vi.mocked(apiClient.get).mockRejectedValue(abortError);

    const { result } = renderHook(() =>
      useApi('/api/test', 'GET', { retryCount: 3, dedup: false })
    );

    act(() => {
      result.current.execute();
    });

    act(() => {
      result.current.reset();
    });

    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('returns error after all retries exhausted', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Persistent error'));

    const { result } = renderHook(() =>
      useApi('/api/test', 'GET', { retryCount: 1, dedup: false })
    );

    let executePromise: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      try {
        await executePromise;
      } catch {
        // expected error
      }
    });

    expect(result.current.error).not.toBeNull();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});

describe('useApiCore - dedup behavior', () => {
  beforeEach(() => {
    pendingRequests.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    pendingRequests.clear();
  });

  it('deduplicates concurrent identical requests', async () => {
    let resolveGet: (value: unknown) => void;
    vi.mocked(apiClient.get).mockImplementation(
      () => new Promise((resolve) => { resolveGet = resolve; })
    );

    const { result } = renderHook(() =>
      useApi('/api/test', 'GET', { dedup: true })
    );

    let promise1: Promise<unknown>;
    let promise2: Promise<unknown>;

    act(() => {
      promise1 = result.current.execute();
      promise2 = result.current.execute();
    });

    expect(apiClient.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveGet!({ data: 'test' });
      await promise1;
      await promise2;
    });
  });

  it('allows different requests when dedup is enabled', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: 'test' });

    const { result: result1 } = renderHook(() =>
      useApi('/api/test1', 'GET', { dedup: true })
    );
    const { result: result2 } = renderHook(() =>
      useApi('/api/test2', 'GET', { dedup: true })
    );

    await act(async () => {
      await result1.current.execute();
      await result2.current.execute();
    });

    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('does not dedup when dedup option is false', async () => {
    let resolveGet: (value: unknown) => void;
    vi.mocked(apiClient.get).mockImplementation(
      () => new Promise((resolve) => { resolveGet = resolve; })
    );

    const { result } = renderHook(() =>
      useApi('/api/test', 'GET', { dedup: false })
    );

    act(() => {
      result.current.execute();
      result.current.execute();
    });

    expect(apiClient.get).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveGet!({ data: 'test' });
    });
  });
});

describe('useApiCore - abort behavior', () => {
  beforeEach(() => {
    pendingRequests.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    pendingRequests.clear();
  });

  it('aborts all requests on reset', async () => {
    vi.mocked(apiClient.get).mockImplementation(
      () => new Promise(() => {})
    );

    const { result } = renderHook(() =>
      useApi('/api/test', 'GET', { dedup: false })
    );

    act(() => {
      result.current.execute();
    });

    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.loading).toBe(false);
  });

  it('aborts previous requests on unmount', () => {
    vi.mocked(apiClient.get).mockImplementation(
      () => new Promise(() => {})
    );

    const { result, unmount } = renderHook(() =>
      useApi('/api/test', 'GET', { dedup: false })
    );

    act(() => {
      result.current.execute();
    });

    unmount();
  });
});

describe('useApiCore - state management', () => {
  beforeEach(() => {
    pendingRequests.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    pendingRequests.clear();
  });

  it('sets loading to true during request', async () => {
    let resolveGet: (value: unknown) => void;
    vi.mocked(apiClient.get).mockImplementation(
      () => new Promise((resolve) => { resolveGet = resolve; })
    );

    const { result } = renderHook(() =>
      useApi('/api/test', 'GET', { dedup: false })
    );

    act(() => {
      result.current.execute();
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveGet!({ data: 'test' });
    });

    expect(result.current.loading).toBe(false);
  });

  it('sets data on successful request', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: 'result' });

    const { result } = renderHook(() =>
      useApi<string>('/api/test', 'GET', { dedup: false })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toEqual({ data: 'result' });
    expect(result.current.error).toBeNull();
  });

  it('sets error on failed request', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() =>
      useApi('/api/test', 'GET', { dedup: false, showErrorNotification: false })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toBeUndefined();
  });

  it('refresh uses last params', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: 'ok' });

    const { result } = renderHook(() =>
      useApi('/api/test', 'POST', { dedup: false })
    );

    await act(async () => {
      await result.current.execute({ name: 'test' });
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiClient.post).mock.calls[1][1]).toEqual({ name: 'test' });
  });
});

describe('useGet convenience hook', () => {
  beforeEach(() => {
    pendingRequests.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    pendingRequests.clear();
  });

  it('executes immediately by default', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: 'auto' });

    renderHook(() => useGet('/api/auto', { dedup: false }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/api/auto', expect.anything());
    });
  });
});

describe('usePost convenience hook', () => {
  beforeEach(() => {
    pendingRequests.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    pendingRequests.clear();
  });

  it('does not execute immediately', () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: 'ok' });

    renderHook(() => usePost('/api/submit'));

    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
