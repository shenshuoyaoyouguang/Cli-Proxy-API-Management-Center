export interface CanonicalUsageTokens {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_tokens: number;
  total_tokens: number;
}

type TokenFamily = 'input' | 'output' | 'reasoning' | 'cached' | 'total';
type CandidateKind = 'aggregate' | 'component';

interface TokenCandidate {
  family: TokenFamily;
  kind: CandidateKind;
  value: number;
  score: number;
  depth: number;
  key: string;
  path: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toNonNegativeFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(value, 0) : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : null;
  }
  return null;
};

const splitIntoSegments = (value: string): string[] =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .split('_')
    .map((segment) => segment.trim())
    .filter(Boolean);

const normalizeKey = (value: string): string => splitIntoSegments(value).join('_');

const hasAny = (segments: string[], words: readonly string[]) =>
  words.some((word) => segments.includes(word));

const isCountLikePath = (segments: string[]) =>
  hasAny(segments, ['token', 'tokens', 'count', 'counts', 'prompt', 'completion']);

const flattenNumericLeaves = (
  value: unknown,
  path: string[] = [],
  result: Array<{ path: string[]; value: number }> = [],
  depth = 0
): Array<{ path: string[]; value: number }> => {
  if (depth > 8) {
    return result;
  }

  const numeric = toNonNegativeFiniteNumber(value);
  if (numeric !== null) {
    result.push({ path, value: numeric });
    return result;
  }

  if (!isRecord(value)) {
    return result;
  }

  Object.entries(value).forEach(([key, nested]) => {
    flattenNumericLeaves(nested, [...path, key], result, depth + 1);
  });

  return result;
};

const NEGATIVE_OUTPUT_SEGMENTS = ['prompt', 'input', 'cache', 'cached', 'reasoning', 'thinking', 'thought'] as const;
const NEGATIVE_INPUT_SEGMENTS = ['completion', 'output', 'generated', 'generation', 'response', 'candidate', 'reasoning', 'thinking', 'thought'] as const;
const NEGATIVE_TOTAL_SEGMENTS = ['rate', 'rpm', 'tpm', 'limit', 'remaining', 'max', 'quota'] as const;

const classifyPath = (path: string[], value: number): TokenCandidate[] => {
  if (!path.length) {
    return [];
  }

  const rawLeaf = path[path.length - 1];
  const leaf = normalizeKey(rawLeaf);
  const pathKeys = path.map(normalizeKey);
  const segments = pathKeys.flatMap(splitIntoSegments);
  const depth = path.length;

  const candidates: TokenCandidate[] = [];
  const countLike = isCountLikePath(segments) || isCountLikePath(splitIntoSegments(rawLeaf));

  if (!countLike) {
    return candidates;
  }

  const push = (family: TokenFamily, kind: CandidateKind, score: number) => {
    candidates.push({
      family,
      kind,
      value,
      score,
      depth,
      key: leaf,
      path: pathKeys,
    });
  };

  const hasCacheReadSignal =
    leaf.includes('cache_read') ||
    (hasAny(segments, ['cache', 'cached']) && hasAny(segments, ['read', 'hit', 'reuse']));

  const hasCacheCreateSignal =
    leaf.includes('cache_creation') ||
    (hasAny(segments, ['cache']) && hasAny(segments, ['creation', 'create', 'write', 'populate']));

  const hasReasoningSignal = hasAny(segments, ['reasoning', 'thinking', 'thought']);
  const hasPromptSignal = hasAny(segments, ['prompt', 'input']);
  const hasCompletionSignal = hasAny(segments, [
    'completion',
    'output',
    'generated',
    'generation',
    'response',
    'candidate',
  ]);

  if (hasAny(segments, NEGATIVE_TOTAL_SEGMENTS)) {
    // noop
  } else if (hasAny(segments, ['total']) && countLike) {
    push('total', 'aggregate', leaf === 'total_tokens' ? 120 : 100);
  }

  if (leaf === 'reasoning_tokens' || leaf === 'thinking_tokens' || leaf === 'thought_tokens') {
    push('reasoning', 'aggregate', 120);
  } else if (hasReasoningSignal) {
    push('reasoning', 'aggregate', 95);
  }

  if (leaf === 'cached_tokens' || leaf === 'cache_tokens') {
    push('cached', 'aggregate', 120);
  } else if (hasCacheReadSignal) {
    push('cached', 'aggregate', 110);
  } else if (
    hasAny(segments, ['cache', 'cached']) &&
    !hasCacheCreateSignal &&
    !hasReasoningSignal &&
    !hasCompletionSignal
  ) {
    push('cached', 'aggregate', 90);
  }

  if (leaf === 'prompt_tokens') {
    push('input', 'aggregate', 125);
  } else if (leaf === 'input_tokens') {
    push('input', 'aggregate', 110);
  } else if (leaf === 'prompt') {
    push('input', 'aggregate', 105);
  } else if (
    hasPromptSignal &&
    !hasAny(segments, NEGATIVE_INPUT_SEGMENTS) &&
    !hasCacheReadSignal &&
    !hasCacheCreateSignal
  ) {
    push('input', 'aggregate', 92);
  }

  if (leaf === 'completion_tokens' || leaf === 'output_tokens') {
    push('output', 'aggregate', 125);
  } else if (leaf === 'completion') {
    push('output', 'aggregate', 105);
  } else if (
    hasCompletionSignal &&
    !hasAny(segments, NEGATIVE_OUTPUT_SEGMENTS) &&
    !hasReasoningSignal
  ) {
    push('output', 'aggregate', 92);
  }

  if (hasCacheCreateSignal && hasPromptSignal) {
    push('input', 'component', 118);
  } else if (hasCacheReadSignal && hasPromptSignal) {
    push('input', 'component', 116);
  } else if (
    depth > 1 &&
    hasPromptSignal &&
    !hasCompletionSignal &&
    !hasReasoningSignal &&
    !hasAny(segments, ['total'])
  ) {
    push('input', 'component', 70);
  }

  return candidates;
};

const pickBestAggregateValue = (candidates: TokenCandidate[]): number => {
  if (!candidates.length) {
    return 0;
  }

  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return b.value - a.value;
  });

  return sorted[0]?.value ?? 0;
};

const sumUniqueComponentValues = (candidates: TokenCandidate[]): number => {
  if (!candidates.length) {
    return 0;
  }

  const seen = new Set<string>();
  let total = 0;

  candidates.forEach((candidate) => {
    const key = `${candidate.family}:${candidate.path.join('.')}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    total += candidate.value;
  });

  return total;
};

export function normalizeUsageTokens(raw: unknown): CanonicalUsageTokens {
  const entries = flattenNumericLeaves(raw);
  if (!entries.length) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[TokenNormalizer] No numeric token fields found in:', raw);
    }
    return {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_tokens: 0,
      total_tokens: 0,
    };
  }

  const aggregates: Record<TokenFamily, TokenCandidate[]> = {
    input: [],
    output: [],
    reasoning: [],
    cached: [],
    total: [],
  };

  const components: Record<TokenFamily, TokenCandidate[]> = {
    input: [],
    output: [],
    reasoning: [],
    cached: [],
    total: [],
  };

  entries.forEach(({ path, value }) => {
    classifyPath(path, value).forEach((candidate) => {
      if (candidate.kind === 'aggregate') {
        aggregates[candidate.family].push(candidate);
      } else {
        components[candidate.family].push(candidate);
      }
    });
  });

  const inputAggregate = pickBestAggregateValue(aggregates.input);
  const outputAggregate = pickBestAggregateValue(aggregates.output);
  const reasoningAggregate = pickBestAggregateValue(aggregates.reasoning);
  const cachedAggregate = pickBestAggregateValue(aggregates.cached);
  const totalAggregate = pickBestAggregateValue(aggregates.total);

  const inputComponents = sumUniqueComponentValues(components.input);

  const hasPromptTokensAggregate = aggregates.input.some((candidate) => candidate.key === 'prompt_tokens');
  const hasInputTokensAggregate = aggregates.input.some((candidate) => candidate.key === 'input_tokens');
  const hasCacheFragments = components.input.length > 0;

  let inputTokens = inputAggregate;

  if (hasPromptTokensAggregate) {
    inputTokens = Math.max(inputAggregate, inputComponents);
  } else if (hasInputTokensAggregate && hasCacheFragments) {
    inputTokens = Math.max(inputAggregate + inputComponents, inputComponents);
  } else {
    inputTokens = Math.max(inputAggregate, inputComponents);
  }

  const outputTokens = Math.max(outputAggregate, sumUniqueComponentValues(components.output));
  const reasoningTokens = Math.max(reasoningAggregate, sumUniqueComponentValues(components.reasoning));
  const cachedTokens = Math.max(cachedAggregate, sumUniqueComponentValues(components.cached));

  const derivedTotal = inputTokens + outputTokens + reasoningTokens + cachedTokens;
  const totalTokens = Math.max(totalAggregate, derivedTotal);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    cached_tokens: cachedTokens,
    cache_tokens: cachedTokens,
    total_tokens: totalTokens,
  };
}

export function getCanonicalCachedTokens(raw: unknown): number {
  return normalizeUsageTokens(raw).cached_tokens;
}

export function extractCanonicalTotalTokens(raw: unknown): number {
  return normalizeUsageTokens(raw).total_tokens;
}
