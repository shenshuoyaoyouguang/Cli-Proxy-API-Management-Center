import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosRequestConfig } from 'axios';
import { apiClient } from '@/services/api/client';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { ApiError } from '@/types';
import { pendingRequests, generateDedupKey, scheduleCleanup } from './useApiDedupe';
import { calculateRetryDelay, sleep } from './useApiRetry';
import type { HttpMethod } from './types';

export type { HttpMethod };

export interface UseApiOptions<T> {
  initialData?: T;
  immediate?: boolean;
  showErrorNotification?: boolean;
  showSuccessNotification?: boolean;
  successMessage?: string;
  retryCount?: number;
  dedup?: boolean;
  axiosConfig?: AxiosRequestConfig;
}

export interface UseApiReturn<T, P = unknown> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | null;
  execute: (params?: P) => Promise<T | undefined>;
  refresh: () => Promise<T | undefined>;
  reset: () => void;
}

export function useApi<T, P = unknown>(
  url: string,
  method: HttpMethod,
  options: UseApiOptions<T> = {}
): UseApiReturn<T, P> {
  const {
    initialData,
    immediate = false,
    showErrorNotification = true,
    showSuccessNotification = false,
    successMessage,
    retryCount = 0,
    dedup = true,
    axiosConfig = {},
  } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const abortControllersRef = useRef<AbortController[]>([]);
  const lastParamsRef = useRef<P | undefined>(undefined);
  const isMountedRef = useRef(true);

  const showNotification = useNotificationStore((state) => state.showNotification);

  const abortAll = useCallback(() => {
    abortControllersRef.current.forEach((controller) => {
      controller.abort();
    });
    abortControllersRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortAll();
    };
  }, [abortAll]);

  const executeWithRetry = useCallback(
    async (params?: P, attempt: number = 0): Promise<T> => {
      const dedupKey = generateDedupKey(url, method, params);

      if (dedup && pendingRequests.has(dedupKey)) {
        const pending = pendingRequests.get(dedupKey)!;
        return pending.promise as Promise<T>;
      }

      const abortController = new AbortController();
      abortControllersRef.current.push(abortController);

      const config: AxiosRequestConfig = {
        ...axiosConfig,
        signal: abortController.signal,
      };

      const requestPromise = (async (): Promise<T> => {
        try {
          let result: T;

          switch (method) {
            case 'GET':
              result = await apiClient.get<T>(url, config);
              break;
            case 'POST':
              result = await apiClient.post<T>(url, params, config);
              break;
            case 'PUT':
              result = await apiClient.put<T>(url, params, config);
              break;
            case 'PATCH':
              result = await apiClient.patch<T>(url, params, config);
              break;
            case 'DELETE':
              result = await apiClient.delete<T>(url, config);
              break;
            default:
              throw new Error(`Unsupported HTTP method: ${method}`);
          }

          return result;
        } catch (err) {
          if (attempt < retryCount && !abortController.signal.aborted) {
            const delay = calculateRetryDelay(attempt);
            await sleep(delay);
            return executeWithRetry(params, attempt + 1);
          }
          throw err;
        }
      })();

      if (dedup) {
        pendingRequests.set(dedupKey, {
          promise: requestPromise,
          abortController,
          timestamp: Date.now(),
        });
        scheduleCleanup();
      }

      try {
        const result = await requestPromise;
        return result;
      } finally {
        const index = abortControllersRef.current.indexOf(abortController);
        if (index > -1) {
          abortControllersRef.current.splice(index, 1);
        }
        if (dedup) {
          pendingRequests.delete(dedupKey);
          scheduleCleanup();
        }
      }
    },
    [url, method, dedup, retryCount, axiosConfig]
  );

  const execute = useCallback(
    async (params?: P): Promise<T | undefined> => {
      lastParamsRef.current = params;

      setLoading(true);
      setError(null);

      try {
        const result = await executeWithRetry(params);

        if (isMountedRef.current) {
          setData(result);
          setLoading(false);

          if (showSuccessNotification && successMessage) {
            showNotification(successMessage, 'success');
          }
        }

        return result;
      } catch (err) {
        const apiError = err as ApiError;

        if (isMountedRef.current) {
          setError(apiError);
          setLoading(false);

          if (showErrorNotification) {
            const errorMessage = apiError.message || 'Request failed';
            showNotification(errorMessage, 'error');
          }
        }

        return undefined;
      }
    },
    [
      executeWithRetry,
      showErrorNotification,
      showSuccessNotification,
      successMessage,
      showNotification,
    ]
  );

  const refresh = useCallback(async (): Promise<T | undefined> => {
    return execute(lastParamsRef.current);
  }, [execute]);

  const reset = useCallback(() => {
    setData(initialData);
    setLoading(false);
    setError(null);
    lastParamsRef.current = undefined;

    abortAll();
  }, [initialData, abortAll]);

  useEffect(() => {
    if (immediate && method === 'GET') {
      execute();
    }
  }, [immediate, method, execute]);

  return {
    data,
    loading,
    error,
    execute,
    refresh,
    reset,
  };
}

export function useGet<T, P = unknown>(
  url: string,
  options?: Omit<UseApiOptions<T>, 'immediate'> & { immediate?: boolean }
): UseApiReturn<T, P> {
  return useApi<T, P>(url, 'GET', { immediate: true, ...options });
}

export function usePost<T, P = unknown>(
  url: string,
  options?: UseApiOptions<T>
): UseApiReturn<T, P> {
  return useApi<T, P>(url, 'POST', options);
}

export function usePut<T, P = unknown>(
  url: string,
  options?: UseApiOptions<T>
): UseApiReturn<T, P> {
  return useApi<T, P>(url, 'PUT', options);
}

export function usePatch<T, P = unknown>(
  url: string,
  options?: UseApiOptions<T>
): UseApiReturn<T, P> {
  return useApi<T, P>(url, 'PATCH', options);
}

export function useDelete<T, P = unknown>(
  url: string,
  options?: UseApiOptions<T>
): UseApiReturn<T, P> {
  return useApi<T, P>(url, 'DELETE', options);
}
