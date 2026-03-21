import { describe, expect, it } from 'vitest';
import type { AuthFileItem } from '@/types';
import { resolveCodexPlanType } from './resolvers';

describe('resolveCodexPlanType', () => {
  it('reads direct plan_type fields first', () => {
    const file = { name: 'codex.json', type: 'codex', plan_type: 'plus' } as AuthFileItem;
    expect(resolveCodexPlanType(file)).toBe('plus');
  });

  it('reads plan type from id token payload instead of raw token text', () => {
    const file = {
      name: 'codex.json',
      type: 'codex',
      id_token: JSON.stringify({ plan_type: 'team' })
    } as AuthFileItem;

    expect(resolveCodexPlanType(file)).toBe('team');
  });

  it('returns null for opaque id tokens without plan claims', () => {
    const file = {
      name: 'codex.json',
      type: 'codex',
      id_token: 'opaque-token-value'
    } as AuthFileItem;

    expect(resolveCodexPlanType(file)).toBeNull();
  });
});
