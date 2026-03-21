/**
 * Resolver functions for extracting data from auth files.
 */

import type { AuthFileItem } from '@/types';
import {
  normalizeStringValue,
  normalizePlanType,
  parseIdTokenPayload
} from './parsers';

export function extractCodexChatgptAccountId(value: unknown): string | null {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;
  return normalizeStringValue(payload.chatgpt_account_id ?? payload.chatgptAccountId);
}

export function resolveCodexChatgptAccountId(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;

  const candidates = [file.id_token, metadata?.id_token, attributes?.id_token];

  for (const candidate of candidates) {
    const id = extractCodexChatgptAccountId(candidate);
    if (id) return id;
  }

  return null;
}

export function resolveCodexPlanType(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const idTokenPayload = parseIdTokenPayload(file.id_token);
  const metadataIdTokenPayload = parseIdTokenPayload(metadata?.id_token);
  const attributesIdTokenPayload = parseIdTokenPayload(attributes?.id_token);

  const candidates = [
    file.plan_type,
    file.planType,
    file['plan_type'],
    file['planType'],
    idTokenPayload?.plan_type,
    idTokenPayload?.planType,
    metadata?.plan_type,
    metadata?.planType,
    metadataIdTokenPayload?.plan_type,
    metadataIdTokenPayload?.planType,
    attributes?.plan_type,
    attributes?.planType,
    attributesIdTokenPayload?.plan_type,
    attributesIdTokenPayload?.planType
  ];

  for (const candidate of candidates) {
    const planType = normalizePlanType(candidate);
    if (planType) return planType;
  }

  return null;
}

export function extractGeminiCliProjectId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const matches = Array.from(value.matchAll(/\(([^()]+)\)/g));
  if (matches.length === 0) return null;
  const candidate = matches[matches.length - 1]?.[1]?.trim();
  return candidate ? candidate : null;
}

export function resolveGeminiCliProjectId(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;

  const candidates = [
    file.account,
    file['account'],
    metadata?.account,
    attributes?.account
  ];

  for (const candidate of candidates) {
    const projectId = extractGeminiCliProjectId(candidate);
    if (projectId) return projectId;
  }

  return null;
}
