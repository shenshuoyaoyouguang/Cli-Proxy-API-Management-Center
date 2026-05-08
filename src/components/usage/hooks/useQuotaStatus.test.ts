import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { useQuotaStatus } from './useQuotaStatus';

describe('useQuotaStatus', () => {
  afterEach(() => {
    useQuotaStore.setState({
      claudeQuota: {},
      geminiCliQuota: {},
      codexQuota: {},
      kimiQuota: {},
    });
  });

  it('maps Claude monthly extra usage and Gemini token buckets to explicit metric items', () => {
    useQuotaStore.setState({
      claudeQuota: {
        claudeA: {
          status: 'success',
          windows: [],
          extraUsage: {
            is_enabled: true,
            monthly_limit: 1000,
            used_credits: 900,
            utilization: 90,
          },
          planType: 'pro',
        },
      },
      geminiCliQuota: {
        geminiA: {
          status: 'success',
          buckets: [
            {
              id: 'gemini-2.5-pro-tokens',
              label: 'Gemini 2.5 Pro',
              remainingFraction: 0.2,
              remainingAmount: null,
              resetTime: undefined,
              tokenType: 'tokens',
              modelIds: ['gemini-2.5-pro'],
            },
          ],
          tierLabel: null,
          tierId: null,
          creditBalance: null,
        },
      },
      codexQuota: {},
      kimiQuota: {},
    });

    const { result } = renderHook(() => useQuotaStatus());

    expect(result.current.monthlyItem).toMatchObject({
      id: 'claude-extra-usage-monthly',
      usedPercent: 90,
    });
    expect(result.current.tpmItem).toMatchObject({
      id: 'gemini-gemini-2.5-pro-tokens',
      usedPercent: 80,
    });
    expect(result.current.rpmItem).toBeNull();
  });
});
