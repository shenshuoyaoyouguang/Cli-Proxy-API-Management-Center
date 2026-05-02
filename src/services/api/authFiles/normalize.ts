import type {
  AccountHealthMap,
  AccountHealthState,
  AuthFilesResponse,
  DegradedReason,
} from '@/types/authFile';
import type { OAuthModelAliasEntry } from '@/types';
import { parseTimestampMs } from '@/utils/timestamp';

type StatusError = { status?: number };
type AuthFileBatchFailure = { name: string; error: string };
type AuthFileEntry = AuthFilesResponse['files'][number];

export type { AuthFileBatchFailure, AuthFileEntry };

export const AUTH_FILE_INVALID_JSON_OBJECT_ERROR = 'AUTH_FILE_INVALID_JSON_OBJECT';

export const isAuthFileInvalidJsonObjectError = (err: unknown): boolean =>
  err instanceof Error && err.message === AUTH_FILE_INVALID_JSON_OBJECT_ERROR;

export const getStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  if ('status' in err) return (err as StatusError).status;
  return undefined;
};

export const normalizeRequestedAuthFileNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  names.forEach((name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const normalizeBatchFileNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return normalizeRequestedAuthFileNames(value.map((item) => String(item ?? '')));
};

const normalizeBatchFailures = (value: unknown): AuthFileBatchFailure[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AuthFileBatchFailure[]>((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? '').trim();
    const error =
      typeof entry.error === 'string'
        ? entry.error.trim()
        : typeof entry.message === 'string'
          ? entry.message.trim()
          : '';

    if (!name && !error) return result;
    result.push({ name, error: error || 'Unknown error' });
    return result;
  }, []);
};

const deriveSuccessfulFileNames = (requestedNames: string[], failed: AuthFileBatchFailure[]): string[] => {
  const failedNames = new Set(
    failed
      .map((entry) => entry.name.trim())
      .filter(Boolean)
  );

  if (failedNames.size === 0) {
    return [...requestedNames];
  }

  return requestedNames.filter((name) => !failedNames.has(name));
};

type AuthFileBatchRawResponse = {
  status?: string;
  files?: unknown;
  failed?: unknown;
};

type AuthFileBatchCoreResult = {
  status: string;
  count: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};

const normalizeBatchResponseCore = (
  countFromPayload: number | undefined,
  payload: AuthFileBatchRawResponse | undefined,
  requestedNames: string[]
): AuthFileBatchCoreResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  const count =
    typeof countFromPayload === 'number'
      ? countFromPayload
      : filesFromPayload.length > 0
        ? filesFromPayload.length
        : requestedNames.length === 1 && failed.length === 0
          ? 1
          : 0;

  let resultFiles = filesFromPayload;
  if (resultFiles.length === 0 && count > 0) {
    if (failed.length === 0 && count === requestedNames.length) {
      resultFiles = [...requestedNames];
    } else {
      const derivedNames = deriveSuccessfulFileNames(requestedNames, failed);
      if (derivedNames.length === count) {
        resultFiles = derivedNames;
      }
    }
  }

  return {
    status: typeof payload?.status === 'string' ? payload.status : failed.length > 0 ? 'partial' : 'ok',
    count,
    files: resultFiles,
    failed,
  };
};

type AuthFileBatchUploadResponse = {
  status?: string;
  uploaded?: number;
  files?: unknown;
  failed?: unknown;
};

type AuthFileBatchDeleteResponse = {
  status?: string;
  deleted?: number;
  files?: unknown;
  failed?: unknown;
};

export type { AuthFileBatchUploadResponse, AuthFileBatchDeleteResponse };

type AuthFileBatchUploadResult = {
  status: string;
  uploaded: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};

type AuthFileBatchDeleteResult = {
  status: string;
  deleted: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};

export type { AuthFileBatchUploadResult, AuthFileBatchDeleteResult };

export const normalizeBatchUploadResponse = (
  payload: AuthFileBatchUploadResponse | undefined,
  requestedNames: string[]
): AuthFileBatchUploadResult => {
  const core = normalizeBatchResponseCore(payload?.uploaded, payload, requestedNames);
  return { status: core.status, uploaded: core.count, files: core.files, failed: core.failed };
};

export const normalizeBatchDeleteResponse = (
  payload: AuthFileBatchDeleteResponse | undefined,
  requestedNames: string[]
): AuthFileBatchDeleteResult => {
  const core = normalizeBatchResponseCore(payload?.deleted, payload, requestedNames);
  return { status: core.status, deleted: core.count, files: core.files, failed: core.failed };
};

export const readTextField = (entry: AuthFileEntry, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

export const readDateField = (entry: AuthFileEntry): number => {
  const candidates = [entry['modtime'], entry.modified, entry['updated_at'], entry['last_refresh']];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const isRuntimeOnlyEntry = (entry: AuthFileEntry): boolean => {
  const value = entry['runtime_only'] ?? entry.runtimeOnly;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
};

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const countMeaningfulFields = (entry: AuthFileEntry): number =>
  Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0
  );

const authFilePriorityScore = (entry: AuthFileEntry): number => {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (entry.disabled !== true) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
};

const compareAuthFileEntries = (left: AuthFileEntry, right: AuthFileEntry): number => {
  const scoreDiff = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = readDateField(right) - readDateField(left);
  if (dateDiff !== 0) return dateDiff;

  const fieldDiff = countMeaningfulFields(right) - countMeaningfulFields(left);
  if (fieldDiff !== 0) return fieldDiff;

  return 0;
};

const mergeAuthFileEntries = (entries: AuthFileEntry[]): AuthFileEntry => {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: AuthFileEntry = { ...primary };

  rest.forEach((entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    });
  });

  return merged;
};

export const dedupeAuthFilesResponse = (payload: AuthFilesResponse): AuthFilesResponse => {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const grouped = new Map<string, AuthFileEntry[]>();

  files.forEach((entry) => {
    const name = readTextField(entry, 'name');
    const key = name || JSON.stringify(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    grouped.set(key, [entry]);
  });

  const normalizedFiles = Array.from(grouped.values()).map(mergeAuthFileEntries);
  normalizedFiles.sort((left, right) =>
    readTextField(left, 'name').localeCompare(readTextField(right, 'name'), undefined, {
      sensitivity: 'accent',
    })
  );

  return {
    ...payload,
    files: normalizedFiles,
    total: normalizedFiles.length,
  };
};

export const parseAuthFileJsonObject = (rawText: string): Record<string, unknown> => {
  const trimmed = rawText.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  return { ...(parsed as Record<string, unknown>) };
};

export const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-excluded-models'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, string[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
    const key = String(provider ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;

    const rawList = Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(/[\n,]+/)
        : [];

    const seen = new Set<string>();
    const normalized: string[] = [];
    rawList.forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const modelKey = trimmed.toLowerCase();
      if (seen.has(modelKey)) return;
      seen.add(modelKey);
      normalized.push(trimmed);
    });

    result[key] = normalized;
  });

  return result;
};

export const normalizeOauthModelAlias = (payload: unknown): Record<string, OAuthModelAliasEntry[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source =
    record['oauth-model-alias'] ??
    record.items ??
    payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, OAuthModelAliasEntry[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
    const key = String(channel ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;
    if (!Array.isArray(mappings)) return;

    const seen = new Set<string>();
    const normalized = mappings
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const name = String(entry.name ?? entry.id ?? entry.model ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const fork = entry.fork === true;
        return fork ? { name, alias, fork } : { name, alias };
      })
      .filter(Boolean)
      .filter((entry) => {
        const aliasEntry = entry as OAuthModelAliasEntry;
        const dedupeKey = `${aliasEntry.name.toLowerCase()}::${aliasEntry.alias.toLowerCase()}::${aliasEntry.fork ? '1' : '0'}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      }) as OAuthModelAliasEntry[];

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

const normalizeNumberArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<number[]>((result, item) => {
    const parsed = Number(item);
    if (Number.isFinite(parsed)) {
      result.push(parsed);
    }
    return result;
  }, []);
};

export const normalizeAccountHealthState = (value: unknown): AccountHealthState | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Record<string, unknown>;
  const consecutiveFailures = Number(input.consecutiveFailures ?? input.consecutive_failures);
  const degradedStatus = Number(input.degradedStatus ?? input.degraded_status);
  const degradedAt = Number(input.degradedAt ?? input.degraded_at);
  const cooldownUntil = input.cooldownUntil ?? input.cooldown_until;
  const degradedReason = input.degradedReason ?? input.degraded_reason;
  const degradedMessage = input.degradedMessage ?? input.degraded_message;

  return {
    degraded: input.degraded === true,
    degradedReason:
      typeof degradedReason === 'string' ? (degradedReason as DegradedReason) : undefined,
    degradedStatus: Number.isFinite(degradedStatus) ? degradedStatus : undefined,
    degradedMessage: typeof degradedMessage === 'string' ? degradedMessage : undefined,
    consecutiveFailures: Number.isFinite(consecutiveFailures) ? Math.max(0, consecutiveFailures) : 0,
    failureStatuses: normalizeNumberArray(input.failureStatuses ?? input.failure_statuses),
    degradedAt: Number.isFinite(degradedAt) ? degradedAt : undefined,
    cooldownUntil:
      cooldownUntil === null
        ? null
        : Number.isFinite(Number(cooldownUntil))
          ? Number(cooldownUntil)
          : undefined,
    manualDegraded: input.manualDegraded === true || input.manual_degraded === true,
    stale: input.stale === true,
  };
};

export const normalizeAccountHealthMap = (payload: unknown): AccountHealthMap => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const root = payload as Record<string, unknown>;
  const source = root.health ?? root.items ?? root.data ?? payload;
  if (!source || typeof source !== 'object') {
    return {};
  }

  return Object.entries(source as Record<string, unknown>).reduce<AccountHealthMap>(
    (result, [name, value]) => {
      const normalizedName = String(name ?? '').trim();
      if (!normalizedName) {
        return result;
      }

      const state = normalizeAccountHealthState(value);
      if (!state) {
        return result;
      }

      result[normalizedName] = state;
      return result;
    },
    {}
  );
};
