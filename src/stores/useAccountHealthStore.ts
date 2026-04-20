import { create } from 'zustand';
import { authFilesApi } from '@/services/api';
import type { AccountHealthMap, AccountHealthState, DegradedReason } from '@/types';

type HealthScopeInput = {
  apiBase: string;
  managementKey: string;
};

export type AccountHealthBatchResult = {
  name: string;
  status: 'success' | 'error';
  errorStatus?: number;
  error?: string;
};

type AccountHealthStoreState = {
  healthMap: AccountHealthMap;
  scopeKey: string;
  revision: number;
  loadHealthMap: (scope?: HealthScopeInput | null) => Promise<AccountHealthMap>;
  clearHealthMap: () => void;
  removeAccounts: (names: string[]) => void;
  reportFailure: (name: string, status?: number, message?: string) => Promise<void>;
  reportBatchResults: (results: AccountHealthBatchResult[]) => Promise<void>;
  isAccountDegraded: (name: string) => boolean;
  getAccountHealth: (name: string) => AccountHealthState | undefined;
  recoverAccount: (name: string) => Promise<void>;
};

let healthLoadRequestToken = 0;

const ACCOUNT_HEALTH_STORAGE_PREFIX = 'cli-proxy-account-health-v1';
const ACCOUNT_FAILURE_THRESHOLD = 3;
const ACCOUNT_FAILURE_STATUS_LIMIT = 6;
const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;
const SERVER_ERROR_COOLDOWN_MS = 15 * 60 * 1000;
const TIMEOUT_COOLDOWN_MS = 10 * 60 * 1000;
const SERVER_ERROR_STATUSES = new Set([500, 502, 503, 504]);
const TIMEOUT_MESSAGE_PATTERN = /\b(timeout|timed out|abort(?:ed)?|network error)\b/i;

const shouldIgnoreFailureForHealth = (status: number | undefined, message: string | undefined) => {
  if (status === 404) {
    return true;
  }

  const normalizedMessage = typeof message === 'string' ? message.trim().toLowerCase() : '';
  return normalizedMessage.includes('quota_update_required');
};

const hashScopeSegment = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildScopeKey = (apiBase: string, managementKey: string) =>
  `${apiBase}::${hashScopeSegment(managementKey)}`;

const createStorageKey = (scopeKey: string) =>
  `${ACCOUNT_HEALTH_STORAGE_PREFIX}:${encodeURIComponent(scopeKey)}`;

const normalizeHealthMap = (value: unknown): AccountHealthMap => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<AccountHealthMap>((result, entry) => {
    const [name, state] = entry;
    const normalizedName = String(name ?? '').trim();
    if (!normalizedName || !state || typeof state !== 'object') {
      return result;
    }

    result[normalizedName] = state as AccountHealthState;
    return result;
  }, {});
};

const readPersistedHealthMap = (scopeKey: string): AccountHealthMap => {
  if (typeof localStorage === 'undefined' || !scopeKey) {
    return {};
  }

  try {
    const raw = localStorage.getItem(createStorageKey(scopeKey));
    if (!raw) {
      return {};
    }

    return normalizeHealthMap(JSON.parse(raw));
  } catch {
    return {};
  }
};

const writePersistedHealthMap = (scopeKey: string, healthMap: AccountHealthMap) => {
  if (typeof localStorage === 'undefined' || !scopeKey) {
    return;
  }

  try {
    localStorage.setItem(createStorageKey(scopeKey), JSON.stringify(healthMap));
  } catch {
    // Ignore local fallback persistence failures.
  }
};

const updateState = (
  set: (
    partial:
      | Partial<AccountHealthStoreState>
      | ((state: AccountHealthStoreState) => Partial<AccountHealthStoreState>)
  ) => void,
  scopeKey: string,
  healthMap: AccountHealthMap
) => {
  writePersistedHealthMap(scopeKey, healthMap);
  set((state) => ({
    healthMap,
    scopeKey,
    revision: state.revision + 1,
  }));
};

const isHealthCooldownActive = (state: AccountHealthState | undefined, now: number = Date.now()) => {
  if (!state?.degraded) {
    return false;
  }

  if (state.cooldownUntil === null || state.cooldownUntil === undefined) {
    return true;
  }

  return state.cooldownUntil > now;
};

const isHealthBlockedOrStale = (state: AccountHealthState | undefined, now: number = Date.now()) =>
  Boolean(
    state?.stale === true ||
      isHealthCooldownActive(state, now) ||
      (state?.degraded &&
        state.cooldownUntil !== null &&
        state.cooldownUntil !== undefined &&
        state.cooldownUntil <= now)
  );

const resolveFailureOutcome = (
  status: number | undefined,
  message: string | undefined,
  now: number
): Pick<AccountHealthState, 'degradedReason' | 'degradedStatus' | 'degradedMessage' | 'cooldownUntil'> => {
  const normalizedMessage = typeof message === 'string' ? message.trim() : '';

  if (status === 401) {
    return {
      degradedReason: '401_unauthorized',
      degradedStatus: 401,
      degradedMessage: normalizedMessage || '401 unauthorized',
      cooldownUntil: null,
    };
  }

  if (status === 403) {
    return {
      degradedReason: '403_forbidden',
      degradedStatus: 403,
      degradedMessage: normalizedMessage || '403 forbidden',
      cooldownUntil: null,
    };
  }

  if (status === 429) {
    return {
      degradedReason: '429_rate_limited',
      degradedStatus: 429,
      degradedMessage: normalizedMessage || '429 rate limited',
      cooldownUntil: now + RATE_LIMIT_COOLDOWN_MS,
    };
  }

  if (status !== undefined && SERVER_ERROR_STATUSES.has(status)) {
    return {
      degradedReason: 'server_error',
      degradedStatus: status,
      degradedMessage: normalizedMessage || `HTTP ${status}`,
      cooldownUntil: now + SERVER_ERROR_COOLDOWN_MS,
    };
  }

  if (normalizedMessage && TIMEOUT_MESSAGE_PATTERN.test(normalizedMessage)) {
    return {
      degradedReason: 'timeout',
      degradedStatus: status,
      degradedMessage: normalizedMessage,
      cooldownUntil: now + TIMEOUT_COOLDOWN_MS,
    };
  }

  return {
    degradedReason: 'server_error',
    degradedStatus: status,
    degradedMessage: normalizedMessage || (status ? `HTTP ${status}` : 'unknown error'),
    cooldownUntil: now + SERVER_ERROR_COOLDOWN_MS,
  };
};

const createFailureState = (
  current: AccountHealthState | undefined,
  status: number | undefined,
  message: string | undefined
): AccountHealthState => {
  const now = Date.now();
  const consecutiveFailures = Math.max(0, current?.consecutiveFailures ?? 0) + 1;
  const failureStatuses = [...(current?.failureStatuses ?? [])];
  if (typeof status === 'number' && Number.isFinite(status)) {
    failureStatuses.push(status);
  }

  const limitedStatuses = failureStatuses.slice(-ACCOUNT_FAILURE_STATUS_LIMIT);
  const shouldDegrade = current?.degraded === true || consecutiveFailures >= ACCOUNT_FAILURE_THRESHOLD;
  const degradedFields = shouldDegrade
    ? resolveFailureOutcome(status, message, now)
    : {
        degradedReason: current?.degradedReason,
        degradedStatus: current?.degradedStatus,
        degradedMessage: current?.degradedMessage,
        cooldownUntil: current?.cooldownUntil,
      };

  return {
    degraded: shouldDegrade,
    degradedReason: degradedFields.degradedReason as DegradedReason | undefined,
    degradedStatus: degradedFields.degradedStatus,
    degradedMessage: degradedFields.degradedMessage,
    consecutiveFailures,
    failureStatuses: limitedStatuses,
    degradedAt: shouldDegrade ? current?.degradedAt ?? now : current?.degradedAt,
    cooldownUntil: shouldDegrade ? degradedFields.cooldownUntil : undefined,
    manualDegraded: current?.manualDegraded === true,
    stale:
      shouldDegrade &&
      degradedFields.cooldownUntil !== null &&
      degradedFields.cooldownUntil !== undefined &&
      degradedFields.cooldownUntil <= now,
  };
};

const persistHealthUpdates = async (
  updates: Record<string, AccountHealthState | null>,
  recoverName?: string
) => {
  if (!recoverName) {
    await authFilesApi.updateAccountHealth(updates);
    return;
  }

  try {
    await authFilesApi.recoverAccount(recoverName);
  } catch (recoverError) {
    try {
      await authFilesApi.updateAccountHealth({ [recoverName]: null });
    } catch (fallbackError) {
      if (fallbackError instanceof Error) {
        throw fallbackError;
      }
      if (recoverError instanceof Error) {
        throw recoverError;
      }
      throw new Error('Failed to persist account health recovery');
    }
  }
};

export const useAccountHealthStore = create<AccountHealthStoreState>((set, get) => ({
  healthMap: {},
  scopeKey: '',
  revision: 0,

  loadHealthMap: async (scope) => {
    const requestId = (healthLoadRequestToken += 1);
    const scopeKey =
      scope?.apiBase && scope?.managementKey ? buildScopeKey(scope.apiBase, scope.managementKey) : '';
    if (!scopeKey) {
      if (requestId === healthLoadRequestToken) {
        updateState(set, '', {});
      }
      return {};
    }

    try {
      const remoteMap = await authFilesApi.getAccountHealth();
      if (requestId !== healthLoadRequestToken) {
        return get().scopeKey === scopeKey ? get().healthMap : {};
      }
      updateState(set, scopeKey, remoteMap);
      return remoteMap;
    } catch {
      const fallbackMap = readPersistedHealthMap(scopeKey);
      if (requestId !== healthLoadRequestToken) {
        return get().scopeKey === scopeKey ? get().healthMap : fallbackMap;
      }
      updateState(set, scopeKey, fallbackMap);
      return fallbackMap;
    }
  },

  clearHealthMap: () => {
    healthLoadRequestToken += 1;
    set((state) => ({
      healthMap: {},
      scopeKey: '',
      revision: state.revision + 1,
    }));
  },

  removeAccounts: (names) => {
    const normalizedNames = Array.from(
      new Set(
        names
          .map((name) => String(name ?? '').trim())
          .filter(Boolean)
      )
    );
    if (normalizedNames.length === 0) {
      return;
    }

    const { scopeKey, healthMap } = get();
    const nextMap: AccountHealthMap = { ...healthMap };
    let changed = false;

    normalizedNames.forEach((name) => {
      if (name in nextMap) {
        delete nextMap[name];
        changed = true;
      }
    });

    if (!changed) {
      return;
    }

    updateState(set, scopeKey, nextMap);
  },

  reportFailure: async (name, status, message) => {
    const normalizedName = String(name ?? '').trim();
    const { scopeKey, healthMap } = get();
    if (!scopeKey || !normalizedName) {
      return;
    }
    if (shouldIgnoreFailureForHealth(status, message)) {
      return;
    }

    const nextState = createFailureState(healthMap[normalizedName], status, message);
    await persistHealthUpdates({ [normalizedName]: nextState });
    if (get().scopeKey !== scopeKey) {
      return;
    }
    updateState(set, scopeKey, {
      ...get().healthMap,
      [normalizedName]: nextState,
    });
  },

  reportBatchResults: async (results) => {
    const { scopeKey, healthMap } = get();
    if (!scopeKey || results.length === 0) {
      return;
    }

    const nextMap: AccountHealthMap = { ...healthMap };
    const failureUpdates: Record<string, AccountHealthState> = {};
    const removalUpdates: Record<string, null> = {};
    let hasPersistedFailureChanges = false;
    let hasPersistedRemovalChanges = false;
    let firstPersistError: unknown = null;

    results.forEach((result) => {
      const normalizedName = String(result.name ?? '').trim();
      if (!normalizedName) {
        return;
      }

      if (result.status === 'success') {
        if (normalizedName in nextMap) {
          delete nextMap[normalizedName];
          removalUpdates[normalizedName] = null;
        }
        return;
      }
      if (shouldIgnoreFailureForHealth(result.errorStatus, result.error)) {
        return;
      }

      const nextState = createFailureState(nextMap[normalizedName], result.errorStatus, result.error);
      nextMap[normalizedName] = nextState;
      failureUpdates[normalizedName] = nextState;
    });

    if (Object.keys(failureUpdates).length === 0 && Object.keys(removalUpdates).length === 0) {
      return;
    }

    if (Object.keys(failureUpdates).length > 0) {
      try {
        await persistHealthUpdates(failureUpdates);
        hasPersistedFailureChanges = true;
      } catch (error) {
        firstPersistError = error;
      }
    }

    if (Object.keys(removalUpdates).length > 0) {
      try {
        await persistHealthUpdates(removalUpdates);
        hasPersistedRemovalChanges = true;
      } catch (error) {
        firstPersistError ??= error;
      }
    }

    if (get().scopeKey === scopeKey && (hasPersistedFailureChanges || hasPersistedRemovalChanges)) {
      const currentMap = { ...get().healthMap };
      if (hasPersistedRemovalChanges) {
        Object.keys(removalUpdates).forEach((name) => {
          delete currentMap[name];
        });
      }
      if (hasPersistedFailureChanges) {
        Object.entries(failureUpdates).forEach(([name, state]) => {
          currentMap[name] = state;
        });
      }
      updateState(set, scopeKey, currentMap);
    }

    if (firstPersistError) {
      throw firstPersistError;
    }
  },

  isAccountDegraded: (name) => isHealthBlockedOrStale(get().healthMap[name]),

  getAccountHealth: (name) => get().healthMap[name],

  recoverAccount: async (name) => {
    const normalizedName = String(name ?? '').trim();
    const { scopeKey, healthMap } = get();
    if (!scopeKey || !normalizedName) {
      return;
    }

    if (!(normalizedName in healthMap)) {
      return;
    }

    const previousState = healthMap[normalizedName];
    const nextMap = { ...healthMap };
    delete nextMap[normalizedName];
    updateState(set, scopeKey, nextMap);
    try {
      await persistHealthUpdates({ [normalizedName]: null }, normalizedName);
    } catch (error) {
      if (get().scopeKey === scopeKey) {
        updateState(set, scopeKey, {
          ...get().healthMap,
          [normalizedName]: previousState,
        });
      }
      throw error;
    }
  },
}));

export {
  ACCOUNT_FAILURE_THRESHOLD,
  RATE_LIMIT_COOLDOWN_MS,
  SERVER_ERROR_COOLDOWN_MS,
  TIMEOUT_COOLDOWN_MS,
  buildScopeKey as buildAccountHealthScopeKey,
  isHealthCooldownActive as isAccountHealthCooldownActive,
  isHealthBlockedOrStale as isAccountHealthBlockedOrStale,
  shouldIgnoreFailureForHealth as shouldIgnoreAccountHealthFailure,
};
