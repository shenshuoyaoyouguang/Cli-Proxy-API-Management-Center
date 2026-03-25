/**
 * useApi hook factory
 * Base hook for API requests with loading state, error handling, retry logic, and deduplication
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosRequestConfig } from 'axios';
import { apiClient } from '@/services/api/client';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { ApiError } from '@/types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface UseApiOptions<T> {
  /** Initial data value before first successful request */
  initialData?: T;
  /** Whether to execute immediately on mount */
  immediate?: boolean;
  /** Whether to show error notification on failure */
  showErrorNotification?: boolean;
  /** Whether to show success notification on completion */
  showSuccessNotification?: boolean;
  /** Success notification message (if showSuccessNotification is true) */
  successMessage?: string;
  /** Number of retry attempts on failure (0 = no retries) */
  retryCount?: number;
  /** Whether to enable request deduplication */
  dedup?: boolean;
  /** Additional Axios request config */
  axiosConfig?: AxiosRequestConfig;
}

export interface UseApiReturn<T, P = unknown> {
  /** Response data */
  data: T | undefined;
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: ApiError | null;
  /** Execute the API request */
  execute: (params?: P) => Promise<T | undefined>;
  /** Refresh with same parameters (for GET requests) */
  refresh: () => Promise<T | undefined>;
  /** Reset state to initial */
  reset: () => void;
}

interface PendingRequest {
  promise: Promise<unknown>;
  abortController: AbortController;
  timestamp: number;
}

// Global pending requests map for deduplication
const pendingRequests = new Map<string, PendingRequest>();

// Default retry delay in ms (exponential backoff)
const BASE_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;

// Request expiry for cleanup (30 seconds)
const REQUEST_EXPIRY_MS = 30000;
const CLEANUP_INTERVAL_MS = 10000;

// Cleanup expired pending requests
function cleanupExpiredRequests(): void {
  const now = Date.now();
  for (const [key, request] of pendingRequests) {
    if (now - request.timestamp > REQUEST_EXPIRY_MS) {
      request.abortController.abort();
      pendingRequests.delete(key);
    }
  }
}

// Set up periodic cleanup interval
let cleanupTimerId: ReturnType<typeof setInterval> | null = null;

function getCleanupInterval(): ReturnType<typeof setInterval> | null {
  if (!cleanupTimerId) {
    cleanupTimerId = setInterval(cleanupExpiredRequests, CLEANUP_INTERVAL_MS);
  }
  return cleanupTimerId;
}

// Start cleanup on module load
getCleanupInterval();

/**
 * Generate a deduplication key from URL and method
 */
function generateDedupKey(url: string, method: HttpMethod, params?: unknown): string {
  const paramsKey = params ? JSON.stringify(params) : '';
  return `${method}:${url}:${paramsKey}`;
}

/**
 * Calculate retry delay with exponential backoff
 */
function calculateRetryDelay(attempt: number): number {
  const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
  return Math.min(delay, MAX_RETRY_DELAY);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * useApi hook factory
 * @param url - API endpoint URL
 * @param method - HTTP method
 * @param options - Configuration options
 * @returns Hook state and controls
 */
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

  const abortControllerRef = useRef<AbortController | null>(null);
  const lastParamsRef = useRef<P | undefined>(undefined);
  const isMountedRef = useRef(true);

  const showNotification = useNotificationStore((state) => state.showNotification);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  /**
   * Execute the API request with retry logic
   */
  const executeWithRetry = useCallback(
    async (params?: P, attempt: number = 0): Promise<T> => {
      const dedupKey = generateDedupKey(url, method, params);

      // Check for deduplication
      if (dedup && pendingRequests.has(dedupKey)) {
        const pending = pendingRequests.get(dedupKey)!;
        return pending.promise as Promise<T>;
      }

      // Create new AbortController for this request
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Prepare request config
      const config: AxiosRequestConfig = {
        ...axiosConfig,
        signal: abortController.signal,
      };

      // Build the request promise
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
          // Handle retry logic
          if (attempt < retryCount && !abortController.signal.aborted) {
            const delay = calculateRetryDelay(attempt);
            await sleep(delay);
            return executeWithRetry(params, attempt + 1);
          }
          throw err;
        }
      })();

      // Store in pending requests for deduplication
      if (dedup) {
        pendingRequests.set(dedupKey, {
          promise: requestPromise,
          abortController,
          timestamp: Date.now(),
        });
      }

      try {
        const result = await requestPromise;
        return result;
      } finally {
        // Clean up pending request
        if (dedup) {
          pendingRequests.delete(dedupKey);
        }
      }
    },
    [url, method, dedup, retryCount, axiosConfig]
  );

  /**
   * Execute the API request
   */
  const execute = useCallback(
    async (params?: P): Promise<T | undefined> => {
      // Store params for refresh
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

  /**
   * Refresh with same parameters (useful for GET requests)
   */
  const refresh = useCallback(async (): Promise<T | undefined> => {
    return execute(lastParamsRef.current);
  }, [execute]);

  /**
   * Reset state to initial
   */
  const reset = useCallback(() => {
    setData(initialData);
    setLoading(false);
    setError(null);
    lastParamsRef.current = undefined;

    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [initialData]);

  // Execute immediately if requested (for GET requests typically)
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

/**
 * Convenience hooks for specific HTTP methods
 */

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

export default useApi;
