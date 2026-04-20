/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'gemini-cli'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'vertex'
  | 'empty'
  | 'unknown';

export type DegradedReason =
  | '401_unauthorized'
  | '403_forbidden'
  | '429_rate_limited'
  | 'server_error'
  | 'timeout'
  | 'manual';

export interface AccountHealthState {
  degraded: boolean;
  degradedReason?: DegradedReason;
  degradedStatus?: number;
  degradedMessage?: string;
  consecutiveFailures: number;
  failureStatuses: number[];
  degradedAt?: number;
  cooldownUntil?: number | null;
  manualDegraded?: boolean;
  stale?: boolean;
}

export type AccountHealthMap = Record<string, AccountHealthState>;

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  size?: number;
  authIndex?: string | number | null;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  lastRefresh?: string | number;
  modified?: number;
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
}
