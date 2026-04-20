import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api', () => ({
  authFilesApi: {
    getAccountHealth: vi.fn(),
    updateAccountHealth: vi.fn(),
    recoverAccount: vi.fn(),
  },
}));

import { authFilesApi } from '@/services/api';
import {
  buildAccountHealthScopeKey,
  shouldIgnoreAccountHealthFailure,
  useAccountHealthStore,
} from './useAccountHealthStore';

describe('useAccountHealthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    useAccountHealthStore.setState({
      healthMap: {},
      scopeKey: '',
      revision: 0,
    });
  });

  it('degrades an account after repeated failures and persists updates', async () => {
    vi.mocked(authFilesApi.getAccountHealth).mockResolvedValue({});
    vi.mocked(authFilesApi.updateAccountHealth).mockResolvedValue({} as never);

    await useAccountHealthStore.getState().loadHealthMap({
      apiBase: 'http://localhost:3000',
      managementKey: 'test-key',
    });

    await useAccountHealthStore.getState().reportBatchResults([
      { name: 'claude-1.json', status: 'error', errorStatus: 401, error: '401 unauthorized' },
    ]);
    await useAccountHealthStore.getState().reportBatchResults([
      { name: 'claude-1.json', status: 'error', errorStatus: 401, error: '401 unauthorized' },
    ]);
    await useAccountHealthStore.getState().reportBatchResults([
      { name: 'claude-1.json', status: 'error', errorStatus: 401, error: '401 unauthorized' },
    ]);

    const state = useAccountHealthStore.getState().healthMap['claude-1.json'];
    expect(state).toMatchObject({
      degraded: true,
      degradedReason: '401_unauthorized',
      degradedStatus: 401,
      consecutiveFailures: 3,
    });
    expect(useAccountHealthStore.getState().isAccountDegraded('claude-1.json')).toBe(true);
    expect(authFilesApi.updateAccountHealth).toHaveBeenCalled();
  });

  it('clears degraded state after a successful refresh result', async () => {
    vi.mocked(authFilesApi.getAccountHealth).mockResolvedValue({});
    vi.mocked(authFilesApi.updateAccountHealth).mockResolvedValue({} as never);

    await useAccountHealthStore.getState().loadHealthMap({
      apiBase: 'http://localhost:3000',
      managementKey: 'test-key',
    });

    await useAccountHealthStore.getState().reportBatchResults([
      { name: 'codex-1.json', status: 'error', errorStatus: 429, error: '429 rate limited' },
      { name: 'codex-1.json', status: 'error', errorStatus: 429, error: '429 rate limited' },
      { name: 'codex-1.json', status: 'error', errorStatus: 429, error: '429 rate limited' },
    ]);

    expect(useAccountHealthStore.getState().healthMap['codex-1.json']).toBeDefined();

    await useAccountHealthStore.getState().reportBatchResults([
      { name: 'codex-1.json', status: 'success' },
    ]);

    expect(useAccountHealthStore.getState().healthMap['codex-1.json']).toBeUndefined();
  });

  it('falls back to local persisted state when remote health loading fails', async () => {
    vi.mocked(authFilesApi.getAccountHealth).mockRejectedValue(new Error('Not found'));

    const scopeKey = buildAccountHealthScopeKey('http://localhost:3000', 'test-key');
    localStorage.setItem(
      `cli-proxy-account-health-v1:${encodeURIComponent(scopeKey)}`,
      JSON.stringify({
        'gemini-1.json': {
          degraded: true,
          degradedReason: '403_forbidden',
          degradedStatus: 403,
          degradedMessage: '403 forbidden',
          consecutiveFailures: 3,
          failureStatuses: [403, 403, 403],
          degradedAt: Date.now(),
          cooldownUntil: null,
        },
      })
    );

    const result = await useAccountHealthStore.getState().loadHealthMap({
      apiBase: 'http://localhost:3000',
      managementKey: 'test-key',
    });

    expect(result['gemini-1.json']).toBeDefined();
    expect(useAccountHealthStore.getState().isAccountDegraded('gemini-1.json')).toBe(true);
  });

  it('ignores late health responses from a previous scope', async () => {
    let resolveFirstRequest: ((value: Record<string, unknown>) => void) | null = null;
    vi.mocked(authFilesApi.getAccountHealth)
      .mockImplementationOnce(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            resolveFirstRequest = resolve;
          }) as never
      )
      .mockResolvedValueOnce({
        'active.json': {
          degraded: true,
          degradedReason: '429_rate_limited',
          degradedStatus: 429,
          degradedMessage: '429 rate limited',
          consecutiveFailures: 3,
          failureStatuses: [429, 429, 429],
          degradedAt: Date.now(),
          cooldownUntil: Date.now() + 60_000,
        },
      } as never);

    const firstLoad = useAccountHealthStore.getState().loadHealthMap({
      apiBase: 'http://old-server:3000',
      managementKey: 'old-key',
    });

    const secondMap = await useAccountHealthStore.getState().loadHealthMap({
      apiBase: 'http://new-server:3000',
      managementKey: 'new-key',
    });

    const resolvePendingRequest = resolveFirstRequest as
      | ((value: Record<string, unknown>) => void)
      | null;
    expect(typeof resolvePendingRequest).toBe('function');
    if (!resolvePendingRequest) {
      throw new Error('expected pending health request resolver');
    }
    resolvePendingRequest({
      'stale.json': {
        degraded: true,
        degradedReason: '401_unauthorized',
        degradedStatus: 401,
        degradedMessage: '401 unauthorized',
        consecutiveFailures: 3,
        failureStatuses: [401, 401, 401],
        degradedAt: Date.now(),
        cooldownUntil: null,
      },
    });
    await firstLoad;

    expect(secondMap['active.json']).toBeDefined();
    expect(useAccountHealthStore.getState().healthMap['active.json']).toBeDefined();
    expect(useAccountHealthStore.getState().healthMap['stale.json']).toBeUndefined();
  });

  it('treats explicit stale health entries as degraded for filtering', () => {
    useAccountHealthStore.setState({
      healthMap: {
        'stale.json': {
          degraded: true,
          degradedReason: '429_rate_limited',
          degradedStatus: 429,
          degradedMessage: '429 rate limited',
          consecutiveFailures: 3,
          failureStatuses: [429, 429, 429],
          cooldownUntil: undefined,
          stale: true,
        },
      },
      scopeKey: 'scope',
      revision: 0,
    });

    expect(useAccountHealthStore.getState().isAccountDegraded('stale.json')).toBe(true);
  });

  it('removes account health entries for deleted files', () => {
    useAccountHealthStore.setState({
      healthMap: {
        'keep.json': {
          degraded: true,
          degradedReason: '401_unauthorized',
          degradedStatus: 401,
          degradedMessage: '401 unauthorized',
          consecutiveFailures: 3,
          failureStatuses: [401, 401, 401],
          cooldownUntil: null,
          stale: false,
        },
        'delete.json': {
          degraded: true,
          degradedReason: '429_rate_limited',
          degradedStatus: 429,
          degradedMessage: '429 rate limited',
          consecutiveFailures: 3,
          failureStatuses: [429, 429, 429],
          cooldownUntil: Date.now() + 60_000,
          stale: false,
        },
      },
      scopeKey: 'scope',
      revision: 0,
    });

    useAccountHealthStore.getState().removeAccounts(['delete.json']);

    expect(useAccountHealthStore.getState().healthMap['delete.json']).toBeUndefined();
    expect(useAccountHealthStore.getState().healthMap['keep.json']).toBeDefined();
  });

  it('restores local health state and rejects when recovery persistence fails', async () => {
    vi.mocked(authFilesApi.recoverAccount).mockRejectedValue(new Error('recover failed'));
    vi.mocked(authFilesApi.updateAccountHealth).mockRejectedValue(new Error('fallback failed'));

    useAccountHealthStore.setState({
      healthMap: {
        'stuck.json': {
          degraded: true,
          degradedReason: '401_unauthorized',
          degradedStatus: 401,
          degradedMessage: '401 unauthorized',
          consecutiveFailures: 3,
          failureStatuses: [401, 401, 401],
          cooldownUntil: null,
          stale: false,
        },
      },
      scopeKey: 'scope',
      revision: 0,
    });

    await expect(useAccountHealthStore.getState().recoverAccount('stuck.json')).rejects.toThrow(
      'fallback failed'
    );

    expect(authFilesApi.recoverAccount).toHaveBeenCalledWith('stuck.json');
    expect(authFilesApi.updateAccountHealth).toHaveBeenCalledWith({ 'stuck.json': null });
    expect(useAccountHealthStore.getState().healthMap['stuck.json']).toBeDefined();
  });

  it('ignores unsupported 404 quota failures for degradation tracking', async () => {
    vi.mocked(authFilesApi.getAccountHealth).mockResolvedValue({});
    vi.mocked(authFilesApi.updateAccountHealth).mockResolvedValue({} as never);

    await useAccountHealthStore.getState().loadHealthMap({
      apiBase: 'http://localhost:3000',
      managementKey: 'test-key',
    });

    await useAccountHealthStore.getState().reportBatchResults([
      { name: 'unsupported.json', status: 'error', errorStatus: 404, error: 'quota_update_required' },
      { name: 'unsupported.json', status: 'error', errorStatus: 404, error: 'quota_update_required' },
      { name: 'unsupported.json', status: 'error', errorStatus: 404, error: 'quota_update_required' },
    ]);

    expect(shouldIgnoreAccountHealthFailure(404, 'quota_update_required')).toBe(true);
    expect(useAccountHealthStore.getState().healthMap['unsupported.json']).toBeUndefined();
    expect(authFilesApi.updateAccountHealth).not.toHaveBeenCalled();
  });

  it('does not keep local degraded state when health persistence fails', async () => {
    vi.mocked(authFilesApi.getAccountHealth).mockResolvedValue({});
    vi.mocked(authFilesApi.updateAccountHealth).mockRejectedValue(new Error('health unavailable'));

    await useAccountHealthStore.getState().loadHealthMap({
      apiBase: 'http://localhost:3000',
      managementKey: 'test-key',
    });

    await expect(
      useAccountHealthStore.getState().reportBatchResults([
        { name: 'claude-1.json', status: 'error', errorStatus: 401, error: '401 unauthorized' },
        { name: 'claude-1.json', status: 'error', errorStatus: 401, error: '401 unauthorized' },
        { name: 'claude-1.json', status: 'error', errorStatus: 401, error: '401 unauthorized' },
      ])
    ).rejects.toThrow('health unavailable');

    expect(useAccountHealthStore.getState().healthMap['claude-1.json']).toBeUndefined();
  });

  it('keeps local degraded state when removal persistence fails', async () => {
    vi.mocked(authFilesApi.getAccountHealth).mockResolvedValue({});
    vi.mocked(authFilesApi.updateAccountHealth)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('removal unavailable'));

    await useAccountHealthStore.getState().loadHealthMap({
      apiBase: 'http://localhost:3000',
      managementKey: 'test-key',
    });

    await useAccountHealthStore.getState().reportBatchResults([
      { name: 'codex-1.json', status: 'error', errorStatus: 429, error: '429 rate limited' },
      { name: 'codex-1.json', status: 'error', errorStatus: 429, error: '429 rate limited' },
      { name: 'codex-1.json', status: 'error', errorStatus: 429, error: '429 rate limited' },
    ]);

    await expect(
      useAccountHealthStore.getState().reportBatchResults([
        { name: 'codex-1.json', status: 'success' },
      ])
    ).rejects.toThrow('removal unavailable');

    expect(useAccountHealthStore.getState().healthMap['codex-1.json']).toBeDefined();
  });
});
