/**
 * API 密钥管理
 */

import type { AxiosRequestConfig } from 'axios';
import { apiClient } from './client';

export const apiKeysApi = {
  async list(config?: AxiosRequestConfig): Promise<string[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys', config);
    const keys = data['api-keys'] ?? data.apiKeys;
    return Array.isArray(keys) ? keys.map((key) => String(key)) : [];
  },

  replace: (keys: string[]) => apiClient.put('/api-keys', keys),

  update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`)
};
