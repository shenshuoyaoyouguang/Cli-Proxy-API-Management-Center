import { useCallback, useEffect, useRef, useState } from 'react';
import { usageSSEService } from '@/services/sse';
import { useUsageStatsStore, USAGE_STATS_STALE_TIME_MS } from '@/stores/useUsageStatsStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useInterval } from '@/hooks/useInterval';
import type { UsageSSEConnectionStatus, UsageSSEHandler } from '@/types/sse';

const SSE_DEGRADED_RECONNECT_INTERVAL_MS = 300000;
const SSE_POLLING_INTERVAL_MS = 60000;

export type { UsageSSEConnectionStatus };

export function useUsageSSE(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const [connectionStatus, setConnectionStatus] = useState<UsageSSEConnectionStatus>('disconnected');
  const fallenBackRef = useRef(false);
  const handlerRef = useRef<UsageSSEHandler | null>(null);
  const connectionStatusRef = useRef<UsageSSEConnectionStatus>('disconnected');

  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);

  const syncStatus = useCallback(() => {
    const status = usageSSEService.getConnectionStatus();
    if (status !== connectionStatusRef.current) {
      connectionStatusRef.current = status;
      setConnectionStatus(status);
    }
  }, []);

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
          fallenBackRef.current = true;
          connectionStatusRef.current = 'degraded';
          setConnectionStatus('degraded');
          if (!useUsageStatsStore.getState().usage) {
            void useUsageStatsStore.getState().loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
          }
        }
      },
      onAuthError: () => {
        connectionStatusRef.current = 'degraded';
        setConnectionStatus('degraded');
        if (!useUsageStatsStore.getState().usage) {
          void useUsageStatsStore.getState().loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
        }
      },
    };
    handlerRef.current = handler;

    usageSSEService.connect(apiBase, managementKey, handler);

    const statusIntervalId = setInterval(syncStatus, 1000);

    return () => {
      clearInterval(statusIntervalId);
      usageSSEService.disconnect();
      connectionStatusRef.current = 'disconnected';
      setConnectionStatus('disconnected');
    };
  }, [enabled, apiBase, managementKey, syncStatus]);

  useInterval(() => {
    void useUsageStatsStore.getState().loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, connectionStatus === 'degraded' ? SSE_POLLING_INTERVAL_MS : null);

  useInterval(() => {
    if (!apiBase || !managementKey || !handlerRef.current) return;
    fallenBackRef.current = false;
    usageSSEService.connect(apiBase, managementKey, handlerRef.current);
  }, connectionStatus === 'degraded' ? SSE_DEGRADED_RECONNECT_INTERVAL_MS : null);

  useEffect(() => {
    if (!enabled || !apiBase || !managementKey) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        usageSSEService.disconnect();
        connectionStatusRef.current = 'disconnected';
        setConnectionStatus('disconnected');
        return;
      }

      if (handlerRef.current) {
        fallenBackRef.current = false;
        usageSSEService.connect(apiBase, managementKey, handlerRef.current);
        connectionStatusRef.current = 'connecting';
        setConnectionStatus('connecting');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, apiBase, managementKey]);

  return {
    connectionStatus,
    isDegraded: connectionStatus === 'degraded',
  };
}
