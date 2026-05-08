import type { AxiosRequestConfig } from 'axios';
import { apiClient } from '../client';
import type { AuthFilesResponse } from '@/types/authFile';
import type { OAuthModelAliasEntry } from '@/types';
import {
  getStatusCode,
  normalizeRequestedAuthFileNames,
  normalizeBatchUploadResponse,
  normalizeBatchDeleteResponse,
  dedupeAuthFilesResponse,
  parseAuthFileJsonObject,
  normalizeOauthExcludedModels,
  normalizeOauthModelAlias,
  normalizeAccountHealthMap,
} from './normalize';
import type {
  AuthFileBatchUploadResponse,
  AuthFileBatchDeleteResponse,
  AuthFileBatchUploadResult,
  AuthFileBatchDeleteResult,
} from './normalize';

export {
  AUTH_FILE_INVALID_JSON_OBJECT_ERROR,
  isAuthFileInvalidJsonObjectError,
  normalizeRequestedAuthFileNames,
  normalizeBatchUploadResponse,
  normalizeBatchDeleteResponse,
  dedupeAuthFilesResponse,
  readTextField,
  readDateField,
  parseAuthFileJsonObject,
  normalizeOauthExcludedModels,
  normalizeOauthModelAlias,
  normalizeAccountHealthState,
  normalizeAccountHealthMap,
} from './normalize';

export type {
  AuthFileBatchFailure,
  AuthFileBatchUploadResponse,
  AuthFileBatchDeleteResponse,
  AuthFileBatchUploadResult,
  AuthFileBatchDeleteResult,
} from './normalize';

type AuthFileStatusResponse = { status: string; disabled: boolean };
type AuthFileStatusOptions = {
  disabled?: boolean;
  degraded?: boolean;
  degradedReason?: import('@/types/authFile').DegradedReason;
  cooldownUntil?: number | null;
};

const saveAuthFileText = async (name: string, text: string) => {
  const file = new File([text], name, { type: 'application/json' });
  await authFilesApi.upload(file);
};

const OAUTH_MODEL_ALIAS_ENDPOINT = '/oauth-model-alias';

export const authFilesApi = {
  list: async (config?: AxiosRequestConfig) =>
    dedupeAuthFilesResponse(await apiClient.get<AuthFilesResponse>('/auth-files', config)),

  setStatus: (name: string, options: boolean | AuthFileStatusOptions) =>
    apiClient.patch<AuthFileStatusResponse>('/auth-files/status', {
      name,
      ...(typeof options === 'boolean' ? { disabled: options } : options),
    }),

  async getAccountHealth(): Promise<import('@/types/authFile').AccountHealthMap> {
    const data = await apiClient.get('/auth-files/health');
    return normalizeAccountHealthMap(data);
  },

  updateAccountHealth: (updates: Record<string, import('@/types/authFile').AccountHealthState | null>) =>
    apiClient.put('/auth-files/health', updates),

  recoverAccount: (name: string) =>
    apiClient.post(`/auth-files/health/${encodeURIComponent(name)}/recover`, {}),

  uploadFiles: async (files: File[]): Promise<AuthFileBatchUploadResult> => {
    const requestedNames = files.map((file) => file.name);
    if (requestedNames.length === 0) {
      return { status: 'ok', uploaded: 0, files: [], failed: [] };
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('file', file, file.name);
    });
    const payload = await apiClient.postForm<AuthFileBatchUploadResponse>('/auth-files', formData);
    return normalizeBatchUploadResponse(payload, requestedNames);
  },

  upload: (file: File) => authFilesApi.uploadFiles([file]),

  deleteFiles: async (names: string[]): Promise<AuthFileBatchDeleteResult> => {
    const requestedNames = normalizeRequestedAuthFileNames(names);
    if (requestedNames.length === 0) {
      return { status: 'ok', deleted: 0, files: [], failed: [] };
    }

    const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', {
      data: { names: requestedNames },
    });
    return normalizeBatchDeleteResponse(payload, requestedNames);
  },

  deleteFile: (name: string) => authFilesApi.deleteFiles([name]),

  deleteAll: () => apiClient.delete('/auth-files', { params: { all: true } }),

  downloadText: async (name: string): Promise<string> => {
    const response = await apiClient.getRaw(`/auth-files/download?name=${encodeURIComponent(name)}`, {
      responseType: 'blob'
    });
    const blob = response.data as Blob;
    return blob.text();
  },

  async downloadJsonObject(name: string): Promise<Record<string, unknown>> {
    const rawText = await authFilesApi.downloadText(name);
    return parseAuthFileJsonObject(rawText);
  },

  saveText: (name: string, text: string) => saveAuthFileText(name, text),

  saveJsonObject: (name: string, json: Record<string, unknown>) =>
    saveAuthFileText(name, JSON.stringify(json)),

  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await apiClient.get('/oauth-excluded-models');
    return normalizeOauthExcludedModels(data);
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    apiClient.patch('/oauth-excluded-models', { provider, models }),

  deleteOauthExcludedEntry: (provider: string) =>
    apiClient.delete(`/oauth-excluded-models?provider=${encodeURIComponent(provider)}`),

  replaceOauthExcludedModels: (map: Record<string, string[]>) =>
    apiClient.put('/oauth-excluded-models', normalizeOauthExcludedModels(map)),

  async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
    const data = await apiClient.get(OAUTH_MODEL_ALIAS_ENDPOINT);
    return normalizeOauthModelAlias(data);
  },

  saveOauthModelAlias: async (channel: string, aliases: OAuthModelAliasEntry[]) => {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();
    const normalizedAliases = normalizeOauthModelAlias({ [normalizedChannel]: aliases })[normalizedChannel] ?? [];
    await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, { channel: normalizedChannel, aliases: normalizedAliases });
  },

  deleteOauthModelAlias: async (channel: string) => {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();

    try {
      await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, { channel: normalizedChannel, aliases: [] });
    } catch (err: unknown) {
      const status = getStatusCode(err);
      if (status !== 405) throw err;
      await apiClient.delete(`${OAUTH_MODEL_ALIAS_ENDPOINT}?channel=${encodeURIComponent(normalizedChannel)}`);
    }
  },

  async getModelsForAuthFile(name: string): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get<Record<string, unknown>>(
      `/auth-files/models?name=${encodeURIComponent(name)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  async getModelDefinitions(channel: string): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const normalizedChannel = String(channel ?? '').trim().toLowerCase();
    if (!normalizedChannel) return [];
    const data = await apiClient.get<Record<string, unknown>>(
      `/model-definitions/${encodeURIComponent(normalizedChannel)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  }
};
