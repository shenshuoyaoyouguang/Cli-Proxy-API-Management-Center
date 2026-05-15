import { usageApi, type AutoPersistUsagePayload } from '@/services/api/usage';
import { CacheLayer } from '@/services/cache';
import { computeApiUrl } from '@/utils/connection';
import { createAggregateOnlyUsageSnapshot, type KeyStats, type UsageDetail } from '@/utils/usage';
import {
  DEFAULT_USAGE_CACHE_MAX_DETAILS,
  resolveCachedUsageDetailsFromUsage,
  trimUsageDetailsForCache,
} from '@/utils/usage/cacheSnapshot';

type UsageStatsSnapshot = Record<string, unknown>;

type AutoPersistConnection = {
  apiBase: string;
  managementKey: string;
};

type AutoPersistSnapshotCore = {
  scopeKey: string;
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  lastRefreshedAt: number | null;
};

export type AutoPersistSnapshotInput = AutoPersistSnapshotCore & {
  connection?: AutoPersistConnection | null;
};

export type AutoPersistBootstrapSnapshot = AutoPersistSnapshotCore & {
  detailCount: number;
};

type AutoPersistCache = AutoPersistBootstrapSnapshot & {
  sessionId: string;
  payload: AutoPersistUsagePayload | null;
  updatedAt: number;
  lastPersistedAt: number | null;
  lastPersistedDetailCount: number;
  rawDetailCount: number;
};

const AUTO_PERSIST_CACHE_PREFIX = 'cli-proxy-usage-auto-persist-v1';
const AUTO_PERSIST_TRIGGER_DELTA = 3; // 降低触发阈值：10 → 3
const AUTO_PERSIST_INTERVAL_MS = 30_000; // 缩短上传间隔：60s → 30s
const AUTO_PERSIST_START_DELAY_MS = 5_000; // 降低启动延迟：30s → 5s
const AUTO_PERSIST_MAX_DELAY_MS = 5 * 60 * 1000;
const CLEARED_SCOPE_KEY_TTL_MS = 10 * 60 * 1000; // 10 分钟

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

const createStorageKey = (scopeKey: string) =>
  `${AUTO_PERSIST_CACHE_PREFIX}:${encodeURIComponent(scopeKey)}`;

const stripTopLevelModels = (usage: UsageStatsSnapshot | null): UsageStatsSnapshot | null => {
  if (!usage) {
    return null;
  }

  const nextUsage = { ...usage };
  delete nextUsage.models;
  return nextUsage;
};

const createSessionId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const resolveCachedUsageDetails = (
  usage: UsageStatsSnapshot | null,
  usageDetails: UsageDetail[] | undefined
): UsageDetail[] =>
  resolveCachedUsageDetailsFromUsage(usage, usageDetails, DEFAULT_USAGE_CACHE_MAX_DETAILS);

const normalizeKeyStats = (value: unknown): KeyStats => {
  if (!value || typeof value !== 'object') {
    return createEmptyKeyStats();
  }

  const input = value as Partial<KeyStats>;
  return {
    bySource:
      input.bySource && typeof input.bySource === 'object'
        ? (input.bySource as KeyStats['bySource'])
        : {},
    byAuthIndex:
      input.byAuthIndex && typeof input.byAuthIndex === 'object'
        ? (input.byAuthIndex as KeyStats['byAuthIndex'])
        : {},
  };
};

const readCache = (scopeKey: string): AutoPersistCache | null => {
  if (typeof localStorage === 'undefined' || !scopeKey) {
    return null;
  }

  try {
    const raw = localStorage.getItem(createStorageKey(scopeKey));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<AutoPersistCache> | null;
    if (!parsed || parsed.scopeKey !== scopeKey) {
      return null;
    }

    const usage =
      parsed.usage && typeof parsed.usage === 'object'
        ? (parsed.usage as UsageStatsSnapshot)
        : null;
    const usageDetails = resolveCachedUsageDetails(
      usage,
      parsed.usageDetails as UsageDetail[] | undefined
    );

    return {
      scopeKey,
      usage,
      keyStats: normalizeKeyStats(parsed.keyStats),
      usageDetails,
      lastRefreshedAt:
        typeof parsed.lastRefreshedAt === 'number' && Number.isFinite(parsed.lastRefreshedAt)
          ? parsed.lastRefreshedAt
          : null,
      detailCount:
        typeof parsed.detailCount === 'number' && Number.isFinite(parsed.detailCount)
          ? Math.max(0, parsed.detailCount)
          : usageDetails.length,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : '',
      payload:
        parsed.payload && typeof parsed.payload === 'object'
          ? (parsed.payload as AutoPersistUsagePayload)
          : null,
      updatedAt:
        typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : 0,
      lastPersistedAt:
        typeof parsed.lastPersistedAt === 'number' && Number.isFinite(parsed.lastPersistedAt)
          ? parsed.lastPersistedAt
          : null,
      lastPersistedDetailCount:
        typeof parsed.lastPersistedDetailCount === 'number' &&
        Number.isFinite(parsed.lastPersistedDetailCount)
          ? Math.max(0, parsed.lastPersistedDetailCount)
          : 0,
      rawDetailCount:
        typeof parsed.rawDetailCount === 'number' && Number.isFinite(parsed.rawDetailCount)
          ? Math.max(0, parsed.rawDetailCount)
          : usageDetails.length,
    };
  } catch {
    return null;
  }
};

const writeCache = (cache: AutoPersistCache) => {
  if (typeof localStorage === 'undefined' || !cache.scopeKey) {
    return;
  }

  const storageKey = createStorageKey(cache.scopeKey);
  const serialized = JSON.stringify(cache);

  try {
    localStorage.setItem(storageKey, serialized);
    return;
  } catch {
    CacheLayer.prune();
  }

  try {
    localStorage.setItem(storageKey, serialized);
  } catch {
    const liteCache: AutoPersistCache = {
      ...cache,
      usage: cache.usage ? createAggregateOnlyUsageSnapshot(cache.usage) : null,
      usageDetails: [],
      detailCount: 0,
      rawDetailCount: 0,
      payload: null,
    };

    try {
      localStorage.setItem(storageKey, JSON.stringify(liteCache));
    } catch {
      // Ignore persistence failures and keep runtime data only.
    }
  }
};

const removeCache = (scopeKey: string) => {
  if (typeof localStorage === 'undefined' || !scopeKey) {
    return;
  }

  try {
    localStorage.removeItem(createStorageKey(scopeKey));
  } catch {
    // Ignore removal failures.
  }
};

export class AutoPersistService {
  private readonly sessionId = createSessionId();
  private activeScopeKey = '';
  private currentCache: AutoPersistCache | null = null;
  private currentConnection: AutoPersistConnection | null = null;
  private readonly clearedScopeKeys = new Map<string, number>();
  private startDelayCompleted = false;
  private startTimerId: number | null = null;
  private intervalId: number | null = null;
  private persistInFlight: Promise<void> | null = null;
  private boundHandleBeforeUnload: (() => void) | null = null;
  private boundHandleVisibilityChange: (() => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.boundHandleBeforeUnload = this.handleBeforeUnload.bind(this);
      window.addEventListener('beforeunload', this.boundHandleBeforeUnload);

      this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
      document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);
    }
  }

  private handleBeforeUnload() {
    if (this.currentCache) {
      writeCache(this.currentCache);
      this.persistWithKeepalive(this.currentCache.payload, this.currentConnection);
    }
  }

  private persistWithKeepalive(
    payload: AutoPersistUsagePayload | null,
    connection: AutoPersistConnection | null
  ) {
    if (!payload || !connection || typeof fetch !== 'function') {
      return;
    }

    const managementUrl = computeApiUrl(connection.apiBase);
    if (!managementUrl || !connection.managementKey) {
      return;
    }

    try {
      void fetch(`${managementUrl}/usage/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${connection.managementKey}`,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // keepalive failures are non-critical
      });
    } catch {
      // keepalive setup failures are non-critical
    }
  }

  private handleVisibilityChange() {
    if (document.visibilityState === 'hidden' && this.startDelayCompleted && this.currentCache) {
      void this.maybePersist();
    }
  }

  private isScopeCleared(scopeKey: string): boolean {
    if (!this.clearedScopeKeys.has(scopeKey)) {
      return false;
    }
    const clearedAt = this.clearedScopeKeys.get(scopeKey)!;
    if (Date.now() - clearedAt < CLEARED_SCOPE_KEY_TTL_MS) {
      return true;
    }
    this.clearedScopeKeys.delete(scopeKey);
    return false;
  }

  readBootstrapSnapshot(scopeKey: string): AutoPersistBootstrapSnapshot | null {
    if (!scopeKey) {
      return null;
    }
    if (this.isScopeCleared(scopeKey)) {
      return null;
    }

    const cache =
      this.activeScopeKey === scopeKey
        ? (this.currentCache ?? readCache(scopeKey))
        : readCache(scopeKey);
    if (!cache) {
      return null;
    }

    return {
      scopeKey: cache.scopeKey,
      usage: stripTopLevelModels(cache.usage) as AutoPersistBootstrapSnapshot['usage'],
      keyStats: cache.keyStats,
      usageDetails: cache.usageDetails,
      lastRefreshedAt: cache.lastRefreshedAt,
      detailCount: cache.detailCount,
    };
  }

  clearRuntimeState(scopeKey?: string, options?: { removePersisted?: boolean }) {
    if (!scopeKey || this.activeScopeKey === scopeKey) {
      this.stopTimers();
      this.activeScopeKey = '';
      this.currentCache = null;
      this.currentConnection = null;
      this.persistInFlight = null;
    }

    if (options?.removePersisted && scopeKey) {
      this.clearedScopeKeys.set(scopeKey, Date.now());
      removeCache(scopeKey);
    }
  }

  onUsageRefreshed(input: AutoPersistSnapshotInput) {
    if (!input.scopeKey) {
      return;
    }
    this.clearedScopeKeys.delete(input.scopeKey);

    const previousCache =
      this.activeScopeKey === input.scopeKey
        ? (this.currentCache ?? readCache(input.scopeKey))
        : readCache(input.scopeKey);
    const nextCache = this.createNextCache(previousCache, input);

    this.activeScopeKey = input.scopeKey;
    this.currentCache = nextCache;
    this.currentConnection = input.connection ?? null;
    writeCache(nextCache);
    this.ensureTimers();
    if (this.startDelayCompleted) {
      void this.maybePersist();
    }
  }

  private createNextCache(
    previousCache: AutoPersistCache | null,
    input: AutoPersistSnapshotInput
  ): AutoPersistCache {
    const incomingDetailCount = input.usageDetails.length;
    const usage = input.usage;
    const keyStats = input.keyStats;
    const usageDetails = trimUsageDetailsForCache(
      input.usageDetails,
      DEFAULT_USAGE_CACHE_MAX_DETAILS
    );
    const detailCount = incomingDetailCount;
    const rawDetailCount = incomingDetailCount;
    const lastRefreshedAt = input.lastRefreshedAt;
    const payload =
      usage && detailCount > 0
        ? ({
            version: previousCache?.payload?.version ?? 1,
            exported_at: new Date(lastRefreshedAt ?? Date.now()).toISOString(),
            usage,
            origin: 'cli-proxy-auto-persist',
            session_id: this.sessionId,
          } satisfies AutoPersistUsagePayload)
        : (previousCache?.payload ?? null);

    return {
      scopeKey: input.scopeKey,
      usage,
      keyStats,
      usageDetails,
      lastRefreshedAt,
      detailCount,
      rawDetailCount,
      sessionId: this.sessionId,
      payload,
      updatedAt: Date.now(),
      lastPersistedAt: previousCache?.lastPersistedAt ?? null,
      lastPersistedDetailCount: previousCache?.lastPersistedDetailCount ?? 0,
    };
  }

  private ensureTimers() {
    if (typeof window === 'undefined' || this.startTimerId !== null || this.intervalId !== null) {
      return;
    }

    this.startTimerId = window.setTimeout(() => {
      this.startTimerId = null;
      this.startDelayCompleted = true;
      void this.maybePersist();

      if (typeof window === 'undefined' || this.intervalId !== null) {
        return;
      }

      this.intervalId = window.setInterval(() => {
        void this.maybePersist();
      }, AUTO_PERSIST_INTERVAL_MS);
    }, AUTO_PERSIST_START_DELAY_MS);
  }

  private stopTimers() {
    if (typeof window === 'undefined') {
      this.startDelayCompleted = false;
      return;
    }

    if (this.startTimerId !== null) {
      window.clearTimeout(this.startTimerId);
      this.startTimerId = null;
    }

    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.startDelayCompleted = false;
  }

  destroy() {
    this.stopTimers();

    if (typeof window !== 'undefined' && this.boundHandleBeforeUnload) {
      window.removeEventListener('beforeunload', this.boundHandleBeforeUnload);
      this.boundHandleBeforeUnload = null;
    }

    if (typeof document !== 'undefined' && this.boundHandleVisibilityChange) {
      document.removeEventListener('visibilitychange', this.boundHandleVisibilityChange);
      this.boundHandleVisibilityChange = null;
    }
  }

  private shouldPersist(cache: AutoPersistCache) {
    if (!cache.payload || cache.detailCount <= 0) {
      return false;
    }

    const delta = cache.rawDetailCount - cache.lastPersistedDetailCount;
    if (delta < AUTO_PERSIST_TRIGGER_DELTA) {
      if (
        cache.lastPersistedAt === null ||
        Date.now() - cache.lastPersistedAt < AUTO_PERSIST_MAX_DELAY_MS
      ) {
        return false;
      }
    }

    if (
      cache.lastPersistedAt !== null &&
      Date.now() - cache.lastPersistedAt < AUTO_PERSIST_INTERVAL_MS
    ) {
      return false;
    }

    return true;
  }

  private async maybePersist() {
    if (
      !this.startDelayCompleted ||
      !this.currentCache ||
      !this.shouldPersist(this.currentCache) ||
      this.persistInFlight
    ) {
      return;
    }

    const cacheToPersist = this.currentCache;
    const payload = cacheToPersist.payload;
    if (!payload) {
      return;
    }

    const task = (async () => {
      try {
        await usageApi.autoPersistUsage(payload);
        if (this.isScopeCleared(cacheToPersist.scopeKey)) {
          removeCache(cacheToPersist.scopeKey);
          return;
        }

        const current =
          this.activeScopeKey === cacheToPersist.scopeKey
            ? (this.currentCache ?? readCache(cacheToPersist.scopeKey))
            : readCache(cacheToPersist.scopeKey);
        if (!current) {
          return;
        }

        const nextCache: AutoPersistCache = {
          ...current,
          lastPersistedAt: Date.now(),
          lastPersistedDetailCount: Math.min(current.rawDetailCount, cacheToPersist.rawDetailCount),
        };

        writeCache(nextCache);
        if (this.activeScopeKey === nextCache.scopeKey) {
          this.currentCache = nextCache;
        }
      } catch {
        // Ignore auto-persist failures and retry on the next interval.
      } finally {
        this.persistInFlight = null;
      }
    })();

    this.persistInFlight = task;
    await task;
  }
}

export const autoPersistService = new AutoPersistService();
