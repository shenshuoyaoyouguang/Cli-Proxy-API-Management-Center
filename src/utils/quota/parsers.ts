/**
 * Normalization and parsing functions for quota data.
 */

import type {
  ClaudeUsagePayload,
  CodexUsagePayload,
  GeminiCliCodeAssistPayload,
  GeminiCliQuotaPayload,
  KimiUsagePayload,
} from '@/types';
import { normalizeAuthIndex } from '@/utils/usage';
import { isRecord } from '@/atoms/usage/guards';

const GEMINI_CLI_MODEL_SUFFIX = '_vertex';
export { normalizeAuthIndex };

const safeParseRecord = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export function normalizeStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
}

export function normalizeGeminiCliModelId(value: unknown): string | null {
  const modelId = normalizeStringValue(value);
  if (!modelId) return null;
  if (modelId.endsWith(GEMINI_CLI_MODEL_SUFFIX)) {
    return modelId.slice(0, -GEMINI_CLI_MODEL_SUFFIX.length);
  }
  return modelId;
}

export function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeQuotaFraction(value: unknown): number | null {
  const normalized = normalizeNumberValue(value);
  if (normalized !== null) return normalized;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.endsWith('%')) {
      const parsed = Number(trimmed.slice(0, -1));
      return Number.isFinite(parsed) ? parsed / 100 : null;
    }
  }
  return null;
}

export function normalizePlanType(value: unknown): string | null {
  const normalized = normalizeStringValue(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function decodeBase64UrlPayload(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(padded);
    }
    if (typeof atob === 'function') {
      return atob(padded);
    }
  } catch {
    return null;
  }
  return null;
}

export function parseIdTokenPayload(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') {
    return isRecord(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = safeParseRecord(trimmed);
  if (parsed) return parsed;
  const segments = trimmed.split('.');
  if (segments.length < 2) return null;
  const decoded = decodeBase64UrlPayload(segments[1]);
  if (!decoded) return null;
  return safeParseRecord(decoded);
}

export function parseAntigravityPayload(payload: unknown): Record<string, unknown> | null {
  const toRecord = (value: unknown): Record<string, unknown> | null => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
      return safeParseRecord(value.trim());
    }
    return isRecord(value) ? value : null;
  };

  const parsed = toRecord(payload);
  if (!parsed) return null;

  if ('models' in parsed) {
    return parsed;
  }

  const nested = toRecord(parsed.body);
  if (nested) {
    return nested;
  }

  return parsed;
}

export function parseClaudeUsagePayload(payload: unknown): ClaudeUsagePayload | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    const parsed = safeParseRecord(trimmed);
    return parsed as ClaudeUsagePayload | null;
  }
  if (isRecord(payload)) {
    return payload as ClaudeUsagePayload;
  }
  return null;
}

export function parseCodexUsagePayload(payload: unknown): CodexUsagePayload | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    const parsed = safeParseRecord(trimmed);
    return parsed as CodexUsagePayload | null;
  }
  if (isRecord(payload)) {
    return payload as CodexUsagePayload;
  }
  return null;
}

export function parseGeminiCliQuotaPayload(payload: unknown): GeminiCliQuotaPayload | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    const parsed = safeParseRecord(trimmed);
    return parsed as GeminiCliQuotaPayload | null;
  }
  if (isRecord(payload)) {
    return payload as GeminiCliQuotaPayload;
  }
  return null;
}

export function parseGeminiCliCodeAssistPayload(
  payload: unknown
): GeminiCliCodeAssistPayload | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    const parsed = safeParseRecord(trimmed);
    return parsed as GeminiCliCodeAssistPayload | null;
  }
  if (isRecord(payload)) {
    return payload as GeminiCliCodeAssistPayload;
  }
  return null;
}

export function parseKimiUsagePayload(payload: unknown): KimiUsagePayload | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    const parsed = safeParseRecord(trimmed);
    return parsed as KimiUsagePayload | null;
  }
  if (isRecord(payload)) {
    return payload as KimiUsagePayload;
  }
  return null;
}
