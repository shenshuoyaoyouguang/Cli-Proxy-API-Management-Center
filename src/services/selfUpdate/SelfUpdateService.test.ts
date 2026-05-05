import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores', () => ({
  useConfigStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/utils/error', () => ({
  getErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : String(err ?? ''),
}));

import { useConfigStore } from '@/stores';
import { SelfUpdateService } from './SelfUpdateService';

const createConfigWithRemote = (
  repo: string | null
): Record<string, unknown> => {
  const config: Record<string, unknown> = {};
  if (repo !== null) {
    config['remote-management'] = {
      'panel-github-repository': repo,
    };
  }
  return config;
};

const mockConfigState = (raw: Record<string, unknown> | null) => {
  vi.mocked(useConfigStore.getState).mockReturnValue({
    config: raw ? { raw } : null,
  } as never);
};

describe('SelfUpdateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUpdateInfo in initial state', () => {
    it('returns idle status with null latestVersion', () => {
      mockConfigState(null);
      const service = new SelfUpdateService();
      const info = service.getUpdateInfo();
      expect(info.status).toBe('idle');
      expect(info.latestVersion).toBeNull();
      expect(info.error).toBeNull();
    });
  });

  describe('subscribe and emit', () => {
    it('calls listener when state changes', async () => {
      mockConfigState(null);
      const service = new SelfUpdateService();
      const listener = vi.fn();

      const unsubscribe = service.subscribe(listener);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tag_name: 'v2.0.0' }), { status: 200 })
      );
      globalThis.fetch = mockFetch as never;

      await service.checkForUpdates();
      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });
  });

  describe('checkForUpdates', () => {
    it('falls back to default repo when no config is set', async () => {
      mockConfigState(null);
      const service = new SelfUpdateService();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tag_name: 'v1.0.0' }), { status: 200 })
      );
      globalThis.fetch = mockFetch as never;

      const result = await service.checkForUpdates();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('router-for-me/Cli-Proxy-API-Management-Center'),
        expect.anything()
      );
      expect(result.status).toBe('available');
    });

    it('uses the configured rmPanelRepo from config store', async () => {
      mockConfigState(
        createConfigWithRemote('https://github.com/org/my-panel')
      );
      const service = new SelfUpdateService();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tag_name: 'v1.0.0' }), { status: 200 })
      );
      globalThis.fetch = mockFetch as never;

      await service.checkForUpdates();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('org/my-panel'),
        expect.anything()
      );
    });

    it('uses the panel-repo fallback key', async () => {
      const config = { 'remote-management': { 'panel-repo': 'fallback/my-repo' } };
      mockConfigState(config);
      const service = new SelfUpdateService();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tag_name: 'v1.0.0' }), { status: 200 })
      );
      globalThis.fetch = mockFetch as never;

      await service.checkForUpdates();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('fallback/my-repo'),
        expect.anything()
      );
    });

    it('handles malformed repo URL', async () => {
      mockConfigState(createConfigWithRemote('not a valid repo'));
      const service = new SelfUpdateService();

      const result = await service.checkForUpdates();
      expect(result.status).toBe('error');
      expect(result.error).toContain('无法解析面板仓库地址');
    });

    it('sets status to available when newer version exists', async () => {
      mockConfigState(null);
      const service = new SelfUpdateService();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            tag_name: 'v999.0.0',
            html_url: 'https://github.com/org/repo/releases/tag/v999.0.0',
            assets: [{ name: 'management.html', browser_download_url: 'https://example.com/management.html' }],
          }),
          { status: 200 }
        )
      );
      globalThis.fetch = mockFetch as never;

      const result = await service.checkForUpdates();
      expect(result.status).toBe('available');
      expect(result.latestVersion).toBe('v999.0.0');
      expect(result.releaseUrl).toBe('https://example.com/management.html');
    });

    it('sets status to up_to_date when version can be compared and matches', async () => {
      mockConfigState(null);
      const service = new SelfUpdateService();

      // Bypass __APP_VERSION__ by directly setting the info
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).info.currentVersion = 'v2.0.0';

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ tag_name: 'v2.0.0' }),
          { status: 200 }
        )
      );
      globalThis.fetch = mockFetch as never;

      const result = await service.checkForUpdates();
      expect(result.status).toBe('up_to_date');
    });

    it('handles GitHub API errors', async () => {
      mockConfigState(null);
      const service = new SelfUpdateService();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Not Found', { status: 404, statusText: 'Not Found' })
      );
      globalThis.fetch = mockFetch as never;

      const result = await service.checkForUpdates();
      expect(result.status).toBe('error');
      expect(result.error).toContain('GitHub API');
    });

    it('handles network errors', async () => {
      mockConfigState(null);
      const service = new SelfUpdateService();

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      globalThis.fetch = mockFetch as never;

      const result = await service.checkForUpdates();
      expect(result.status).toBe('error');
      expect(result.error).toContain('Network failure');
    });
  });

  describe('downloadAndApply', () => {
    it('does nothing if status is not available', async () => {
      mockConfigState(null);
      const service = new SelfUpdateService();

      const result = await service.downloadAndApply();
      expect(result.status).toBe('idle');
    });

    it('downloads and applies via the management update endpoint', async () => {
      mockConfigState(null);
      const service = new SelfUpdateService();

      const releaseResponse = new Response(
        JSON.stringify({
          tag_name: 'v999.0.0',
          html_url: 'https://github.com/org/repo/releases/tag/v999.0.0',
          assets: [{ name: 'management.html', browser_download_url: 'https://example.com/management.html' }],
        }),
        { status: 200 }
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(releaseResponse as never);

      await service.checkForUpdates();

      const htmlContent = '<html>updated management page</html>';
      const downloadResponse = new Response(htmlContent, { status: 200 });

      const mockApiClientPut = vi.fn().mockResolvedValue({});
      vi.doMock('@/services/api/client', () => ({
        apiClient: { put: mockApiClientPut },
      }));

      globalThis.fetch = vi.fn().mockResolvedValue(downloadResponse as never);

      const result = await service.downloadAndApply();
      expect(result.status).toBe('up_to_date');
    });
  });

  describe('startAutoCheck and stopAutoCheck', () => {
    it('starts and stops auto-check timer', () => {
      mockConfigState(null);
      const service = new SelfUpdateService();

      vi.useFakeTimers();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tag_name: 'v1.0.0' }), { status: 200 })
      );
      globalThis.fetch = mockFetch as never;

      service.startAutoCheck(10_000);

      vi.advanceTimersByTime(9_999);
      expect(mockFetch).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);

      service.stopAutoCheck();
      vi.useRealTimers();
    });
  });
});
