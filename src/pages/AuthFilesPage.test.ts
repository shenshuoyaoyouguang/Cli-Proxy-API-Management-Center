import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const loadFiles = vi.fn(async () => {});
  const loadKeyStats = vi.fn(async () => {});
  const refreshKeyStats = vi.fn(async () => {});
  const loadExcluded = vi.fn(async () => {});
  const loadModelAlias = vi.fn(async () => {});

  return {
    loadFiles,
    loadKeyStats,
    refreshKeyStats,
    loadExcluded,
    loadModelAlias,
    showNotification: vi.fn(),
    navigate: vi.fn(),
    recoverAccount: vi.fn(async () => {}),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('lodash-es', () => ({
  throttle: <T extends (...args: never[]) => unknown>(fn: T) => {
    const wrapped = ((...args: Parameters<T>) => fn(...args)) as T & { cancel: () => void };
    wrapped.cancel = () => {};
    return wrapped;
  },
}));

vi.mock('motion/mini', () => ({
  animate: () => ({
    play: () => {},
    stop: () => {},
    then: (resolve?: () => void) => Promise.resolve().then(() => resolve?.()),
  }),
}));

vi.mock('@/hooks/useInterval', () => ({
  useInterval: vi.fn(),
}));

vi.mock('@/hooks/useHeaderRefresh', () => ({
  useHeaderRefresh: vi.fn(),
}));

vi.mock('@/components/common/PageTransitionLayer', () => ({
  usePageTransitionLayer: () => ({ status: 'current' }),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({
    title,
    extra,
    children,
  }: React.PropsWithChildren<{ title?: React.ReactNode; extra?: React.ReactNode }>) =>
    createElement('div', null, title, extra, children),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) =>
    createElement('button', { type: 'button', onClick, disabled }, children),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
  }) =>
    createElement('input', {
      value: value ?? '',
      onInput: (event: Event) =>
        onChange?.({ target: { value: (event.target as HTMLInputElement).value } }),
    }),
}));

vi.mock('@/components/ui/MultiSelect', () => ({
  MultiSelect: () => createElement('div', null, 'multiselect'),
}));

vi.mock('@/components/ui/Select', () => ({
  Select: () => createElement('select', null),
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title }: { title?: React.ReactNode }) => createElement('div', null, title),
}));

vi.mock('@/components/ui/ToggleSwitch', () => ({
  ToggleSwitch: ({
    checked,
    onChange,
  }: {
    checked?: boolean;
    onChange?: (value: boolean) => void;
  }) =>
    createElement('input', {
      type: 'checkbox',
      checked: Boolean(checked),
      onChange: (event: Event) => onChange?.((event.target as HTMLInputElement).checked),
    }),
}));

vi.mock('@/components/ui/icons', () => ({
  IconFilterAll: () => createElement('span'),
}));

vi.mock('@/features/authFiles/components/AuthFileCard', () => ({
  AuthFileCard: () => createElement('div', null, 'auth-file-card'),
}));

vi.mock('@/features/authFiles/components/AuthFileModelsModal', () => ({
  AuthFileModelsModal: () => null,
}));

vi.mock('@/features/authFiles/components/AuthFilesPrefixProxyEditorModal', () => ({
  AuthFilesPrefixProxyEditorModal: () => null,
}));

vi.mock('@/features/authFiles/components/OAuthExcludedCard', () => ({
  OAuthExcludedCard: () => createElement('div', null, 'oauth-excluded-card'),
}));

vi.mock('@/features/authFiles/components/OAuthModelAliasCard', () => ({
  OAuthModelAliasCard: () => createElement('div', null, 'oauth-model-alias-card'),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesStats', () => ({
  useAuthFilesStats: () => ({
    keyStats: {},
    usageDetails: [],
    loadKeyStats: mocks.loadKeyStats,
    refreshKeyStats: mocks.refreshKeyStats,
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesData', () => ({
  useAuthFilesData: () => ({
    files: [],
    selectedFiles: new Set<string>(),
    selectionCount: 0,
    loading: false,
    error: '',
    uploading: false,
    deleting: {},
    deletingAll: false,
    statusUpdating: {},
    batchStatusUpdating: false,
    fileInputRef: { current: null },
    loadFiles: mocks.loadFiles,
    handleUploadClick: vi.fn(),
    handleFileChange: vi.fn(),
    handleDelete: vi.fn(),
    handleDeleteAll: vi.fn(),
    handleDownload: vi.fn(),
    handleStatusToggle: vi.fn(),
    toggleSelect: vi.fn(),
    selectAllVisible: vi.fn(),
    invertVisibleSelection: vi.fn(),
    deselectAll: vi.fn(),
    batchDownload: vi.fn(),
    batchSetStatus: vi.fn(),
    batchDelete: vi.fn(),
    clearRecoveredFiles: vi.fn(),
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesOauth', () => ({
  useAuthFilesOauth: () => ({
    excluded: [],
    excludedError: '',
    modelAlias: [],
    modelAliasError: '',
    allProviderModels: [],
    loadExcluded: mocks.loadExcluded,
    loadModelAlias: mocks.loadModelAlias,
    deleteExcluded: vi.fn(),
    deleteModelAlias: vi.fn(),
    handleMappingUpdate: vi.fn(),
    handleDeleteLink: vi.fn(),
    handleToggleFork: vi.fn(),
    handleRenameAlias: vi.fn(),
    handleDeleteAlias: vi.fn(),
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesModels', () => ({
  useAuthFilesModels: () => ({
    modelsModalOpen: false,
    modelsLoading: false,
    modelsList: [],
    modelsFileName: '',
    modelsFileType: '',
    modelsError: '',
    showModels: vi.fn(),
    closeModelsModal: vi.fn(),
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor', () => ({
  useAuthFilesPrefixProxyEditor: () => ({
    prefixProxyEditor: null,
    prefixProxyUpdatedText: '',
    prefixProxyDirty: false,
    openPrefixProxyEditor: vi.fn(),
    closePrefixProxyEditor: vi.fn(),
    handlePrefixProxyChange: vi.fn(),
    handlePrefixProxySave: vi.fn(),
  }),
}));

vi.mock('@/features/authFiles/hooks/useAuthFilesStatusBarCache', () => ({
  useAuthFilesStatusBarCache: () => ({}),
}));

vi.mock('@/stores', () => ({
  useNotificationStore: <T,>(
    selector: (state: { showNotification: (...args: unknown[]) => void }) => T
  ) =>
    selector({
      showNotification: mocks.showNotification,
    }),
  useAuthStore: <T,>(selector: (state: { connectionStatus: string }) => T) =>
    selector({ connectionStatus: 'connected' }),
  useThemeStore: <T,>(selector: (state: { resolvedTheme: 'light' }) => T) =>
    selector({ resolvedTheme: 'light' }),
  useAccountHealthStore: <T,>(
    selector: (state: {
      healthMap: Record<string, unknown>;
      recoverAccount: (name: string) => Promise<void>;
    }) => T
  ) =>
    selector({
      healthMap: {},
      recoverAccount: mocks.recoverAccount,
    }),
}));

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn(),
}));

import { AuthFilesPage } from './AuthFilesPage';

describe('AuthFilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('refreshes files, key stats, excluded oauth entries and model aliases from the toolbar button', async () => {
    render(createElement(AuthFilesPage));

    await waitFor(() => {
      expect(mocks.loadFiles).toHaveBeenCalledTimes(1);
      expect(mocks.loadKeyStats).toHaveBeenCalledTimes(1);
      expect(mocks.loadExcluded).toHaveBeenCalledTimes(1);
      expect(mocks.loadModelAlias).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText('common.refresh'));

    await waitFor(() => {
      expect(mocks.loadFiles).toHaveBeenCalledTimes(2);
      expect(mocks.refreshKeyStats).toHaveBeenCalledTimes(1);
      expect(mocks.loadExcluded).toHaveBeenCalledTimes(2);
      expect(mocks.loadModelAlias).toHaveBeenCalledTimes(2);
    });
  });

  it('hydrates compact mode from persisted UI storage on first render', async () => {
    localStorage.setItem('authFilesPage.compactMode', 'true');

    render(createElement(AuthFilesPage));

    await waitFor(() => {
      const pageSizeInput = screen.getByDisplayValue('12') as HTMLInputElement;
      expect(pageSizeInput.value).toBe('12');
    });
  });
});
