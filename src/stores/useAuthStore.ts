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
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { CacheLayer } from '@/services/cache';
import { clearModelsCache } from '@/features/authFiles/hooks/useAuthFilesModels';

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

// Scope key helpers (mirrors the logic in useUsageStatsStore to avoid circular imports)
const hashScopeSegment = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const buildScopeKey = (apiBase: string, managementKey: string) =>
  `${apiBase}::${hashScopeSegment(managementKey)}`;

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

  // 恢复会话并自动登录
  restoreSession: () => {
    if (restoreSessionPromise) return restoreSessionPromise;

    restoreSessionPromise = (async () => {
      secureStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);

      const wasLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
      const legacyBase =
        secureStorage.getItem<string>('apiBase') ||
        secureStorage.getItem<string>('apiUrl', { encrypt: true });

      // 从 secureStorage (localStorage) 获取 managementKey
      let legacyKey = secureStorage.getItem<string>('managementKey');

      // 如果 localStorage 没有 key，检查 sessionStorage
      if (!legacyKey) {
        const sessionKey = sessionStorage.getItem('sessionManagementKey');
        if (sessionKey) {
          legacyKey = sessionKey;
        }
      }

      // ✅ 原子性恢复：先收集所有值，一次性写入，避免并发竞态
      const currentState = get();
      const resolvedBase = normalizeApiBase(
        currentState.apiBase || legacyBase || detectApiBaseFromLocation()
      );
      const resolvedKey = currentState.managementKey || legacyKey || '';
      const resolvedRememberPassword =
        currentState.rememberPassword || Boolean(currentState.managementKey) || Boolean(legacyKey);

      // 原子提交所有状态变更
      set({
        apiBase: resolvedBase,
        managementKey: resolvedKey,
        rememberPassword: resolvedRememberPassword,
      });

      apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey });

      if (wasLoggedIn && resolvedBase && resolvedKey) {
        try {
          // ✅ 使用本地捕获的值，不再信任异步后的 get() 结果
          await get().login({
            apiBase: resolvedBase,
            managementKey: resolvedKey,
            rememberPassword: resolvedRememberPassword,
          });
          return true;
        } catch (error) {
          console.warn('Auto login failed:', error);
          // ✅ 失败后重置 promise，允许重试
          restoreSessionPromise = null;
          return false;
        }
      }

      // ✅ 无论是否登录成功，都重置 promise
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

      // 始终设置登录状态，允许刷新后自动登录
      localStorage.setItem('isLoggedIn', 'true');

      // 根据 rememberPassword 选择 key 持久化方式
      if (rememberPassword) {
        // 持久化到 localStorage（加密存储，跨 tab 有效）
        secureStorage.setItem('managementKey', managementKey);
        sessionStorage.removeItem('sessionManagementKey');
      } else {
        // 仅在当前 tab 有效，tab 关闭后自动清除
        sessionStorage.setItem('sessionManagementKey', managementKey);
      }
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
    const { apiBase, managementKey } = get();
    restoreSessionPromise = null;
    useConfigStore.getState().clearCache();
    useUsageStatsStore.getState().clearUsageStats();
    useQuotaStore.getState().clearQuotaCache();
    clearModelsCache();

    // Invalidate all localStorage cache entries for this scope (cross-account data泄露)
    const scopeKey = apiBase && managementKey ? buildScopeKey(apiBase, managementKey) : '';
    if (scopeKey) {
      CacheLayer.invalidateScope(scopeKey);
    }

    set({
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      serverVersion: null,
      serverBuildDate: null,
      connectionStatus: 'disconnected',
      connectionError: null,
    });
    // 清除所有存储的认证信息
    localStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('sessionManagementKey');
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
