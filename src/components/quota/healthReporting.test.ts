import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportBatchResults = vi.fn();

vi.mock('@/stores/useAccountHealthStore', () => ({
  useAccountHealthStore: {
    getState: () => ({
      reportBatchResults,
    }),
  },
}));

import { reportQuotaHealthResults } from './healthReporting';

describe('reportQuotaHealthResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('swallows health persistence failures after quota refresh', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportBatchResults.mockRejectedValueOnce(new Error('health endpoint unavailable'));

    await expect(
      reportQuotaHealthResults([{ name: 'claude.json', status: 'success' }])
    ).resolves.toBeUndefined();

    expect(reportBatchResults).toHaveBeenCalledWith([{ name: 'claude.json', status: 'success' }]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
