/**
 * 认证状态管理
 * 从原项目 src/modules/login.js 和 src/core/connection.js 迁移
 */

import { create } from 'zustand';
// 移除 persist 中间件 - 与异步加密架构不兼容，改为手动异步恢复
import type { AuthState, LoginCredentials, ConnectionStatus } from '@/types';
import { secureStorage } from '@/services/storage/secureStorage';
import { apiClient } from '@/services/api/client';
import { useConfigStore } from './useConfigStore';
import { useUsageStatsStore } from './useUsageStatsStore';
import { useQuotaStore } from './useQuotaStore';
import { useAccountHealthStore } from './useAccountHealthStore';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { CacheLayer } from '@/services/cache';
import { clearModelsCache } from '@/features/authFiles/hooks/useAuthFilesModels';
import { buildScopeKey } from '@/utils/helpers';

interface AuthStoreState extends AuthState {
  connectionStatus: ConnectionStatus;
  connectionError: string | null;

  // 操作
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  updateServerVersion: (version: string | null, buildDate?: string | null) => void;
  updateConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
}

let restoreSessionPromise: Promise<boolean> | null = null;
const REMEMBER_CONNECTION_KEY = 'rememberConnection';

const shouldRememberConnection = (): boolean =>
  typeof localStorage !== 'undefined' && localStorage.getItem(REMEMBER_CONNECTION_KEY) === 'true';

const persistConnectionPreference = (apiBase: string, rememberConnection: boolean) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  if (rememberConnection && apiBase) {
    secureStorage.setItem('apiBase', apiBase, { encrypt: false });
    secureStorage.removeItem('apiUrl');
    localStorage.setItem(REMEMBER_CONNECTION_KEY, 'true');
    return;
  }

  secureStorage.removeItem('apiBase');
  secureStorage.removeItem('apiUrl');
  localStorage.removeItem(REMEMBER_CONNECTION_KEY);
};

const purgeSensitiveSessionStorage = () => {
  if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined') {
    return;
  }

  localStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('sessionManagementKey');
  secureStorage.removeItem('managementKey');
};

export const useAuthStore = create<AuthStoreState>()((set, get) => ({
  // 初始状态
  isAuthenticated: false,
  apiBase: '',
  managementKey: '',
  rememberPassword: false,
  serverVersion: null,
  serverBuildDate: null,
  connectionStatus: 'disconnected',
  connectionError: null,

  // 恢复连接信息，但不再从浏览器存储恢复管理密钥
  restoreSession: () => {
    if (restoreSessionPromise) return restoreSessionPromise;

    restoreSessionPromise = (async () => {
      const currentState = get();
      const rememberConnection = currentState.rememberPassword || shouldRememberConnection();
      const storedBase =
        currentState.apiBase ||
        secureStorage.getItem<string>('apiBase', { encrypt: false }) ||
        secureStorage.getItem<string>('apiUrl', { encrypt: false }) ||
        detectApiBaseFromLocation();
      const resolvedBase = normalizeApiBase(
        storedBase || detectApiBaseFromLocation()
      );
      purgeSensitiveSessionStorage();
      persistConnectionPreference(resolvedBase, rememberConnection);

      set({
        apiBase: resolvedBase,
        managementKey: '',
        rememberPassword: rememberConnection,
        isAuthenticated: false,
        connectionStatus: 'disconnected',
        connectionError: null,
      });

      apiClient.setConfig({ apiBase: resolvedBase, managementKey: '' });
      restoreSessionPromise = null;
      return false;
    })();

    return restoreSessionPromise;
  },

  // 登录
  login: async (credentials) => {
    const apiBase = normalizeApiBase(credentials.apiBase);
    const managementKey = credentials.managementKey.trim();
    const rememberPassword = credentials.rememberPassword ?? get().rememberPassword ?? false;

    try {
      set({ connectionStatus: 'connecting' });

      // 配置 API 客户端
      apiClient.setConfig({
        apiBase,
        managementKey,
      });

      // 测试连接 - 获取配置
      await useConfigStore.getState().fetchConfig(undefined, true);

      // 登录成功
      set({
        isAuthenticated: true,
        apiBase,
        managementKey,
        rememberPassword,
        connectionStatus: 'connected',
        connectionError: null,
      });

      purgeSensitiveSessionStorage();
      persistConnectionPreference(apiBase, rememberPassword);

      void useAccountHealthStore.getState().loadHealthMap({ apiBase, managementKey });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Connection failed';
      set({
        connectionStatus: 'error',
        connectionError: message || 'Connection failed',
      });
      throw error;
    }
  },

  // 登出
  logout: () => {
    const { apiBase, managementKey, rememberPassword } = get();
    restoreSessionPromise = null;
    useConfigStore.getState().clearCache();
    useUsageStatsStore.getState().clearUsageStats();
    useQuotaStore.getState().clearQuotaCache();
    useAccountHealthStore.getState().clearHealthMap();
    clearModelsCache();

    // Invalidate all localStorage cache entries for this scope (cross-account data泄露)
    const scopeKey = apiBase && managementKey ? buildScopeKey(apiBase, managementKey) : '';
    if (scopeKey) {
      CacheLayer.invalidateScope(scopeKey);
    }

    apiClient.setConfig({ apiBase: '', managementKey: '' });
    purgeSensitiveSessionStorage();
    persistConnectionPreference(apiBase, rememberPassword);

    set({
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      rememberPassword: false,
      serverVersion: null,
      serverBuildDate: null,
      connectionStatus: 'disconnected',
      connectionError: null,
    });

    // 清理页面级别的 localStorage 状态 (UsagePage, ConfigPage 等)
    const pageLevelKeys = [
      'cli-proxy-usage-chart-lines-v1',
      'cli-proxy-usage-time-range-v1',
      'cli-proxy-model-prices-v2',
      'authFilesPage.uiState',
      'authFilesPage.compactMode',
      'config-management:tab',
    ];
    pageLevelKeys.forEach((key) => localStorage.removeItem(key));
  },

  // 检查认证状态
  checkAuth: async () => {
    const { managementKey, apiBase } = get();

    if (!managementKey || !apiBase) {
      return false;
    }

    try {
      // 重新配置客户端
      apiClient.setConfig({ apiBase, managementKey });

      // 验证连接
      await useConfigStore.getState().fetchConfig();

      set({
        isAuthenticated: true,
        connectionStatus: 'connected',
      });

      return true;
    } catch {
      set({
        isAuthenticated: false,
        connectionStatus: 'error',
      });
      return false;
    }
  },

  // 更新服务器版本
  updateServerVersion: (version, buildDate) => {
    set({ serverVersion: version || null, serverBuildDate: buildDate || null });
  },

  // 更新连接状态
  updateConnectionStatus: (status, error = null) => {
    set({
      connectionStatus: status,
      connectionError: error,
    });
  },
}));

// 监听全局未授权事件
if (typeof window !== 'undefined') {
  window.addEventListener('unauthorized', () => {
    useAuthStore.getState().logout();
  });

  window.addEventListener('server-version-update', ((e: CustomEvent) => {
    const detail = e.detail || {};
    useAuthStore.getState().updateServerVersion(detail.version || null, detail.buildDate || null);
  }) as EventListener);
}
