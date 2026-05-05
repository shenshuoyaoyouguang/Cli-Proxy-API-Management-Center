import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSSEConnectionStatus, UsageSSEHandler } from '@/types/sse';

const mocks = vi.hoisted(() => {
  let connectionStatus: UsageSSEConnectionStatus = 'disconnected';
  const connectSpy = vi.fn((_: string, __: string, ___: UsageSSEHandler) => {
    connectionStatus = 'connecting';
  });
  const disconnectSpy = vi.fn(() => {
    connectionStatus = 'disconnected';
  });
  const getConnectionStatusSpy = vi.fn(() => connectionStatus);
  const loadUsageStatsSpy = vi.fn();
  const applyDeltaSpy = vi.fn();
  const applyFullSnapshotSpy = vi.fn();

  return {
    usageSSEService: {
      connect: connectSpy,
      disconnect: disconnectSpy,
      getConnectionStatus: getConnectionStatusSpy,
    },
    connectSpy,
    disconnectSpy,
    getConnectionStatusSpy,
    setConnectionStatus: (status: UsageSSEConnectionStatus) => {
      connectionStatus = status;
    },
    resetConnectionStatus: () => {
      connectionStatus = 'disconnected';
    },
    loadUsageStatsSpy,
    applyDeltaSpy,
    applyFullSnapshotSpy,
  };
});

vi.mock('@/services/sse', () => ({
  usageSSEService: mocks.usageSSEService,
  SSE_DEGRADED_RECONNECT_INTERVAL_MS: 300000,
  SSE_POLLING_INTERVAL_MS: 60000,
}));

vi.mock('@/stores/useUsageStatsStore', () => ({
  USAGE_STATS_STALE_TIME_MS: 120000,
  useUsageStatsStore: {
    getState: () => ({
      usage: { apis: {} },
      loadUsageStats: mocks.loadUsageStatsSpy,
      applyDelta: mocks.applyDeltaSpy,
      applyFullSnapshot: mocks.applyFullSnapshotSpy,
    }),
  },
}));

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: <T,>(selector: (state: { apiBase: string; managementKey: string }) => T) =>
    selector({
      apiBase: 'http://localhost:3000',
      managementKey: 'test-key',
    }),
}));

vi.mock('@/hooks/useInterval', () => ({
  useInterval: vi.fn(),
}));

import { useUsageSSE } from './useUsageSSE';

type HookResult = ReturnType<typeof useUsageSSE>;

const renderUseUsageSSE = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const resultRef: { current: HookResult | null } = { current: null };
  let root: Root | null = createRoot(container);

  function Harness() {
    const hookResult = useUsageSSE({ enabled: true });

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
        throw new Error('expected useUsageSSE result');
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

describe('useUsageSSE visibility handling', () => {
  let hidden = false;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetConnectionStatus();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
  });

  afterEach(() => {
    hidden = false;
    document.body.innerHTML = '';
  });

  it('disconnects on hide and reconnects on show even when the service had degraded', async () => {
    const harness = await renderUseUsageSSE();

    expect(mocks.connectSpy).toHaveBeenCalledTimes(1);
    expect(harness.getResult().connectionStatus).toBe('disconnected');

    mocks.connectSpy.mockClear();
    mocks.disconnectSpy.mockClear();
    mocks.loadUsageStatsSpy.mockClear();
    mocks.setConnectionStatus('degraded');

    hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mocks.disconnectSpy).toHaveBeenCalledTimes(1);
    expect(harness.getResult().connectionStatus).toBe('disconnected');

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mocks.connectSpy).toHaveBeenCalledTimes(1);
    expect(mocks.loadUsageStatsSpy).not.toHaveBeenCalled();
    expect(harness.getResult().connectionStatus).toBe('connecting');

    await harness.unmount();
  });
});
