/**
 * useApiAction hook
 * For function-based API calls (backward compatible with existing code)
 */

import { useState, useCallback } from 'react';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { ApiError } from '@/types';

interface UseApiActionOptions<T> {
  immediate?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: ApiError) => void;
  showErrorNotification?: boolean;
  showSuccessNotification?: boolean;
  successMessage?: string;
}

interface UseApiActionReturn<T, Args extends unknown[]> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  execute: (...args: Args) => Promise<T | null>;
}

export function useApiAction<T, Args extends unknown[] = []>(
  apiFn: (...args: Args) => Promise<T>,
  options: UseApiActionOptions<T> = {}
): UseApiActionReturn<T, Args> {
  const {
    immediate = false,
    onSuccess,
    onError,
    showErrorNotification = false,
    showSuccessNotification = false,
    successMessage,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<ApiError | null>(null);

  const showNotification = useNotificationStore((state) => state.showNotification);

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiFn(...args);
        setData(result);
        onSuccess?.(result);

        if (showSuccessNotification && successMessage) {
          showNotification(successMessage, 'success');
        }

        return result;
      } catch (err) {
        const apiError = err as ApiError;
        setError(apiError);
        onError?.(apiError);

        if (showErrorNotification) {
          const errorMessage = apiError.message || 'Request failed';
          showNotification(errorMessage, 'error');
        }

        return null;
      } finally {
        setLoading(false);
      }
    },
    [
      apiFn,
      onSuccess,
      onError,
      showErrorNotification,
      showSuccessNotification,
      successMessage,
      showNotification,
    ]
  );

  return { data, loading, error, execute };
}

export default useApiAction;
