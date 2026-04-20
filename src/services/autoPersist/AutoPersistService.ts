import { usageApi, type AutoPersistUsagePayload } from '@/services/api/usage';
import { CacheLayer } from '@/services/cache';
import type { KeyStats, UsageDetail } from '@/utils/usage';

type UsageStatsSnapshot = Record<string, unknown>;

export type AutoPersistSnapshotInput = {
  scopeKey: string;
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  lastRefreshedAt: number | null;
};

export type AutoPersistBootstrapSnapshot = AutoPersistSnapshotInput & {
  detailCount: number;
};

type AutoPersistCache = AutoPersistBootstrapSnapshot & {
  sessionId: string;
  payload: AutoPersistUsagePayload | null;
  updatedAt: number;
  lastPersistedAt: number | null;
  lastPersistedDetailCount: number;
};

const AUTO_PERSIST_CACHE_PREFIX = 'cli-proxy-usage-auto-persist-v1';
const AUTO_PERSIST_TRIGGER_DELTA = 10;
const AUTO_PERSIST_INTERVAL_MS = 60_000;
const AUTO_PERSIST_START_DELAY_MS = 30_000;
const AUTO_PERSIST_MAX_DETAILS = 5_000;
const AUTO_PERSIST_TRIM_RATIO = 0.2;

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

const createStorageKey = (scopeKey: string) =>
  `${AUTO_PERSIST_CACHE_PREFIX}:${encodeURIComponent(scopeKey)}`;

const createSessionId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const trimUsageDetails = (usageDetails: UsageDetail[]): UsageDetail[] => {
  if (usageDetails.length <= AUTO_PERSIST_MAX_DETAILS) {
    return usageDetails;
  }

  const trimCount = Math.max(
    Math.ceil(usageDetails.length * AUTO_PERSIST_TRIM_RATIO),
    usageDetails.length - AUTO_PERSIST_MAX_DETAILS
  );

  return usageDetails.slice(trimCount);
};

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
    const usageDetails = Array.isArray(parsed.usageDetails)
      ? (parsed.usageDetails as UsageDetail[])
      : [];

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
      usage: null,
      usageDetails: [],
      detailCount: 0,
      payload: null,
      keyStats: createEmptyKeyStats(),
      lastRefreshedAt: null,
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
  private readonly clearedScopeKeys = new Set<string>();
  private startDelayCompleted = false;
  private startTimerId: number | null = null;
  private intervalId: number | null = null;
  private persistInFlight: Promise<void> | null = null;

  readBootstrapSnapshot(scopeKey: string): AutoPersistBootstrapSnapshot | null {
    if (!scopeKey) {
      return null;
    }
    if (this.clearedScopeKeys.has(scopeKey)) {
      return null;
    }

    const cache =
      this.activeScopeKey === scopeKey ? this.currentCache ?? readCache(scopeKey) : readCache(scopeKey);
    if (!cache) {
      return null;
    }

    return {
      scopeKey: cache.scopeKey,
      usage: cache.usage,
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
      this.persistInFlight = null;
    }

    if (options?.removePersisted && scopeKey) {
      this.clearedScopeKeys.add(scopeKey);
      removeCache(scopeKey);
    }
  }

  onUsageRefreshed(input: AutoPersistSnapshotInput) {
    if (!input.scopeKey) {
      return;
    }
    this.clearedScopeKeys.delete(input.scopeKey);

    const previousCache =
      this.activeScopeKey === input.scopeKey ? this.currentCache ?? readCache(input.scopeKey) : readCache(input.scopeKey);
    const nextCache = this.createNextCache(previousCache, input);

    this.activeScopeKey = input.scopeKey;
    this.currentCache = nextCache;
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
    const usageDetails = trimUsageDetails(input.usageDetails);
    const detailCount = incomingDetailCount;
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
        : previousCache?.payload ?? null;

    return {
      scopeKey: input.scopeKey,
      usage,
      keyStats,
      usageDetails,
      lastRefreshedAt,
      detailCount,
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

  private shouldPersist(cache: AutoPersistCache) {
    if (!cache.payload || cache.detailCount <= 0) {
      return false;
    }

    const delta = cache.detailCount - cache.lastPersistedDetailCount;
    if (delta < AUTO_PERSIST_TRIGGER_DELTA) {
      return false;
    }

    if (cache.lastPersistedAt !== null && Date.now() - cache.lastPersistedAt < AUTO_PERSIST_INTERVAL_MS) {
      return false;
    }

    return true;
  }

  private async maybePersist() {
    if (!this.startDelayCompleted || !this.currentCache || !this.shouldPersist(this.currentCache) || this.persistInFlight) {
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
        if (this.clearedScopeKeys.has(cacheToPersist.scopeKey)) {
          removeCache(cacheToPersist.scopeKey);
          return;
        }

        const current =
          this.activeScopeKey === cacheToPersist.scopeKey
            ? this.currentCache ?? readCache(cacheToPersist.scopeKey)
            : readCache(cacheToPersist.scopeKey);
        if (!current) {
          return;
        }

        const nextCache: AutoPersistCache = {
          ...current,
          lastPersistedAt: Date.now(),
          lastPersistedDetailCount: Math.min(current.detailCount, cacheToPersist.detailCount),
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
