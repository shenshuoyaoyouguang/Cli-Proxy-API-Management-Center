import React, { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

type RefreshAggregateResultMock = {
  total: number;
  succeeded: number;
  failed: number;
  failures: Array<{
    id: string;
    scope?: string;
    errorMessage: string;
  }>;
};

const mocks = vi.hoisted(() => {
  const clearCache = vi.fn();
  const fetchConfig = vi.fn(async () => {});
  const triggerHeaderRefresh = vi.fn(async (): Promise<RefreshAggregateResultMock> => ({
    total: 0,
    succeeded: 0,
    failed: 0,
    failures: [],
  }));
  const showNotification = vi.fn();
  const logout = vi.fn();

  return {
    clearCache,
    fetchConfig,
    triggerHeaderRefresh,
    showNotification,
    logout,
    setTheme: vi.fn(),
    setLanguage: vi.fn(),
  };
});

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('lodash-es', () => ({
  throttle: <T extends (...args: never[]) => unknown>(fn: T) => {
    const wrapped = ((...args: Parameters<T>) => fn(...args)) as T & { cancel: () => void };
    wrapped.cancel = () => {};
    return wrapped;
  },
}));

vi.mock('react-router', () => ({
  NavLink: ({
    to,
    children,
    className,
    onClick,
  }: React.PropsWithChildren<{
    to: string;
    className?: string | ((options: { isActive: boolean }) => string);
    onClick?: () => void;
  }>) =>
    createElement(
      'a',
      {
        href: to,
        onClick,
        className:
          typeof className === 'function' ? className({ isActive: to === '/' || to === '/dashboard' }) : className,
      },
      children
    ),
  useLocation: () => ({ pathname: '/dashboard' }),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    title,
    className,
    ariaLabel,
  }: React.PropsWithChildren<{
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    className?: string;
    ariaLabel?: string;
  }>) =>
    createElement(
      'button',
      {
        type: 'button',
        onClick,
        disabled,
        title,
        className,
        'aria-label': ariaLabel,
      },
      children
    ),
}));

vi.mock('@/components/common/PageTransition', () => ({
  PageTransition: ({ render }: { render: (location: { pathname: string }) => React.ReactNode }) =>
    createElement('div', null, render({ pathname: '/dashboard' })),
}));

vi.mock('@/router/MainRoutes', () => ({
  MainRoutes: () => createElement('div', null, 'main-routes'),
}));

vi.mock('@/assets/logoInline', () => ({
  INLINE_LOGO_JPEG: 'logo.jpg',
}));

vi.mock('@/hooks/useHeaderRefresh', () => ({
  triggerHeaderRefresh: mocks.triggerHeaderRefresh,
}));

vi.mock('@/stores', () => ({
  useNotificationStore: () => ({
    showNotification: mocks.showNotification,
  }),
  useAuthStore: <T,>(
    selector: (state: {
      apiBase: string;
      connectionStatus: string;
      logout: () => void;
    }) => T
  ) =>
    selector({
      apiBase: 'http://localhost:3000',
      connectionStatus: 'connected',
      logout: mocks.logout,
    }),
  useConfigStore: <T,>(
    selector: (state: {
      config: { loggingToFile: boolean };
      fetchConfig: (...args: unknown[]) => Promise<void>;
      clearCache: () => void;
    }) => T
  ) =>
    selector({
      config: { loggingToFile: true },
      fetchConfig: mocks.fetchConfig,
      clearCache: mocks.clearCache,
    }),
  useThemeStore: <T,>(
    selector: (state: {
      theme: string;
      setTheme: (value: string) => void;
    }) => T
  ) =>
    selector({
      theme: 'auto',
      setTheme: mocks.setTheme,
    }),
  useLanguageStore: <T,>(
    selector: (state: {
      language: string;
      setLanguage: (value: string) => void;
    }) => T
  ) =>
    selector({
      language: 'zh-CN',
      setLanguage: mocks.setLanguage,
    }),
}));

vi.mock('@/utils/constants', () => ({
  LANGUAGE_LABEL_KEYS: {
    'zh-CN': 'language.zh-CN',
    en: 'language.en',
  },
  LANGUAGE_ORDER: ['zh-CN', 'en'],
}));

vi.mock('@/utils/language', () => ({
  isSupportedLanguage: () => true,
}));

describe('MainLayout', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('runs the global refresh flow and shows a success notification', async () => {
    const { MainLayout } = await import('./MainLayout');

    render(createElement(MainLayout));

    fireEvent.click(screen.getByTitle('header.refresh_all'));

    await waitFor(() => {
      expect(mocks.clearCache).toHaveBeenCalledTimes(1);
      expect(mocks.fetchConfig).toHaveBeenCalledWith(undefined, true);
      expect(mocks.triggerHeaderRefresh).toHaveBeenCalledTimes(1);
      expect(mocks.showNotification).toHaveBeenCalledWith('notification.data_refreshed', 'success');
    });
  });

  it('shows an error notification when any header refresh handler fails', async () => {
    mocks.triggerHeaderRefresh.mockResolvedValueOnce({
      total: 2,
      succeeded: 1,
      failed: 1,
      failures: [{ id: 'usage', errorMessage: 'partial refresh failed' }],
    } as RefreshAggregateResultMock);

    const { MainLayout } = await import('./MainLayout');

    render(createElement(MainLayout));

    fireEvent.click(screen.getByTitle('header.refresh_all'));

    await waitFor(() => {
      expect(mocks.showNotification).toHaveBeenCalledWith(
        'notification.refresh_failed: partial refresh failed',
        'error'
      );
    });
  });
});
