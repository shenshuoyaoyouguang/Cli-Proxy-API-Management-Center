/**
 * 配置相关 API Hooks
 */

import { useCallback, useEffect, useState } from 'react';
import { configApi } from '@/services/api/config';
import type { Config } from '@/types';

/**
 * 获取配置 Hook
 * GET /config
 */
export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await configApi.getConfig();
      setConfig(data);
      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Immediate fetch on mount
  useEffect(() => {
    refetch();
  }, [refetch]);

  return { config, loading, error, refetch };
}

/**
 * 更新 Debug 模式 Hook
 * PUT /debug
 */
export function useUpdateDebug() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateDebug = useCallback(async (enabled: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await configApi.updateDebug(enabled);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, updateDebug };
}

/**
 * 更新代理 URL Hook
 * PUT /proxy-url
 */
export function useUpdateProxyUrl() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateProxyUrl = useCallback(async (proxyUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      await configApi.updateProxyUrl(proxyUrl);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, updateProxyUrl };
}

/**
 * 更新请求重试次数 Hook
 * PUT /request-retry
 */
export function useUpdateRequestRetry() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateRequestRetry = useCallback(async (retryCount: number) => {
    setLoading(true);
    setError(null);
    try {
      await configApi.updateRequestRetry(retryCount);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, updateRequestRetry };
}

/**
 * 清除代理 URL Hook
 * DELETE /proxy-url
 */
export function useClearProxyUrl() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearProxyUrl = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await configApi.clearProxyUrl();
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, clearProxyUrl };
}

/**
 * 更新使用统计开关 Hook
 * PUT /usage-statistics-enabled
 */
export function useUpdateUsageStatistics() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateUsageStatistics = useCallback(async (enabled: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await configApi.updateUsageStatistics(enabled);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, updateUsageStatistics };
}

/**
 * 更新请求日志开关 Hook
 * PUT /request-log
 */
export function useUpdateRequestLog() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateRequestLog = useCallback(async (enabled: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await configApi.updateRequestLog(enabled);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, updateRequestLog };
}
