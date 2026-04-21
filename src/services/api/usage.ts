/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AutoPersistUsagePayload extends UsageExportPayload {
  origin: 'cli-proxy-auto-persist';
  session_id: string;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: () =>
    apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS }).then((response) => {
      const isValidResponse = response && typeof response === 'object' && !Array.isArray(response);
      const hasApis = isValidResponse && 'apis' in response && typeof response.apis === 'object';
      const hasUsage = isValidResponse && 'usage' in response && typeof response.usage === 'object';
      if (!hasApis && !hasUsage) {
        throw new Error('[UsageAPI] Unexpected response structure: missing "apis" or "usage" field');
      }
      return response;
    }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 自动持久化使用统计快照
   */
  autoPersistUsage: (payload: AutoPersistUsagePayload) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS });
      const isValidResponse = response && typeof response === 'object';
      if (!isValidResponse) {
        console.warn('[UsageAPI] Invalid response from /usage:', response);
        return computeKeyStats({});
      }
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  }
};
