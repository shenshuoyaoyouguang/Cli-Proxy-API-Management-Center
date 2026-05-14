import { useCallback, useEffect, useRef, useState } from 'react';
import { usageSSEService } from '@/services/sse';
import { useUsageStatsStore, USAGE_STATS_STALE_TIME_MS } from '@/stores/useUsageStatsStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useInterval } from '@/hooks/useInterval';
import type { UsageSSEConnectionStatus, UsageSSEHandler } from '@/types/sse';

const SSE_POLLING_INTERVAL_MS = 15000;

export type { UsageSSEConnectionStatus };

export function useUsageSSE(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const [connectionStatus, setConnectionStatus] = useState<UsageSSEConnectionStatus>('disconnected');
  const fallenBackRef = useRef(false);
  const handlerRef = useRef<UsageSSEHandler | null>(null);
  const connectionStatusRef = useRef<UsageSSEConnectionStatus>('disconnected');
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);

  const syncStatus = useCallback(() => {
    const status = usageSSEService.getConnectionStatus();
    if (status !== connectionStatusRef.current) {
      connectionStatusRef.current = status;
      setConnectionStatus(status);
    }
  }, []);

  const loadFreshUsageSnapshot = useCallback(() => {
    return useUsageStatsStore
      .getState()
      .loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, []);

  const enterDegradedMode = useCallback(() => {
    if (fallenBackRef.current) {
      return;
    }
    fallenBackRef.current = true;
    connectionStatusRef.current = 'degraded';
    setConnectionStatus('degraded');
    void loadFreshUsageSnapshot().catch(() => {});
  }, [loadFreshUsageSnapshot]);

  useEffect(() => {
    if (!enabled || !apiBase || !managementKey) return;

    fallenBackRef.current = false;

    const handler: UsageSSEHandler = {
      onDelta: (data) => {
        useUsageStatsStore.getState().applyDelta(data);
      },
      onFull: (data) => {
        useUsageStatsStore.getState().applyFullSnapshot(data);
      },
      onHeartbeat: () => {},
      onError: () => {
        const currentStatus = usageSSEService.getConnectionStatus();
        if (currentStatus === 'degraded' && !fallenBackRef.current) {
          enterDegradedMode();
        }
      },
      onAuthError: () => {
        enterDegradedMode();
      },
    };
    handlerRef.current = handler;

    usageSSEService.connect(apiBase, managementKey, handler);

    const statusIntervalId = setInterval(syncStatus, 1000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        usageSSEService.suspend();
        connectionStatusRef.current = 'disconnected';
        setConnectionStatus('disconnected');
        return;
      }

      if (handlerRef.current) {
        fallenBackRef.current = false;
        usageSSEService.resume(apiBase, managementKey, handlerRef.current);
        connectionStatusRef.current = 'connecting';
        setConnectionStatus('connecting');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(statusIntervalId);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      usageSSEService.disconnect();
      connectionStatusRef.current = 'disconnected';
      setConnectionStatus('disconnected');
    };
  }, [enabled, apiBase, enterDegradedMode, managementKey, syncStatus]);

  useInterval(() => {
    void useUsageStatsStore.getState().loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, connectionStatus === 'degraded' ? SSE_POLLING_INTERVAL_MS : null);

  return {
    connectionStatus,
    isDegraded: connectionStatus === 'degraded',
  };
}
