/**
 * 使用统计相关 API
 */

import type { AxiosRequestConfig } from 'axios';
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

export interface UsageReportResponse {
  total_requests?: number;
  failed_requests?: number;
  origin?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface UsageEvent {
  timestamp: string | number;
  source: string;
  auth_index?: string | number | null;
  provider?: string;
  model?: string;
  endpoint?: string;
  request_id?: string;
  latency_ms?: number;
  failed?: boolean;
  tokens?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cached_tokens?: number;
    cache_tokens?: number;
    total_tokens?: number;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cached_tokens?: number;
    total_tokens?: number;
  };
  [key: string]: unknown;
}

const normalizeUsageEventsResponse = (response: unknown): UsageEvent[] => {
  if (Array.isArray(response)) {
    return response as UsageEvent[];
  }

  if (
    response &&
    typeof response === 'object' &&
    'events' in response &&
    Array.isArray((response as { events?: unknown }).events)
  ) {
    return (response as { events: UsageEvent[] }).events;
  }

  return [];
};

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: (config?: AxiosRequestConfig) =>
    apiClient
      .get<Record<string, unknown>>('/usage', {
        timeout: USAGE_TIMEOUT_MS,
        ...config,
      })
      .then((response) => {
        const isValidResponse = response && typeof response === 'object' && !Array.isArray(response);
        const hasApis = isValidResponse && 'apis' in response && response.apis !== null && typeof response.apis === 'object';
        const hasUsage =
          isValidResponse && 'usage' in response && response.usage !== null && typeof response.usage === 'object';
        if (!hasApis && !hasUsage) {
          throw new Error(
            '[UsageAPI] Unexpected response structure: missing "apis" or "usage" field'
          );
        }
        return response;
      }),

  /**
   * 获取请求事件明细（完整字段列表）
   */
  getUsageEvents: (config?: AxiosRequestConfig) =>
    apiClient
      .get<unknown>('/usage-events', {
        timeout: USAGE_TIMEOUT_MS,
        ...config,
      })
      .then(normalizeUsageEventsResponse),

  /**
   * 从当前后端兼容的 usage 队列中拉取事件
   */
  getUsageQueue: (count = 1000, config?: AxiosRequestConfig) =>
    apiClient
      .get<unknown>(`/usage-queue?count=${count}`, {
        timeout: USAGE_TIMEOUT_MS,
        ...config,
      })
      .then(normalizeUsageEventsResponse),

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
    apiClient.post<UsageReportResponse>('/usage/reports', payload, { timeout: USAGE_TIMEOUT_MS }),

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
