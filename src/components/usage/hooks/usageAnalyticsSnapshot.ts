import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo, SourceInfo } from '@/types/sourceInfo';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  buildCandidateUsageSourceIds,
  extractTotalTokens,
  normalizeAuthIndex,
  type UsageDetail,
  type UsageTimeRange
} from '@/utils/usage';
import { resolveSourceDisplay, type SourceInfoMapInput } from '@/utils/sourceResolver';

const USAGE_TIME_RANGE_MS: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '7h': 7 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

export interface RequestEventRow {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  model: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  failed: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface CredentialRow {
  key: string;
  displayName: string;
  type: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
}

export interface TokenDistribution {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
}

interface CredentialBucket {
  success: number;
  failure: number;
}

type ProviderConfigs = Pick<
  SourceInfoMapInput,
  'geminiApiKeys' | 'claudeApiKeys' | 'codexApiKeys' | 'vertexApiKeys' | 'openaiCompatibility'
>;

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getDetailTimestampMs = (detail: UsageDetail) => {
  if (typeof detail.__timestampMs === 'number' && Number.isFinite(detail.__timestampMs)) {
    return detail.__timestampMs;
  }

  if (typeof detail.timestamp !== 'string') {
    return Number.NaN;
  }

  return Date.parse(detail.timestamp);
};

export function createAuthFileMap(files: AuthFileItem[]): Map<string, CredentialInfo> {
  const map = new Map<string, CredentialInfo>();

  files.forEach((file) => {
    const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
    if (!key) return;

    map.set(key, {
      name: file.name || key,
      type: (file.type || file.provider || '').toString()
    });
  });

  return map;
}

export function filterUsageDetailsByTimeRange(
  details: UsageDetail[],
  range: UsageTimeRange,
  nowMs: number = Date.now()
): UsageDetail[] {
  if (range === 'all') {
    return details;
  }

  const rangeMs = USAGE_TIME_RANGE_MS[range];
  if (!Number.isFinite(rangeMs) || rangeMs <= 0 || !Number.isFinite(nowMs) || nowMs <= 0) {
    return details;
  }

  const windowStart = nowMs - rangeMs;
  return details.filter((detail) => {
    const timestamp = getDetailTimestampMs(detail);
    return Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= nowMs;
  });
}

export function createTokenDistribution(details: UsageDetail[]): TokenDistribution {
  let input = 0;
  let output = 0;
  let cached = 0;
  let reasoning = 0;

  details.forEach((detail) => {
    const tokens = detail.tokens;
    input += typeof tokens.input_tokens === 'number' ? Math.max(tokens.input_tokens, 0) : 0;
    output += typeof tokens.output_tokens === 'number' ? Math.max(tokens.output_tokens, 0) : 0;
    cached += Math.max(
      typeof tokens.cached_tokens === 'number' ? Math.max(tokens.cached_tokens, 0) : 0,
      typeof tokens.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0
    );
    reasoning +=
      typeof tokens.reasoning_tokens === 'number' ? Math.max(tokens.reasoning_tokens, 0) : 0;
  });

  return { input, output, cached, reasoning };
}

export function createRequestEventRows(
  details: UsageDetail[],
  sourceInfoMap: Map<string, SourceInfo>,
  authFileMap: Map<string, CredentialInfo>,
  locale: string
): RequestEventRow[] {
  return details
    .map((detail, index) => {
      const timestamp = detail.timestamp;
      const timestampMs = getDetailTimestampMs(detail);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const sourceRaw = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(sourceRaw, authIndexRaw, sourceInfoMap, authFileMap);
      const model = String(detail.__modelName ?? '').trim() || '-';
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const cachedTokens = Math.max(
        Math.max(toNumber(detail.tokens?.cached_tokens), 0),
        Math.max(toNumber(detail.tokens?.cache_tokens), 0)
      );
      const totalTokens = Math.max(toNumber(detail.tokens?.total_tokens), extractTotalTokens(detail));

      return {
        id: `${timestamp}-${model}-${sourceRaw || sourceInfo.displayName}-${authIndex}-${index}`,
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? date.toLocaleString(locale) : timestamp || '-',
        model,
        sourceRaw: sourceRaw || '-',
        source: sourceInfo.displayName,
        sourceType: sourceInfo.type,
        authIndex,
        failed: detail.failed === true,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens
      };
    })
    .sort((a, b) => b.timestampMs - a.timestampMs);
}

export function createCredentialRows(
  details: UsageDetail[],
  {
    geminiApiKeys = [],
    claudeApiKeys = [],
    codexApiKeys = [],
    vertexApiKeys = [],
    openaiCompatibility = []
  }: ProviderConfigs,
  authFileMap: Map<string, CredentialInfo>
): CredentialRow[] {
  const bySource: Record<string, CredentialBucket> = {};
  const result: CredentialRow[] = [];
  const consumedSourceIds = new Set<string>();
  const authIndexToRowIndex = new Map<string, number>();
  const sourceToAuthIndex = new Map<string, string>();
  const sourceToAuthFile = new Map<string, CredentialInfo>();
  const fallbackByAuthIndex = new Map<string, CredentialBucket>();

  details.forEach((detail) => {
    const authIdx = normalizeAuthIndex(detail.auth_index);
    const source = detail.source;
    const isFailed = detail.failed === true;

    if (!source) {
      if (!authIdx) return;
      const fallback = fallbackByAuthIndex.get(authIdx) ?? { success: 0, failure: 0 };
      if (isFailed) {
        fallback.failure += 1;
      } else {
        fallback.success += 1;
      }
      fallbackByAuthIndex.set(authIdx, fallback);
      return;
    }

    const bucket = bySource[source] ?? { success: 0, failure: 0 };
    if (isFailed) {
      bucket.failure += 1;
    } else {
      bucket.success += 1;
    }
    bySource[source] = bucket;

    if (authIdx && !sourceToAuthIndex.has(source)) {
      sourceToAuthIndex.set(source, authIdx);
    }

    if (authIdx && !sourceToAuthFile.has(source)) {
      const mapped = authFileMap.get(authIdx);
      if (mapped) {
        sourceToAuthFile.set(source, mapped);
      }
    }
  });

  const mergeBucketToRow = (index: number, bucket: CredentialBucket) => {
    const target = result[index];
    if (!target) return;

    target.success += bucket.success;
    target.failure += bucket.failure;
    target.total = target.success + target.failure;
    target.successRate = target.total > 0 ? (target.success / target.total) * 100 : 100;
  };

  const addConfigRow = (
    apiKey: string,
    prefix: string | undefined,
    name: string,
    type: string,
    rowKey: string
  ) => {
    const candidates = buildCandidateUsageSourceIds({ apiKey, prefix });
    let success = 0;
    let failure = 0;

    candidates.forEach((id) => {
      const bucket = bySource[id];
      if (!bucket) return;
      success += bucket.success;
      failure += bucket.failure;
      consumedSourceIds.add(id);
    });

    const total = success + failure;
    if (!total) return;

    result.push({
      key: rowKey,
      displayName: name,
      type,
      success,
      failure,
      total,
      successRate: (success / total) * 100
    });
  };

  geminiApiKeys.forEach((config, index) =>
    addConfigRow(
      config.apiKey,
      config.prefix,
      config.prefix?.trim() || `Gemini #${index + 1}`,
      'gemini',
      `gemini:${index}`
    )
  );
  claudeApiKeys.forEach((config, index) =>
    addConfigRow(
      config.apiKey,
      config.prefix,
      config.prefix?.trim() || `Claude #${index + 1}`,
      'claude',
      `claude:${index}`
    )
  );
  codexApiKeys.forEach((config, index) =>
    addConfigRow(
      config.apiKey,
      config.prefix,
      config.prefix?.trim() || `Codex #${index + 1}`,
      'codex',
      `codex:${index}`
    )
  );
  vertexApiKeys.forEach((config, index) =>
    addConfigRow(
      config.apiKey,
      config.prefix,
      config.prefix?.trim() || `Vertex #${index + 1}`,
      'vertex',
      `vertex:${index}`
    )
  );

  openaiCompatibility.forEach((provider, providerIndex) => {
    const displayName = provider.prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`;
    const candidates = new Set<string>();
    buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => candidates.add(id));
    (provider.apiKeyEntries || []).forEach((entry) => {
      buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
    });

    let success = 0;
    let failure = 0;
    candidates.forEach((id) => {
      const bucket = bySource[id];
      if (!bucket) return;
      success += bucket.success;
      failure += bucket.failure;
      consumedSourceIds.add(id);
    });

    const total = success + failure;
    if (!total) return;

    result.push({
      key: `openai:${providerIndex}`,
      displayName,
      type: 'openai',
      success,
      failure,
      total,
      successRate: (success / total) * 100
    });
  });

  Object.entries(bySource).forEach(([key, bucket]) => {
    if (consumedSourceIds.has(key)) return;
    const total = bucket.success + bucket.failure;
    const authFile = sourceToAuthFile.get(key);

    const rowIndex =
      result.push({
        key,
        displayName: authFile?.name || (key.startsWith('t:') ? key.slice(2) : key),
        type: authFile?.type || '',
        success: bucket.success,
        failure: bucket.failure,
        total,
        successRate: total > 0 ? (bucket.success / total) * 100 : 100
      }) - 1;

    const authIdx = sourceToAuthIndex.get(key);
    if (authIdx && !authIndexToRowIndex.has(authIdx)) {
      authIndexToRowIndex.set(authIdx, rowIndex);
    }
  });

  fallbackByAuthIndex.forEach((bucket, authIdx) => {
    if (bucket.success + bucket.failure === 0) return;

    const mapped = authFileMap.get(authIdx);
    let targetRowIndex = authIndexToRowIndex.get(authIdx);
    if (targetRowIndex === undefined && mapped) {
      const matchedIndex = result.findIndex(
        (row) => row.displayName === mapped.name && row.type === mapped.type
      );
      if (matchedIndex >= 0) {
        targetRowIndex = matchedIndex;
        authIndexToRowIndex.set(authIdx, matchedIndex);
      }
    }

    if (targetRowIndex !== undefined) {
      mergeBucketToRow(targetRowIndex, bucket);
      return;
    }

    const total = bucket.success + bucket.failure;
    const rowIndex =
      result.push({
        key: `auth:${authIdx}`,
        displayName: mapped?.name || authIdx,
        type: mapped?.type || '',
        success: bucket.success,
        failure: bucket.failure,
        total,
        successRate: (bucket.success / total) * 100
      }) - 1;

    authIndexToRowIndex.set(authIdx, rowIndex);
  });

  return result.sort((a, b) => b.total - a.total);
}

export type UsageProviderConfigs = {
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
};
