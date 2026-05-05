import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const navigateSpy = vi.fn();
  const showNotificationSpy = vi.fn();
  const authState = {
    isAuthenticated: false,
    apiBase: '',
    rememberPassword: false,
    login: vi.fn(),
    restoreSession: vi.fn(async () => {
      authState.apiBase = 'http://custom-server:3000';
      authState.rememberPassword = true;
      return false;
    }),
  };
  const languageState = {
    language: 'zh-CN',
    setLanguage: vi.fn(),
  };

  return {
    authState,
    languageState,
    navigateSpy,
    showNotificationSpy,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router', () => ({
  Navigate: ({ to }: { to: string }) => createElement('div', { 'data-navigate-to': to }),
  useNavigate: () => mocks.navigateSpy,
  useLocation: () => ({ state: null }),
}));

vi.mock('@/stores', () => {
  type AuthSelector<T> = (state: typeof mocks.authState) => T;
  type LanguageSelector<T> = (state: typeof mocks.languageState) => T;

  const useAuthStore = (<T,>(selector: AuthSelector<T>) => selector(mocks.authState)) as {
    <T>(selector: AuthSelector<T>): T;
    getState: () => typeof mocks.authState;
  };
  useAuthStore.getState = () => mocks.authState;

  const useLanguageStore = (<T,>(selector: LanguageSelector<T>) =>
    selector(mocks.languageState)) as {
    <T>(selector: LanguageSelector<T>): T;
  };

  return {
    useAuthStore,
    useLanguageStore,
    useNotificationStore: () => ({
      showNotification: mocks.showNotificationSpy,
    }),
  };
});

vi.mock('@/utils/connection', () => ({
  detectApiBaseFromLocation: () => 'http://detected-server:3000',
  normalizeApiBase: (value: string) => value.replace(/\/+$/, ''),
}));

vi.mock('@/utils/constants', () => ({
  LANGUAGE_LABEL_KEYS: { 'zh-CN': 'language.zh-CN' },
  LANGUAGE_ORDER: ['zh-CN'],
}));

vi.mock('@/utils/language', () => ({
  isSupportedLanguage: () => true,
}));

vi.mock('@/assets/logoInline', () => ({
  INLINE_LOGO_JPEG: 'logo.jpg',
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        onClick,
        disabled,
        'data-loading': loading ? 'true' : 'false',
      },
      children
    ),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: ({
    label,
    value,
    onChange,
    onKeyDown,
    type = 'text',
    rightElement,
    autoFocus,
  }: {
    label?: string;
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    onKeyDown?: (event: KeyboardEvent) => void;
    type?: string;
    rightElement?: ReactNode;
    autoFocus?: boolean;
  }) =>
    createElement(
      'label',
      null,
      label,
      createElement('input', {
        value: value ?? '',
        type,
        autoFocus,
        onInput: (event: Event) =>
          onChange?.({ target: { value: (event.target as HTMLInputElement).value } }),
        onKeyDown,
      }),
      rightElement
    ),
}));

vi.mock('@/components/ui/Select', () => ({
  Select: ({
    value,
    options,
    onChange,
    ariaLabel,
  }: {
    value?: string;
    options: Array<{ value: string; label: string }>;
    onChange?: (value: string) => void;
    ariaLabel?: string;
  }) =>
    createElement(
      'select',
      {
        value,
        'aria-label': ariaLabel,
        onChange: (event: Event) => onChange?.((event.target as HTMLSelectElement).value),
      },
      options.map((option) =>
        createElement('option', { key: option.value, value: option.value }, option.label)
      )
    ),
}));

vi.mock('@/components/ui/SelectionCheckbox', () => ({
  SelectionCheckbox: ({
    checked,
    onChange,
    ariaLabel,
    label,
  }: {
    checked?: boolean;
    onChange?: (value: boolean) => void;
    ariaLabel?: string;
    label?: string;
  }) =>
    createElement(
      'label',
      null,
      label,
      createElement('input', {
        type: 'checkbox',
        checked: Boolean(checked),
        'aria-label': ariaLabel,
        onChange: (event: Event) => onChange?.((event.target as HTMLInputElement).checked),
      })
    ),
}));

vi.mock('@/components/ui/icons', () => ({
  IconEye: () => null,
  IconEyeOff: () => null,
}));

import { LoginPage } from './LoginPage';

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('LoginPage', () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.isAuthenticated = false;
    mocks.authState.apiBase = '';
    mocks.authState.rememberPassword = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      root = null;
    });
    container.remove();
    document.body.innerHTML = '';
  });

  it('hydrates remembered connection details from the updated auth store after restoreSession', async () => {
    await act(async () => {
      root?.render(createElement(LoginPage));
    });

    await flushEffects();

    expect(mocks.authState.restoreSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('http://custom-server:3000');

    const rememberCheckbox = container.querySelector(
      'input[aria-label="login.remember_password_label"]'
    ) as HTMLInputElement | null;
    expect(rememberCheckbox).not.toBeNull();
    expect(rememberCheckbox?.checked).toBe(true);
  });
});
