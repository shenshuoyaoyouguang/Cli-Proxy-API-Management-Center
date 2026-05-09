import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { buildScopeKey } from '@/utils/helpers';

const mocks = vi.hoisted(() => {
  const authState = {
    connectionStatus: 'disconnected',
    apiBase: 'http://localhost:3000',
    managementKey: 'management-key',
  };
  const configState = {
    config: { requestLog: false },
  };

  return {
    authState,
    configState,
    showNotification: vi.fn(),
    showConfirmation: vi.fn(),
    useTraceResolverSpy: vi.fn(() => ({
      traceLogLine: null,
      traceLoading: false,
      traceError: '',
      traceCandidates: [],
      resolveTraceSourceInfo: () => ({ displayName: '-', type: '' }),
      loadTraceUsageDetails: vi.fn(),
      refreshTraceUsageDetails: vi.fn(),
      openTraceModal: vi.fn(),
      closeTraceModal: vi.fn(),
    })),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({
    children,
    extra,
    title,
    className,
  }: React.PropsWithChildren<{
    extra?: React.ReactNode;
    title?: React.ReactNode;
    className?: string;
  }>) =>
    createElement(
      'div',
      { className },
      title,
      extra,
      children
    ),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) =>
    createElement('button', { type: 'button', onClick, disabled }, children),
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({
    title,
    description,
  }: {
    title?: React.ReactNode;
    description?: React.ReactNode;
  }) => createElement('div', null, title, description),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: ({
    value,
    onChange,
    rightElement,
    placeholder,
  }: {
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    rightElement?: React.ReactNode;
    placeholder?: string;
  }) =>
    createElement(
      'label',
      null,
      createElement('input', { value, onChange, placeholder }),
      rightElement
    ),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    open,
    title,
    children,
    footer,
  }: React.PropsWithChildren<{
    open: boolean;
    title?: React.ReactNode;
    footer?: React.ReactNode;
  }>) => (open ? createElement('div', null, title, children, footer) : null),
}));

vi.mock('@/components/ui/ToggleSwitch', () => ({
  ToggleSwitch: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange?: (value: boolean) => void;
  }) =>
    createElement('input', {
      type: 'checkbox',
      checked,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.checked),
    }),
}));

vi.mock('@/components/ui/icons', () => {
  const Icon = () => createElement('span');
  return {
    IconChevronDown: Icon,
    IconChevronUp: Icon,
    IconCode: Icon,
    IconDownload: Icon,
    IconEyeOff: Icon,
    IconRefreshCw: Icon,
    IconSearch: Icon,
    IconSlidersHorizontal: Icon,
    IconTimer: Icon,
    IconTrash2: Icon,
    IconX: Icon,
  };
});

vi.mock('@/hooks/useHeaderRefresh', () => ({
  useHeaderRefresh: vi.fn(),
}));

vi.mock('@/hooks/useLocalStorage', () => ({
  useLocalStorage: vi.fn(() => [true, vi.fn()]),
}));

vi.mock('@/stores', () => ({
  useAuthStore: <T,>(
    selector: (state: {
      connectionStatus: string;
      apiBase: string;
      managementKey: string;
    }) => T
  ) => selector(mocks.authState),
  useConfigStore: <T,>(selector: (state: { config: { requestLog: boolean } }) => T) =>
    selector(mocks.configState),
  useNotificationStore: () => ({
    showNotification: mocks.showNotification,
    showConfirmation: mocks.showConfirmation,
  }),
}));

vi.mock('@/services/api/logs', () => ({
  logsApi: {
    fetchLogs: vi.fn(),
    clearLogs: vi.fn(),
    fetchErrorLogs: vi.fn(),
    downloadErrorLog: vi.fn(),
    downloadRequestLogById: vi.fn(),
  },
}));

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn(),
}));

vi.mock('@/utils/download', () => ({
  downloadBlob: vi.fn(),
}));

vi.mock('./hooks/logParsing', () => ({
  parseLogLine: vi.fn((line: string) => ({
    raw: line,
    message: line,
  })),
}));

vi.mock('./hooks/useLogFilters', () => ({
  useLogFilters: vi.fn(() => ({
    methodFilters: [],
    methodCounts: {},
    statusFilters: [],
    statusCounts: {},
    pathFilters: [],
    pathOptions: [],
    methodFilterSet: new Set(),
    statusFilterSet: new Set(),
    pathFilterSet: new Set(),
    hasStructuredFilters: false,
    toggleMethodFilter: vi.fn(),
    toggleStatusFilter: vi.fn(),
    togglePathFilter: vi.fn(),
    clearStructuredFilters: vi.fn(),
  })),
}));

vi.mock('./hooks/useLogScroller', () => ({
  isNearBottom: vi.fn(() => true),
  useLogScroller: vi.fn(() => ({
    logViewerRef: { current: null },
    handleLogScroll: vi.fn(),
    canLoadMore: false,
    requestScrollToBottom: vi.fn(),
  })),
}));

vi.mock('./hooks/useTraceResolver', () => ({
  isTraceableRequestPath: vi.fn(() => false),
  useTraceResolver: mocks.useTraceResolverSpy,
}));

import { LogsPage } from './LogsPage';

describe('LogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.connectionStatus = 'disconnected';
    mocks.authState.apiBase = 'http://localhost:3000';
    mocks.authState.managementKey = 'management-key';
  });

  afterEach(() => {
    cleanup();
  });

  it('passes the same hashed scope key used by usage stats into trace resolution', () => {
    render(createElement(LogsPage));

    expect(mocks.useTraceResolverSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        traceScopeKey: buildScopeKey(
          mocks.authState.apiBase,
          mocks.authState.managementKey
        ),
      })
    );
  });
});
