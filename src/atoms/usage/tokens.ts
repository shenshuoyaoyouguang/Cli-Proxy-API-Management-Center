import {
  normalizeUsageTokens,
  extractCanonicalTotalTokens,
  getCanonicalCachedTokens,
  type CanonicalUsageTokens,
} from '@/utils/usageTokenNormalizer';
import { isRecord, parseNumber } from '@/utils/usageRecord';

export { normalizeUsageTokens, extractCanonicalTotalTokens, getCanonicalCachedTokens };

const DETAIL_TOKEN_SOURCE_KEYS = [
  'tokens',
  'usage',
  'usage_metadata',
  'usageMetadata',
  'usage_stats',
  'usageStats',
  'token_usage',
  'tokenUsage',
] as const;

const DETAIL_TOKEN_WRAPPER_KEYS = [
  'response',
  'raw_response',
  'rawResponse',
  'result',
  'data',
] as const;

const normalizeEvidenceKey = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .trim();

const TOKEN_EVIDENCE_KEYS = new Set([
  'prompt_tokens',
  'input_tokens',
  'prompt_token_count',
  'input_token_count',
  'completion_tokens',
  'output_tokens',
  'completion_token_count',
  'output_token_count',
  'candidate_token_count',
  'candidates_token_count',
  'response_token_count',
  'responses_token_count',
  'result_token_count',
  'results_token_count',
  'answer_token_count',
  'answers_token_count',
  'cached_tokens',
  'cache_tokens',
  'cached_token_count',
  'cache_token_count',
  'cached_content_token_count',
  'reasoning_tokens',
  'thinking_tokens',
  'thought_tokens',
  'reasoning_token_count',
  'thinking_token_count',
  'thought_token_count',
  'thoughts_token_count',
  'total_tokens',
  'total_token_count',
]);

export interface NormalizedTokens {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  total: number;
}

const pushUniqueCandidate = (candidates: unknown[], value: unknown) => {
  if (value === undefined || value === null || candidates.includes(value)) {
    return;
  }
  candidates.push(value);
};

const appendNestedTokenCandidates = (candidates: unknown[], value: unknown) => {
  if (!isRecord(value)) {
    return;
  }

  DETAIL_TOKEN_SOURCE_KEYS.forEach((key) => {
    pushUniqueCandidate(candidates, value[key]);
  });

  DETAIL_TOKEN_WRAPPER_KEYS.forEach((key) => {
    const wrapper = value[key];
    if (!isRecord(wrapper)) {
      return;
    }
    pushUniqueCandidate(candidates, wrapper);
    DETAIL_TOKEN_SOURCE_KEYS.forEach((nestedKey) => {
      pushUniqueCandidate(candidates, wrapper[nestedKey]);
    });
  });
};

const compareCanonicalUsageTokens = (
  left: CanonicalUsageTokens,
  right: CanonicalUsageTokens
): number => {
  const leftPositiveFamilies = [
    left.input_tokens,
    left.output_tokens,
    left.cached_tokens,
    left.reasoning_tokens,
  ].filter((value) => value > 0).length;
  const rightPositiveFamilies = [
    right.input_tokens,
    right.output_tokens,
    right.cached_tokens,
    right.reasoning_tokens,
  ].filter((value) => value > 0).length;

  if (leftPositiveFamilies !== rightPositiveFamilies) {
    return leftPositiveFamilies - rightPositiveFamilies;
  }

  if (left.total_tokens !== right.total_tokens) {
    return left.total_tokens - right.total_tokens;
  }

  const leftBreakdownTotal =
    left.input_tokens + left.output_tokens + left.cached_tokens + left.reasoning_tokens;
  const rightBreakdownTotal =
    right.input_tokens + right.output_tokens + right.cached_tokens + right.reasoning_tokens;

  return leftBreakdownTotal - rightBreakdownTotal;
};

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

export function normalizeUsageDetailTokens(raw: unknown): CanonicalUsageTokens {
  const candidates: unknown[] = [];
  pushUniqueCandidate(candidates, raw);
  appendNestedTokenCandidates(candidates, raw);

  let best: CanonicalUsageTokens | null = null;

  candidates.forEach((candidate) => {
    const normalized = normalizeUsageTokens(candidate);
    if (!best || compareCanonicalUsageTokens(normalized, best) > 0) {
      best = normalized;
    }
  });

  return best ?? normalizeUsageTokens(raw);
}

export function hasUsageTokenEvidence(raw: unknown): boolean {
  const candidates: unknown[] = [];
  pushUniqueCandidate(candidates, raw);
  appendNestedTokenCandidates(candidates, raw);

  return candidates.some((candidate) => {
    if (!isRecord(candidate)) {
      return false;
    }

    return Object.keys(candidate).some((key) => TOKEN_EVIDENCE_KEYS.has(normalizeEvidenceKey(key)));
  });
}

export function getUsageDetailTotalTokenCount(raw: unknown): number {
  return normalizeUsageDetailTokens(raw).total_tokens;
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
