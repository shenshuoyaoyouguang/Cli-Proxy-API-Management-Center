import { useEffect, useMemo, useState } from 'react';
import { apiCallApi } from '@/services/api';
import { useAuthStore, useQuotaStore } from '@/stores';
import type {
  AuthFileItem,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  CodexQuotaState,
  CodexUsagePayload,
  GeminiCliCodeAssistPayload,
  GeminiCliQuotaState,
} from '@/types';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_REQUEST_HEADERS,
  CODEX_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  GEMINI_CLI_CODE_ASSIST_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  normalizeAuthIndex,
  normalizePlanType,
  normalizeStringValue,
  parseCodexUsagePayload,
  parseGeminiCliCodeAssistPayload,
  resolveAuthProvider,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveGeminiCliProjectId,
} from '@/utils/quota';
import type { SubscriptionTier } from '@/utils/usage/slaCalculator';

interface ResolveUsageSubscriptionTierOptions {
  authFiles: AuthFileItem[];
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
}

interface UseUsageSubscriptionTierResult {
  subscriptionTier: SubscriptionTier;
  loading: boolean;
}

interface RemoteTierState {
  claudePlanTypes: Record<string, string | null>;
  codexPlanTypes: Record<string, string | null>;
  geminiTierIds: Record<string, string | null>;
}

const tierRank: Record<SubscriptionTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  enterprise: 3,
};

const emptyRemoteTierState = (): RemoteTierState => ({
  claudePlanTypes: {},
  codexPlanTypes: {},
  geminiTierIds: {},
});

const remoteTierCache = new Map<string, RemoteTierState>();

const buildAuthFileScopeSignature = (file: AuthFileItem): string => {
  const provider = resolveAuthProvider(file);
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  const codexAccountId = provider === 'codex' ? resolveCodexChatgptAccountId(file) : null;
  const codexPlanType = provider === 'codex' ? resolveCodexPlanType(file) : null;
  const geminiProjectId = provider === 'gemini-cli' ? resolveGeminiCliProjectId(file) : null;

  return [
    file.name,
    provider,
    authIndex ?? '',
    file.modified ?? '',
    file.lastRefresh ?? '',
    file.disabled === true ? 'disabled' : 'enabled',
    codexAccountId ?? '',
    codexPlanType ?? '',
    geminiProjectId ?? '',
  ].join('|');
};

const buildUsageSubscriptionTierScopeKey = (
  authFiles: AuthFileItem[],
  apiBase: string | null | undefined,
  managementKey: string | null | undefined
): string =>
  [
    apiBase || '',
    managementKey || '',
    authFiles.map(buildAuthFileScopeSignature).sort().join('||'),
  ].join('::');

const mergeRemoteTierState = (
  previous: RemoteTierState,
  results: Array<{ fileName: string; provider: string; value: string | null }>
): RemoteTierState => {
  let changed = false;
  const next: RemoteTierState = {
    claudePlanTypes: { ...previous.claudePlanTypes },
    codexPlanTypes: { ...previous.codexPlanTypes },
    geminiTierIds: { ...previous.geminiTierIds },
  };

  results.forEach(({ fileName, provider, value }) => {
    if (!value) {
      return;
    }

    if (provider === 'claude') {
      if (next.claudePlanTypes[fileName] !== value) {
        next.claudePlanTypes[fileName] = value;
        changed = true;
      }
      return;
    }

    if (provider === 'codex') {
      if (next.codexPlanTypes[fileName] !== value) {
        next.codexPlanTypes[fileName] = value;
        changed = true;
      }
      return;
    }

    if (provider === 'gemini-cli' && next.geminiTierIds[fileName] !== value) {
      next.geminiTierIds[fileName] = value;
      changed = true;
    }
  });

  return changed ? next : previous;
};

export const usageSubscriptionTierTestUtils = {
  buildUsageSubscriptionTierScopeKey,
  mergeRemoteTierState,
};

const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';
  return null;
};

const resolveGeminiCliTierId = (payload: GeminiCliCodeAssistPayload | null): string | null => {
  if (!payload) return null;
  const currentTier = payload.currentTier ?? payload.current_tier;
  const paidTier = payload.paidTier ?? payload.paid_tier;
  const rawId = normalizeStringValue(paidTier?.id) ?? normalizeStringValue(currentTier?.id);
  return rawId ? rawId.toLowerCase() : null;
};

const mapPlanTypeToSubscriptionTier = (
  planType: string | null | undefined
): SubscriptionTier | null => {
  const normalized = normalizePlanType(planType);
  switch (normalized) {
    case 'free':
    case 'plan_free':
      return 'free';
    case 'legacy':
    case 'standard':
    case 'plus':
      return 'basic';
    case 'pro':
    case 'plan_pro':
      return 'pro';
    case 'team':
    case 'max':
    case 'ultra':
    case 'plan_max':
    case 'enterprise':
      return 'enterprise';
    default:
      return null;
  }
};

const mapGeminiTierIdToSubscriptionTier = (
  tierId: string | null | undefined
): SubscriptionTier | null => {
  switch ((tierId ?? '').trim().toLowerCase()) {
    case 'free-tier':
      return 'free';
    case 'legacy-tier':
    case 'standard-tier':
      return 'basic';
    case 'g1-pro-tier':
      return 'pro';
    case 'g1-ultra-tier':
      return 'enterprise';
    default:
      return null;
  }
};

const pickHigherTier = (left: SubscriptionTier, right: SubscriptionTier): SubscriptionTier =>
  tierRank[right] > tierRank[left] ? right : left;

const createSyntheticClaudeQuota = (
  quotas: Record<string, ClaudeQuotaState>,
  remotePlanTypes: Record<string, string | null>
): Record<string, ClaudeQuotaState> => ({
  ...quotas,
  ...Object.fromEntries(
    Object.entries(remotePlanTypes).map(([name, planType]) => [
      name,
      {
        ...(quotas[name] ?? { status: 'success', windows: [] }),
        planType,
      },
    ])
  ),
});

const createSyntheticCodexQuota = (
  quotas: Record<string, CodexQuotaState>,
  remotePlanTypes: Record<string, string | null>
): Record<string, CodexQuotaState> => ({
  ...quotas,
  ...Object.fromEntries(
    Object.entries(remotePlanTypes).map(([name, planType]) => [
      name,
      {
        ...(quotas[name] ?? { status: 'success', windows: [] }),
        planType,
      },
    ])
  ),
});

const createSyntheticGeminiQuota = (
  quotas: Record<string, GeminiCliQuotaState>,
  remoteTierIds: Record<string, string | null>
): Record<string, GeminiCliQuotaState> => ({
  ...quotas,
  ...Object.fromEntries(
    Object.entries(remoteTierIds).map(([name, tierId]) => [
      name,
      {
        ...(quotas[name] ?? { status: 'success', buckets: [] }),
        tierId,
      },
    ])
  ),
});

const fetchClaudePlanType = async (file: AuthFileItem): Promise<string | null> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) return null;

  try {
    const result = await apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      return null;
    }

    return resolveClaudePlanType(parseClaudeProfilePayload(result.body ?? result.bodyText));
  } catch {
    return null;
  }
};

const fetchCodexPlanType = async (file: AuthFileItem): Promise<string | null> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  const accountId = resolveCodexChatgptAccountId(file);
  if (!authIndex || !accountId) return null;

  try {
    const result = await apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CODEX_USAGE_URL,
      header: {
        ...CODEX_REQUEST_HEADERS,
        'Chatgpt-Account-Id': accountId,
      },
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      return null;
    }

    const payload = parseCodexUsagePayload(
      result.body ?? result.bodyText
    ) as CodexUsagePayload | null;
    return normalizePlanType(payload?.plan_type ?? payload?.planType);
  } catch {
    return null;
  }
};

const fetchGeminiTierId = async (file: AuthFileItem): Promise<string | null> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  const projectId = resolveGeminiCliProjectId(file);
  if (!authIndex || !projectId) return null;

  try {
    const result = await apiCallApi.request({
      authIndex,
      method: 'POST',
      url: GEMINI_CLI_CODE_ASSIST_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify({
        cloudaicompanionProject: projectId,
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
          duetProject: projectId,
        },
      }),
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      return null;
    }

    return resolveGeminiCliTierId(parseGeminiCliCodeAssistPayload(result.body ?? result.bodyText));
  } catch {
    return null;
  }
};

export function resolveUsageSubscriptionTier({
  authFiles,
  claudeQuota,
  codexQuota,
  geminiCliQuota,
}: ResolveUsageSubscriptionTierOptions): SubscriptionTier {
  const candidates = authFiles.reduce<SubscriptionTier[]>((result, file) => {
    if (file.disabled === true) {
      return result;
    }

    const provider = resolveAuthProvider(file);
    const resolvedTier =
      provider === 'claude'
        ? mapPlanTypeToSubscriptionTier(claudeQuota[file.name]?.planType)
        : provider === 'codex'
          ? mapPlanTypeToSubscriptionTier(
              codexQuota[file.name]?.planType ?? resolveCodexPlanType(file)
            )
          : provider === 'gemini-cli'
            ? mapGeminiTierIdToSubscriptionTier(geminiCliQuota[file.name]?.tierId)
            : null;

    if (resolvedTier) {
      result.push(resolvedTier);
    }

    return result;
  }, []);

  if (candidates.length === 0) {
    return 'free';
  }

  return candidates.reduce(pickHigherTier, candidates[0]);
}

export function useUsageSubscriptionTier(
  authFiles: AuthFileItem[]
): UseUsageSubscriptionTierResult {
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const geminiCliQuota = useQuotaStore((state) => state.geminiCliQuota);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const scopeKey = useMemo(
    () => buildUsageSubscriptionTierScopeKey(authFiles, apiBase, managementKey),
    [apiBase, authFiles, managementKey]
  );
  const authFilesForRemoteTier = useMemo(() => authFiles, [scopeKey]);

  const [remoteTiers, setRemoteTiers] = useState<RemoteTierState>(
    () => remoteTierCache.get(scopeKey) ?? emptyRemoteTierState()
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to internal state
    setRemoteTiers(remoteTierCache.get(scopeKey) ?? emptyRemoteTierState());
    setLoading(false);
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;

    const missingTargets = authFilesForRemoteTier.filter((file) => {
      if (file.disabled === true) {
        return false;
      }

      const provider = resolveAuthProvider(file);
      if (provider === 'claude') {
        return !claudeQuota[file.name]?.planType && !hasOwn(remoteTiers.claudePlanTypes, file.name);
      }

      if (provider === 'codex') {
        return (
          !codexQuota[file.name]?.planType &&
          !resolveCodexPlanType(file) &&
          !hasOwn(remoteTiers.codexPlanTypes, file.name)
        );
      }

      if (provider === 'gemini-cli') {
        return !geminiCliQuota[file.name]?.tierId && !hasOwn(remoteTiers.geminiTierIds, file.name);
      }

      return false;
    });

    if (missingTargets.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to internal state
    setLoading(true);

    void Promise.all(
      missingTargets.map(async (file) => {
        const provider = resolveAuthProvider(file);
        const value =
          provider === 'claude'
            ? await fetchClaudePlanType(file)
            : provider === 'codex'
              ? await fetchCodexPlanType(file)
              : provider === 'gemini-cli'
                ? await fetchGeminiTierId(file)
                : null;

        return { fileName: file.name, provider, value };
      })
    )
      .then((results) => {
        if (cancelled) return;

        setRemoteTiers((previous) => {
          const next = mergeRemoteTierState(previous, results);
          if (next !== previous) {
            remoteTierCache.set(scopeKey, next);
          }
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFilesForRemoteTier, claudeQuota, codexQuota, geminiCliQuota, remoteTiers, scopeKey]);

  const mergedClaudeQuota = useMemo(
    () => createSyntheticClaudeQuota(claudeQuota, remoteTiers.claudePlanTypes),
    [claudeQuota, remoteTiers.claudePlanTypes]
  );
  const mergedCodexQuota = useMemo(
    () => createSyntheticCodexQuota(codexQuota, remoteTiers.codexPlanTypes),
    [codexQuota, remoteTiers.codexPlanTypes]
  );
  const mergedGeminiQuota = useMemo(
    () => createSyntheticGeminiQuota(geminiCliQuota, remoteTiers.geminiTierIds),
    [geminiCliQuota, remoteTiers.geminiTierIds]
  );

  const subscriptionTier = useMemo(
    () =>
      resolveUsageSubscriptionTier({
        authFiles,
        claudeQuota: mergedClaudeQuota,
        codexQuota: mergedCodexQuota,
        geminiCliQuota: mergedGeminiQuota,
      }),
    [authFiles, mergedClaudeQuota, mergedCodexQuota, mergedGeminiQuota]
  );

  return {
    subscriptionTier,
    loading,
  };
}
