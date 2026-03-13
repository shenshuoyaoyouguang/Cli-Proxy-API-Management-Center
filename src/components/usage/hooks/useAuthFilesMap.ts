import { useEffect, useMemo, useState } from 'react';
import { authFilesApi } from '@/services/api/authFiles';
import { useAuthStore, USAGE_STATS_STALE_TIME_MS } from '@/stores';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import { createAuthFileMap } from './usageAnalyticsSnapshot';

type AuthFilesCacheEntry = {
  loadedAt: number;
  files: AuthFileItem[];
  authFileMap: Map<string, CredentialInfo>;
};

const authFilesCache = new Map<string, AuthFilesCacheEntry>();
const authFilesInFlight = new Map<string, Promise<AuthFilesCacheEntry>>();

const emptyEntry = (): AuthFilesCacheEntry => ({
  loadedAt: 0,
  files: [],
  authFileMap: new Map<string, CredentialInfo>()
});

const getScopeEntry = async (scopeKey: string): Promise<AuthFilesCacheEntry> => {
  const cached = authFilesCache.get(scopeKey);
  const now = Date.now();
  if (cached && now - cached.loadedAt < USAGE_STATS_STALE_TIME_MS) {
    return cached;
  }

  const inFlight = authFilesInFlight.get(scopeKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = authFilesApi
    .list()
    .then((response) => {
      const files = Array.isArray(response)
        ? response
        : Array.isArray(response?.files)
          ? response.files
          : [];
      const nextEntry = {
        loadedAt: Date.now(),
        files,
        authFileMap: createAuthFileMap(files)
      };
      authFilesCache.set(scopeKey, nextEntry);
      return nextEntry;
    })
    .finally(() => {
      authFilesInFlight.delete(scopeKey);
    });

  authFilesInFlight.set(scopeKey, promise);
  return promise;
};

export interface UseAuthFilesMapReturn {
  authFileMap: Map<string, CredentialInfo>;
  authFiles: AuthFileItem[];
  loading: boolean;
}

export function useAuthFilesMap(): UseAuthFilesMapReturn {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const scopeKey = useMemo(() => `${apiBase || ''}::${managementKey || ''}`, [apiBase, managementKey]);

  const [state, setState] = useState<{ scopeKey: string; entry: AuthFilesCacheEntry }>(() => ({
    scopeKey,
    entry: authFilesCache.get(scopeKey) ?? emptyEntry()
  }));
  const resolvedEntry = state.scopeKey === scopeKey ? state.entry : authFilesCache.get(scopeKey) ?? emptyEntry();

  useEffect(() => {
    let cancelled = false;
    const cached = authFilesCache.get(scopeKey);

    if (!scopeKey) {
      return () => {
        cancelled = true;
      };
    }

    const isFresh =
      cached && Date.now() - cached.loadedAt < USAGE_STATS_STALE_TIME_MS;

    if (isFresh) {
      return () => {
        cancelled = true;
      };
    }

    void getScopeEntry(scopeKey)
      .then((entry) => {
        if (cancelled) return;
        setState({ scopeKey, entry });
      })
      .catch(() => {
        if (cancelled) return;
      });

    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  return {
    authFileMap: resolvedEntry.authFileMap,
    authFiles: resolvedEntry.files,
    loading: Boolean(scopeKey) && authFilesInFlight.has(scopeKey) && resolvedEntry.files.length === 0
  };
}
