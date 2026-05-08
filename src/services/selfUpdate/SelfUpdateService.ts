import { useConfigStore } from '@/stores';
import { getErrorMessage } from '@/utils/error';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'applying' | 'up_to_date' | 'error';

export type UpdateInfo = {
  status: UpdateStatus;
  latestVersion: string | null;
  currentVersion: string;
  releaseUrl: string | null;
  error: string | null;
};

type UpdateListener = (info: UpdateInfo) => void;

type ParsedRepo = {
  owner: string;
  repo: string;
};

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

const parseGitHubRepo = (raw: string): ParsedRepo | null => {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const urlMatch = cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git|\/.*)?$/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') };
  }

  const pathMatch = cleaned.match(/^([^/]+)\/([^/]+)$/);
  if (pathMatch) {
    return { owner: pathMatch[1], repo: pathMatch[2].replace(/\.git$/, '') };
  }

  return null;
};

const FETCH_TIMEOUT_MS = 15_000;

async function computeSHA256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const fetchWithTimeout = async (url: string, signal?: AbortSignal): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const linkedSignal = signal
    ? (() => {
        signal.addEventListener('abort', () => controller.abort());
        return controller.signal;
      })()
    : controller.signal;

  try {
    const response = await fetch(url, { signal: linkedSignal, headers: { Accept: 'application/vnd.github+json' } });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

export class SelfUpdateService {
  private info: UpdateInfo = {
    status: 'idle',
    latestVersion: null,
    currentVersion: __APP_VERSION__ || 'unknown',
    releaseUrl: null,
    error: null,
  };
  private listeners = new Set<UpdateListener>();
  private autoCheckTimerId: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private releaseAssets: ReleaseAsset[] = [];

  getUpdateInfo(): UpdateInfo {
    return { ...this.info };
  }

  subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const snapshot = this.getUpdateInfo();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  private setStatus(partial: Partial<UpdateInfo>) {
    this.info = { ...this.info, ...partial };
    this.emit();
  }

  private getPanelRepo(): string | null {
    try {
      const config = useConfigStore.getState().config;
      if (!config) return null;

      const raw = config.raw;
      if (!raw || typeof raw !== 'object') return null;

      const rm = (raw as Record<string, unknown>)['remote-management'];
      if (!rm || typeof rm !== 'object') return null;

      const rmRecord = rm as Record<string, unknown>;
      const repo = rmRecord['panel-github-repository'] ?? rmRecord['panel-repo'];
      if (typeof repo !== 'string' || !repo.trim()) return null;

      return repo.trim();
    } catch {
      return null;
    }
  }

  private getHashAsset(): ReleaseAsset | null {
    return this.releaseAssets.find((asset) => asset.name === 'management.html.sha256') ?? null;
  }

  private async readExpectedHash(hashAsset: ReleaseAsset): Promise<string> {
    const hashResponse = await fetch(hashAsset.browser_download_url);
    if (!hashResponse.ok) {
      throw new Error(`SHA256 文件下载失败 (${hashResponse.status})`);
    }

    const expectedHash = (await hashResponse.text()).trim().split(/\s+/)[0] ?? '';
    if (!expectedHash) {
      throw new Error('SHA256 文件为空或格式无效');
    }

    return expectedHash;
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.setStatus({ status: 'checking', error: null });

    try {
      const panelRepo = this.getPanelRepo() || 'router-for-me/Cli-Proxy-API-Management-Center';
      const parsed = parseGitHubRepo(panelRepo);

      if (!parsed) {
        this.setStatus({
          status: 'error',
          error: `无法解析面板仓库地址: ${panelRepo}`,
        });
        return this.getUpdateInfo();
      }

      const response = await fetchWithTimeout(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/latest`,
        signal
      );

      if (!response.ok) {
        this.setStatus({
          status: 'error',
          error: `GitHub API 请求失败 (${response.status}): ${response.statusText}`,
        });
        return this.getUpdateInfo();
      }

      type GitHubRelease = { tag_name?: string; html_url?: string; assets?: { browser_download_url: string; name: string }[] };

      const data = (await response.json()) as GitHubRelease;
      const latestRaw = data?.tag_name ?? '';
      const latest = typeof latestRaw === 'string' ? latestRaw : String(latestRaw ?? '');

      if (!latest) {
        this.setStatus({ status: 'error', error: '无法获取最新版本信息' });
        return this.getUpdateInfo();
      }

      const managementAsset = data.assets?.find(
        (a) => a.name === 'management.html'
      );
      const releaseUrl = managementAsset?.browser_download_url ?? data.html_url ?? null;

      this.releaseAssets = data.assets ?? [];

      const comparison = compareVersions(latest, this.info.currentVersion);

      if (comparison === null) {
        this.setStatus({
          status: 'error',
          latestVersion: latest,
          releaseUrl,
          error: '版本号格式无法比较，已拒绝自动更新',
        });
        return this.getUpdateInfo();
      }

      if (comparison > 0) {
        this.setStatus({
          status: 'available',
          latestVersion: latest,
          releaseUrl,
        });
      } else {
        this.setStatus({
          status: 'up_to_date',
          latestVersion: latest,
          releaseUrl,
        });
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return this.getUpdateInfo();
      }
      this.setStatus({
        status: 'error',
        error: `版本检查失败: ${getErrorMessage(err)}`,
      });
    } finally {
      if (this.abortController?.signal === signal) {
        this.abortController = null;
      }
    }

    return this.getUpdateInfo();
  }

  async downloadAndApply(): Promise<UpdateInfo> {
    if (!this.info.releaseUrl || this.info.status !== 'available') {
      return this.getUpdateInfo();
    }

    this.setStatus({ status: 'downloading', error: null });

    try {
      const response = await fetch(this.info.releaseUrl);
      if (!response.ok) {
        this.setStatus({
          status: 'error',
          error: `下载失败 (${response.status})`,
        });
        return this.getUpdateInfo();
      }

      const content = await response.text();

      const contentHash = await computeSHA256(content);
      const hashAsset = this.getHashAsset();
      if (!hashAsset) {
        this.setStatus({
          status: 'error',
          error: '发布资产缺少 management.html.sha256，已拒绝自动更新',
        });
        return this.getUpdateInfo();
      }

      let expectedHash = '';
      try {
        expectedHash = await this.readExpectedHash(hashAsset);
      } catch (err: unknown) {
        this.setStatus({
          status: 'error',
          error: `无法验证更新完整性: ${getErrorMessage(err)}`,
        });
        return this.getUpdateInfo();
      }

      if (contentHash !== expectedHash) {
        this.setStatus({
          status: 'error',
          error: `完整性校验失败: SHA256 不匹配 (期望 ${expectedHash.slice(0, 16)}..., 实际 ${contentHash.slice(0, 16)}...)`,
        });
        return this.getUpdateInfo();
      }

      this.setStatus({ status: 'applying' });

      try {
        const { apiClient } = await import('@/services/api/client');
        await apiClient.put('/v0/management/update', content, {
          headers: {
            'Content-Type': 'text/html',
            Accept: 'application/json, text/plain, */*',
          },
        });
      } catch (uploadErr: unknown) {
        this.setStatus({
          status: 'error',
          error: `文件替换失败: ${getErrorMessage(uploadErr)}`,
        });
        return this.getUpdateInfo();
      }

      this.setStatus({ status: 'up_to_date', latestVersion: this.info.latestVersion });
    } catch (err: unknown) {
      this.setStatus({
        status: 'error',
        error: `更新失败: ${getErrorMessage(err)}`,
      });
    }

    return this.getUpdateInfo();
  }

  startAutoCheck(intervalMs: number = 3600_000) {
    this.stopAutoCheck();
    this.autoCheckTimerId = setInterval(() => {
      void this.checkForUpdates();
    }, intervalMs);
  }

  stopAutoCheck() {
    if (this.autoCheckTimerId !== null) {
      clearInterval(this.autoCheckTimerId);
      this.autoCheckTimerId = null;
    }
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

export const selfUpdateService = new SelfUpdateService();

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};
