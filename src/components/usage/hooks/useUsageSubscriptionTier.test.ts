import { describe, expect, it } from 'vitest';
import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState, GeminiCliQuotaState } from '@/types';
import { resolveUsageSubscriptionTier } from './useUsageSubscriptionTier';

const createClaudeQuota = (planType: string | null): ClaudeQuotaState => ({
  status: 'success',
  windows: [],
  planType
});

const createCodexQuota = (planType: string | null): CodexQuotaState => ({
  status: 'success',
  windows: [],
  planType
});

const createGeminiQuota = (tierId: string | null): GeminiCliQuotaState => ({
  status: 'success',
  buckets: [],
  tierId
});

describe('resolveUsageSubscriptionTier', () => {
  it('returns the highest resolved tier from loaded quota sources', () => {
    const authFiles: AuthFileItem[] = [
      { name: 'claude.json', type: 'claude' },
      { name: 'codex.json', type: 'codex' },
      { name: 'gemini-cli.json', type: 'gemini-cli' }
    ];

    const tier = resolveUsageSubscriptionTier({
      authFiles,
      claudeQuota: { 'claude.json': createClaudeQuota('plan_pro') },
      codexQuota: { 'codex.json': createCodexQuota('team') },
      geminiCliQuota: { 'gemini-cli.json': createGeminiQuota('standard-tier') }
    });

    expect(tier).toBe('enterprise');
  });

  it('falls back to codex auth-file plan type when quota cache is unavailable', () => {
    const authFiles: AuthFileItem[] = [
      { name: 'codex.json', type: 'codex', plan_type: 'plus' }
    ];

    const tier = resolveUsageSubscriptionTier({
      authFiles,
      claudeQuota: {},
      codexQuota: {},
      geminiCliQuota: {}
    });

    expect(tier).toBe('basic');
  });

  it('returns free when no supported tier source can be resolved', () => {
    const authFiles: AuthFileItem[] = [
      { name: 'unknown.json', type: 'unknown' }
    ];

    const tier = resolveUsageSubscriptionTier({
      authFiles,
      claudeQuota: {},
      codexQuota: {},
      geminiCliQuota: {}
    });

    expect(tier).toBe('free');
  });

  it('ignores disabled auth files when deriving the tier', () => {
    const authFiles: AuthFileItem[] = [
      { name: 'free-codex.json', type: 'codex', disabled: true, plan_type: 'free' },
      { name: 'pro-claude.json', type: 'claude' }
    ];

    const tier = resolveUsageSubscriptionTier({
      authFiles,
      claudeQuota: { 'pro-claude.json': createClaudeQuota('plan_pro') },
      codexQuota: { 'free-codex.json': createCodexQuota('free') },
      geminiCliQuota: {}
    });

    expect(tier).toBe('pro');
  });
});
