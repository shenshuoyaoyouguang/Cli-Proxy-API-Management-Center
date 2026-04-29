/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { useQuotaStore } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaConfig } from './quotaConfigs';
import { reportQuotaHealthResults } from './healthReporting';

type QuotaScope = 'page' | 'all';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TData> {
  name: string;
  status: 'success' | 'error';
  data?: TData;
  error?: string;
  errorStatus?: number;
}

export function useQuotaLoader<TState, TData>(config: QuotaConfig<TState, TData>) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const queuedRequestRef = useRef<{
    targets: AuthFileItem[];
    scope: QuotaScope;
    setLoading: (loading: boolean, scope?: QuotaScope | null) => void;
  } | null>(null);

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void
    ) => {
      let queuedRequest:
        | {
            targets: AuthFileItem[];
            scope: QuotaScope;
            setLoading: (loading: boolean, scope?: QuotaScope | null) => void;
          }
        | null = null;

      if (loadingRef.current) {
        queuedRequestRef.current = {
          targets: [...targets],
          scope,
          setLoading,
        };
        return;
      }
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = config.buildLoadingState();
          });
          return nextState;
        });

        const results = await Promise.all(
          targets.map(async (file): Promise<LoadQuotaResult<TData>> => {
            let lastError: unknown;
            for (let attempt = 0; attempt <= 3; attempt++) {
              try {
                const data = await config.fetchQuota(file, t);
                return { name: file.name, status: 'success', data };
              } catch (err: unknown) {
                lastError = err;
                if (attempt < 3) {
                  await new Promise<void>((resolve) =>
                    setTimeout(resolve, 1000 * Math.pow(2, attempt))
                  );
                }
              }
            }
            const message =
              lastError instanceof Error ? lastError.message : t('common.unknown_error');
            const errorStatus = getStatusFromError(lastError);
            return { name: file.name, status: 'error', error: message, errorStatus };
          })
        );

        if (requestId !== requestIdRef.current) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              nextState[result.name] = config.buildSuccessState(result.data as TData);
            } else {
              nextState[result.name] = config.buildErrorState(
                result.error || t('common.unknown_error'),
                result.errorStatus
              );
            }
          });
          return nextState;
        });

        await reportQuotaHealthResults(results);
      } finally {
        loadingRef.current = false;
        queuedRequest = queuedRequestRef.current;
        if (queuedRequest) {
          queuedRequestRef.current = null;
        } else if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }

      if (queuedRequest) {
        void loadQuota(queuedRequest.targets, queuedRequest.scope, queuedRequest.setLoading);
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
