/**
 * 认证相关 API Hooks
 * 提供登录、登出、验证密钥、刷新 Token 等认证操作
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { useNotificationStore } from '@/stores';

// ==================== 类型定义 ====================

/** 登录请求参数 */
export interface LoginParams {
  username?: string;
  password?: string;
  apiKey?: string;
}

/** 登录响应 */
export interface LoginResponse {
  success: boolean;
  token?: string;
  expiresAt?: string;
  message?: string;
}

/** 验证密钥响应 */
export interface VerifyKeyResponse {
  valid: boolean;
  expiresAt?: string;
  message?: string;
}

/** 刷新 Token 响应 */
export interface RefreshTokenResponse {
  token?: string;
  expiresAt?: string;
  message?: string;
}

/** 通用 API 响应 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

// ==================== Hooks ====================

/**
 * 登录 Hook
 * POST /auth/login
 */
export function useLogin() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (params: LoginParams): Promise<LoginResponse> => {
      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.post<LoginResponse>('/auth/login', params);
        const data = response as unknown as LoginResponse;

        if (data.success) {
          showNotification(t('auth.login_success'), 'success');
        } else {
          showNotification(data.message || t('auth.login_failed'), 'error');
        }

        return data;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('auth.login_failed');
        setError(errorMessage);
        showNotification(errorMessage, 'error');
        return { success: false, message: errorMessage };
      } finally {
        setLoading(false);
      }
    },
    [t, showNotification]
  );

  return {
    login,
    loading,
    error,
  };
}

/**
 * 登出 Hook
 * POST /auth/logout
 */
export function useLogout() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [loading, setLoading] = useState(false);

  const logout = useCallback(async (): Promise<void> => {
    setLoading(true);

    try {
      await apiClient.post('/auth/logout');
      showNotification(t('auth.logout_success'), 'success');
    } catch (err: unknown) {
      // 登出失败不影响客户端状态清理
      const errorMessage = err instanceof Error ? err.message : t('auth.logout_failed');
      showNotification(errorMessage, 'warning');
    } finally {
      setLoading(false);
    }
  }, [t, showNotification]);

  return {
    logout,
    loading,
  };
}

/**
 * 验证密钥 Hook
 * POST /auth/verify
 */
export function useVerifyKey() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [loading, setLoading] = useState(false);

  const verifyKey = useCallback(
    async (key: string): Promise<VerifyKeyResponse> => {
      setLoading(true);

      try {
        const response = await apiClient.post<VerifyKeyResponse>('/auth/verify', { key });
        const data = response as unknown as VerifyKeyResponse;

        if (data.valid) {
          showNotification(t('auth.verify_success'), 'success');
        } else {
          showNotification(data.message || t('auth.verify_failed'), 'warning');
        }

        return data;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('auth.verify_failed');
        showNotification(errorMessage, 'error');
        return { valid: false, message: errorMessage };
      } finally {
        setLoading(false);
      }
    },
    [t, showNotification]
  );

  return {
    verifyKey,
    loading,
  };
}

/**
 * 刷新 Token Hook
 * POST /auth/refresh
 */
export function useRefreshToken() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [loading, setLoading] = useState(false);

  const refreshToken = useCallback(
    async (refreshTokenValue?: string): Promise<RefreshTokenResponse> => {
      setLoading(true);

      try {
        const params = refreshTokenValue ? { refreshToken: refreshTokenValue } : {};
        const response = await apiClient.post<RefreshTokenResponse>('/auth/refresh', params);
        const data = response as unknown as RefreshTokenResponse;

        if (data.token) {
          showNotification(t('auth.refresh_success'), 'success');
        } else {
          showNotification(data.message || t('auth.refresh_failed'), 'warning');
        }

        return data;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('auth.refresh_failed');
        showNotification(errorMessage, 'error');
        return { message: errorMessage };
      } finally {
        setLoading(false);
      }
    },
    [t, showNotification]
  );

  return {
    refreshToken,
    loading,
  };
}

// ==================== 组合 Hook ====================

/**
 * 完整的认证 API Hook
 * 组合所有认证相关操作
 */
export function useAuthApi() {
  const loginHook = useLogin();
  const logoutHook = useLogout();
  const verifyKeyHook = useVerifyKey();
  const refreshTokenHook = useRefreshToken();

  return {
    // Login
    login: loginHook.login,
    loginLoading: loginHook.loading,
    loginError: loginHook.error,

    // Logout
    logout: logoutHook.logout,
    logoutLoading: logoutHook.loading,

    // Verify Key
    verifyKey: verifyKeyHook.verifyKey,
    verifyKeyLoading: verifyKeyHook.loading,

    // Refresh Token
    refreshToken: refreshTokenHook.refreshToken,
    refreshTokenLoading: refreshTokenHook.loading,
  };
}
