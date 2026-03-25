/**
 * Model Management API
 */

import { apiClient } from './client';

export interface ModelConfig {
  id?: string;
  name: string;
  provider: string;
  alias?: string;
  priority?: number;
  testModel?: string;
  excludedModels?: string[];
  baseUrl?: string;
  headers?: Record<string, string>;
  proxyUrl?: string;
  [key: string]: unknown;
}

export interface ModelProvider {
  name: string;
  displayName: string;
  supportedModels?: string[];
  requiresAuth?: boolean;
}

const extractArrayPayload = (data: unknown, key: string): unknown[] => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const candidate =
    (data as Record<string, unknown>)[key] ??
    (data as Record<string, unknown>).items ??
    (data as Record<string, unknown>).data ??
    data;
  return Array.isArray(candidate) ? candidate : [];
};

const serializeModelConfig = (config: ModelConfig) => {
  const payload: Record<string, unknown> = { name: config.name, provider: config.provider };
  if (config.id) payload.id = config.id;
  if (config.alias && config.alias !== config.name) payload.alias = config.alias;
  if (config.priority !== undefined) payload.priority = config.priority;
  if (config.testModel) payload['test-model'] = config.testModel;
  if (config.excludedModels && config.excludedModels.length)
    payload['excluded-models'] = config.excludedModels;
  if (config.baseUrl) payload['base-url'] = config.baseUrl;
  if (config.proxyUrl) payload['proxy-url'] = config.proxyUrl;
  if (config.headers && Object.keys(config.headers).length) payload.headers = config.headers;
  return payload;
};

export const modelsManagementApi = {
  async list(): Promise<ModelConfig[]> {
    const data = await apiClient.get('/models');
    const list = extractArrayPayload(data, 'models');
    return list as ModelConfig[];
  },

  create: (config: Omit<ModelConfig, 'id'>) =>
    apiClient.post('/models', serializeModelConfig(config as ModelConfig)),

  update: (id: string, config: Partial<ModelConfig>) =>
    apiClient.put(
      `/models/${encodeURIComponent(id)}`,
      serializeModelConfig({ id, ...config } as ModelConfig)
    ),

  delete: (id: string) => apiClient.delete(`/models/${encodeURIComponent(id)}`),

  async getProviders(): Promise<ModelProvider[]> {
    const data = await apiClient.get('/models/providers');
    const list = extractArrayPayload(data, 'providers');
    return list as ModelProvider[];
  },
};
