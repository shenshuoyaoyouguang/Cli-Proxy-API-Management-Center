import { useMemo } from 'react';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState, GeminiCliQuotaState } from '@/types';
import { normalizePlanType, resolveAuthProvider, resolveCodexPlanType } from '@/utils/quota';
import type { SubscriptionTier } from '@/utils/usage/slaCalculator';

interface ResolveUsageSubscriptionTierOptions {
  authFiles: AuthFileItem[];
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
}

const tierRank: Record<SubscriptionTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  enterprise: 3
};

const mapPlanTypeToSubscriptionTier = (planType: string | null | undefined): SubscriptionTier | null => {
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

const mapGeminiTierIdToSubscriptionTier = (tierId: string | null | undefined): SubscriptionTier | null => {
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

export function resolveUsageSubscriptionTier({
  authFiles,
  claudeQuota,
  codexQuota,
  geminiCliQuota
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
          ? mapPlanTypeToSubscriptionTier(codexQuota[file.name]?.planType ?? resolveCodexPlanType(file))
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

export function useUsageSubscriptionTier(authFiles: AuthFileItem[]): SubscriptionTier {
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const geminiCliQuota = useQuotaStore((state) => state.geminiCliQuota);

  return useMemo(
    () =>
      resolveUsageSubscriptionTier({
        authFiles,
        claudeQuota,
        codexQuota,
        geminiCliQuota
      }),
    [authFiles, claudeQuota, codexQuota, geminiCliQuota]
  );
}
