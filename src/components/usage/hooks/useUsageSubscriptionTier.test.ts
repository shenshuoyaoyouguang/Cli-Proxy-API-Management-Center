import { describe, expect, it } from 'vitest';
import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState, GeminiCliQuotaState } from '@/types';
import { resolveUsageSubscriptionTier, usageSubscriptionTierTestUtils } from './useUsageSubscriptionTier';

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

  it('uses codex quota cache before falling back to auth file metadata', () => {
    const authFiles: AuthFileItem[] = [
      { name: 'codex.json', type: 'codex', plan_type: 'free' }
    ];

    const tier = resolveUsageSubscriptionTier({
      authFiles,
      claudeQuota: {},
      codexQuota: { 'codex.json': createCodexQuota('team') },
      geminiCliQuota: {}
    });

    expect(tier).toBe('enterprise');
  });
});

describe('usageSubscriptionTierTestUtils', () => {
  it('does not cache null remote tier results', () => {
    const previous = {
      claudePlanTypes: {},
      codexPlanTypes: {},
      geminiTierIds: {}
    };

    const next = usageSubscriptionTierTestUtils.mergeRemoteTierState(previous, [
      { fileName: 'claude.json', provider: 'claude', value: null },
      { fileName: 'codex.json', provider: 'codex', value: null },
      { fileName: 'gemini-cli.json', provider: 'gemini-cli', value: null }
    ]);

    expect(next).toBe(previous);
  });

  it('builds a stable scope key independent of auth file order', () => {
    const firstOrder: AuthFileItem[] = [
      { name: 'codex.json', type: 'codex', authIndex: 2, modified: 10, id_token: JSON.stringify({ chatgpt_account_id: 'acct-a' }) },
      { name: 'gemini.json', type: 'gemini-cli', authIndex: 3, modified: 20, account: 'Gemini (project-a)' }
    ];
    const secondOrder = [...firstOrder].reverse();

    const left = usageSubscriptionTierTestUtils.buildUsageSubscriptionTierScopeKey(firstOrder, 'https://api.example.com', 'key');
    const right = usageSubscriptionTierTestUtils.buildUsageSubscriptionTierScopeKey(secondOrder, 'https://api.example.com', 'key');

    expect(left).toBe(right);
  });

  it('changes the scope key when auth file identity changes', () => {
    const before: AuthFileItem[] = [
      { name: 'codex.json', type: 'codex', authIndex: 2, modified: 10, id_token: JSON.stringify({ chatgpt_account_id: 'acct-a' }) }
    ];
    const after: AuthFileItem[] = [
      { name: 'codex.json', type: 'codex', authIndex: 2, modified: 11, id_token: JSON.stringify({ chatgpt_account_id: 'acct-b' }) }
    ];

    const left = usageSubscriptionTierTestUtils.buildUsageSubscriptionTierScopeKey(before, 'https://api.example.com', 'key');
    const right = usageSubscriptionTierTestUtils.buildUsageSubscriptionTierScopeKey(after, 'https://api.example.com', 'key');

    expect(left).not.toBe(right);
  });
});
