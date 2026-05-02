import { normalizeUsageTokens, extractCanonicalTotalTokens, getCanonicalCachedTokens } from '@/utils/usageTokenNormalizer';
import { parseNumber } from './guards';

export { normalizeUsageTokens, extractCanonicalTotalTokens, getCanonicalCachedTokens };

export interface NormalizedTokens {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  total: number;
}

export function toNormalizedTokens(raw: unknown): NormalizedTokens {
  const canonical = normalizeUsageTokens(raw);
  return {
    input: canonical.input_tokens,
    output: canonical.output_tokens,
    cached: canonical.cached_tokens,
    reasoning: canonical.reasoning_tokens,
    total: canonical.total_tokens,
  };
}

export function getCachedTokenCount(raw: unknown): number {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const primary = parseNumber(record.cached_tokens);
    const alternate = parseNumber(record.cache_tokens);
    if (primary !== null || alternate !== null) {
      return Math.max(primary ?? 0, alternate ?? 0);
    }
  }
  return getCanonicalCachedTokens(raw);
}

export function getTotalTokenCount(raw: unknown): number {
  return extractCanonicalTotalTokens(raw);
}
