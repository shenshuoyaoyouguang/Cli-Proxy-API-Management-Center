import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('@/services/storage/secureStorage', () => ({
  secureStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    migratePlaintextKeys: vi.fn(),
  },
}));

vi.mock('@/services/api/client', () => ({
  apiClient: {
    setConfig: vi.fn(),
  },
}));

vi.mock('./useConfigStore', () => ({
  useConfigStore: {
    getState: vi.fn(() => ({
      fetchConfig: vi.fn(),
      clearCache: vi.fn(),
    })),
  },
}));

vi.mock('./useUsageStatsStore', () => ({
  useUsageStatsStore: {
    getState: vi.fn(() => ({
      clearUsageStats: vi.fn(),
    })),
  },
}));

vi.mock('@/utils/connection', () => ({
  detectApiBaseFromLocation: vi.fn(() => 'http://localhost:3000'),
  normalizeApiBase: vi.fn((base: string) => base.replace(/\/+$/, '')),
}));

import { useAuthStore } from './useAuthStore';
import { apiClient } from '@/services/api/client';

describe('useAuthStore', () => {
  let localStorageMock: Record<string, string>;
  let sessionStorageMock: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock = {};
    sessionStorageMock = {};

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => localStorageMock[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
    });

    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => sessionStorageMock[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        sessionStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete sessionStorageMock[key];
      }),
    });

    // Reset store state
    useAuthStore.setState({
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      rememberPassword: false,
      serverVersion: null,
      serverBuildDate: null,
      connectionStatus: 'disconnected',
      connectionError: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with unauthenticated state', () => {
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.apiBase).toBe('');
      expect(state.managementKey).toBe('');
      expect(state.connectionStatus).toBe('disconnected');
    });
  });

  describe('updateServerVersion', () => {
    it('updates server version and build date', () => {
      useAuthStore.getState().updateServerVersion('1.2.3', '2025-01-01');
      const state = useAuthStore.getState();
      expect(state.serverVersion).toBe('1.2.3');
      expect(state.serverBuildDate).toBe('2025-01-01');
    });

    it('sets null when version is empty string', () => {
      useAuthStore.getState().updateServerVersion('', null);
      const state = useAuthStore.getState();
      expect(state.serverVersion).toBeNull();
      expect(state.serverBuildDate).toBeNull();
    });

    it('handles undefined buildDate', () => {
      useAuthStore.getState().updateServerVersion('1.0.0');
      const state = useAuthStore.getState();
      expect(state.serverVersion).toBe('1.0.0');
      expect(state.serverBuildDate).toBeNull();
    });
  });

  describe('updateConnectionStatus', () => {
    it('updates connection status', () => {
      useAuthStore.getState().updateConnectionStatus('connected');
      expect(useAuthStore.getState().connectionStatus).toBe('connected');
      expect(useAuthStore.getState().connectionError).toBeNull();
    });

    it('updates connection status with error', () => {
      useAuthStore.getState().updateConnectionStatus('error', 'Network timeout');
      const state = useAuthStore.getState();
      expect(state.connectionStatus).toBe('error');
      expect(state.connectionError).toBe('Network timeout');
    });

    it('clears error when status changes to connected', () => {
      useAuthStore.setState({ connectionError: 'Previous error' });
      useAuthStore.getState().updateConnectionStatus('connected');
      expect(useAuthStore.getState().connectionError).toBeNull();
    });
  });

  describe('logout', () => {
    it('resets authentication state', () => {
      useAuthStore.setState({
        isAuthenticated: true,
        apiBase: 'http://localhost:3000',
        managementKey: 'test-key',
        serverVersion: '1.0.0',
        serverBuildDate: '2025-01-01',
        connectionStatus: 'connected',
        connectionError: null,
      });

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.apiBase).toBe('');
      expect(state.managementKey).toBe('');
      expect(state.serverVersion).toBeNull();
      expect(state.serverBuildDate).toBeNull();
      expect(state.connectionStatus).toBe('disconnected');
    });

    it('clears stored auth data', () => {
      useAuthStore.getState().logout();
      // Check that the mocked functions were called
      const localStorageRemove = vi.mocked(localStorage.removeItem);
      const sessionStorageRemove = vi.mocked(sessionStorage.removeItem);
      expect(localStorageRemove).toHaveBeenCalledWith('isLoggedIn');
      expect(sessionStorageRemove).toHaveBeenCalledWith('sessionManagementKey');
    });
  });

  describe('login', () => {
    it('sets connecting status during login attempt', async () => {
      const { useConfigStore } = await import('./useConfigStore');
      (useConfigStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        fetchConfig: vi.fn().mockRejectedValue(new Error('Connection failed')),
      });

      const loginPromise = useAuthStore.getState().login({
        apiBase: 'http://localhost:3000',
        managementKey: 'test-key',
      });

      expect(useAuthStore.getState().connectionStatus).toBe('connecting');

      await expect(loginPromise).rejects.toThrow();
    });

    it('sets error status on login failure', async () => {
      const { useConfigStore } = await import('./useConfigStore');
      (useConfigStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        fetchConfig: vi.fn().mockRejectedValue(new Error('Invalid key')),
      });

      await expect(
        useAuthStore.getState().login({
          apiBase: 'http://localhost:3000',
          managementKey: 'bad-key',
        })
      ).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.connectionStatus).toBe('error');
      expect(state.connectionError).toBe('Invalid key');
    });

    it('configures apiClient on login', async () => {
      const { useConfigStore } = await import('./useConfigStore');
      (useConfigStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        fetchConfig: vi.fn().mockResolvedValue(undefined),
      });

      await useAuthStore.getState().login({
        apiBase: 'http://localhost:3000',
        managementKey: 'test-key',
        rememberPassword: true,
      });

      expect(apiClient.setConfig).toHaveBeenCalledWith({
        apiBase: 'http://localhost:3000',
        managementKey: 'test-key',
      });
    });
  });

  describe('checkAuth', () => {
    it('returns false when no credentials are stored', async () => {
      const result = await useAuthStore.getState().checkAuth();
      expect(result).toBe(false);
    });

    it('returns true when credentials are valid', async () => {
      useAuthStore.setState({
        apiBase: 'http://localhost:3000',
        managementKey: 'test-key',
      });

      const { useConfigStore } = await import('./useConfigStore');
      (useConfigStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        fetchConfig: vi.fn().mockResolvedValue(undefined),
      });

      const result = await useAuthStore.getState().checkAuth();
      expect(result).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('returns false when connection fails', async () => {
      useAuthStore.setState({
        apiBase: 'http://localhost:3000',
        managementKey: 'test-key',
      });

      const { useConfigStore } = await import('./useConfigStore');
      (useConfigStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        fetchConfig: vi.fn().mockRejectedValue(new Error('Failed')),
      });

      const result = await useAuthStore.getState().checkAuth();
      expect(result).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
