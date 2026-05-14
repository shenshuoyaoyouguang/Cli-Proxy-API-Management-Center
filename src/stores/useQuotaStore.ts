/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import { CacheLayer } from '@/services/cache';
import { useAuthStore } from '@/stores/useAuthStore';
import { CACHE_EXPIRY_MS } from '@/utils/constants';
import { buildScopeKey } from '@/utils/helpers';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  KimiQuotaState,
} from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);

interface QuotaStoreState {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  clearQuotaCache: () => void;
}

const resolveUpdater = <T>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

export const useQuotaStore = create<QuotaStoreState>((set, get) => ({
  antigravityQuota: {},
  claudeQuota: {},
  codexQuota: {},
  geminiCliQuota: {},
  kimiQuota: {},

  setAntigravityQuota: (updater) => {
    const prev = get().antigravityQuota;
    const next = resolveUpdater(updater, prev);
    const { apiBase, managementKey } = useAuthStore.getState();
    const scopeKey = buildScopeKey(apiBase, managementKey);
    set({ antigravityQuota: next });
    CacheLayer.set('antigravity', next, { scopeKey, maxAgeMs: CACHE_EXPIRY_MS });
  },
  setClaudeQuota: (updater) => {
    const prev = get().claudeQuota;
    const next = resolveUpdater(updater, prev);
    const { apiBase, managementKey } = useAuthStore.getState();
    const scopeKey = buildScopeKey(apiBase, managementKey);
    set({ claudeQuota: next });
    CacheLayer.set('claude', next, { scopeKey, maxAgeMs: CACHE_EXPIRY_MS });
  },
  setCodexQuota: (updater) => {
    const prev = get().codexQuota;
    const next = resolveUpdater(updater, prev);
    const { apiBase, managementKey } = useAuthStore.getState();
    const scopeKey = buildScopeKey(apiBase, managementKey);
    set({ codexQuota: next });
    CacheLayer.set('codex', next, { scopeKey, maxAgeMs: CACHE_EXPIRY_MS });
  },
  setGeminiCliQuota: (updater) => {
    const prev = get().geminiCliQuota;
    const next = resolveUpdater(updater, prev);
    const { apiBase, managementKey } = useAuthStore.getState();
    const scopeKey = buildScopeKey(apiBase, managementKey);
    set({ geminiCliQuota: next });
    CacheLayer.set('gemini-cli', next, { scopeKey, maxAgeMs: CACHE_EXPIRY_MS });
  },
  setKimiQuota: (updater) => {
    const prev = get().kimiQuota;
    const next = resolveUpdater(updater, prev);
    const { apiBase, managementKey } = useAuthStore.getState();
    const scopeKey = buildScopeKey(apiBase, managementKey);
    set({ kimiQuota: next });
    CacheLayer.set('kimi', next, { scopeKey, maxAgeMs: CACHE_EXPIRY_MS });
  },

  clearQuotaCache: () => {
    const { apiBase, managementKey } = useAuthStore.getState();
    const scopeKey = buildScopeKey(apiBase, managementKey);
    CacheLayer.invalidateScope(scopeKey);
    set({
      antigravityQuota: {},
      claudeQuota: {},
      codexQuota: {},
      geminiCliQuota: {},
      kimiQuota: {},
    });
  },
}));
