import type { RateStats, TokenBreakdown } from '@/atoms/usage/types';
import { isRecord, getApisRecord } from '@/atoms/usage/guards';
import { getDetailTimestampMs } from '@/atoms/usage/time';
import { getUsageDetailTotalTokenCount } from '@/atoms/usage/tokens';
import { collectUsageDetails } from '@/molecules/usage/collectDetails';

export function extractTotalTokens(detail: unknown): number {
  return getUsageDetailTotalTokenCount(detail);
}

export function calculateTokenBreakdown(usageData: unknown): TokenBreakdown {
  const details = collectUsageDetails(usageData);
  if (!details.length) {
    return { cachedTokens: 0, reasoningTokens: 0 };
  }

  let cachedTokens = 0;
  let reasoningTokens = 0;

  details.forEach((detail) => {
    const tokens = detail.tokens;
    const cachedValue = typeof tokens?.cached_tokens === 'number' && tokens.cached_tokens > 0
      ? tokens.cached_tokens
      : (typeof tokens?.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0);
    cachedTokens += cachedValue;
    if (typeof tokens?.reasoning_tokens === 'number') {
      reasoningTokens += tokens.reasoning_tokens;
    }
  });

  return { cachedTokens, reasoningTokens };
}

export function calculateRecentPerMinuteRates(
  windowMinutes: number = 30,
  usageData: unknown
): RateStats {
  const details = collectUsageDetails(usageData);
  const effectiveWindow = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : 30;

  if (!details.length) {
    return { rpm: 0, tpm: 0, windowMinutes: effectiveWindow, requestCount: 0, tokenCount: 0 };
  }

  const now = Date.now();
  const windowStart = now - effectiveWindow * 60 * 1000;
  let requestCount = 0;
  let tokenCount = 0;

  details.forEach((detail) => {
    const timestamp = getDetailTimestampMs(detail);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) {
      return;
    }
    requestCount += 1;
    tokenCount += extractTotalTokens(detail);
  });

  const denominator = effectiveWindow > 0 ? effectiveWindow : 1;
  return {
    rpm: requestCount / denominator,
    tpm: tokenCount / denominator,
    windowMinutes: effectiveWindow,
    requestCount,
    tokenCount,
  };
}

export function getModelNamesFromUsage(usageData: unknown): string[] {
  const apis = getApisRecord(usageData);
  if (!apis) return [];
  const names = new Set<string>();
  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;
    Object.keys(models).forEach((modelName) => {
      if (modelName) {
        names.add(modelName);
      }
    });
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
