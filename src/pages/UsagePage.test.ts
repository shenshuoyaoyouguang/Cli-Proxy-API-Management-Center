import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const loadUsage = vi.fn(async () => {});
  const handleExport = vi.fn();
  const handleImport = vi.fn();
  const handleImportChange = vi.fn();
  const setModelPrices = vi.fn();

  return {
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    setModelPrices,
    useHeaderRefresh: vi.fn(),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' },
  }),
}));

vi.mock('@/hooks/useHeaderRefresh', () => ({
  useHeaderRefresh: mocks.useHeaderRefresh,
}));

vi.mock('@/hooks/useUsageSSE', () => ({
  useUsageSSE: () => ({ connectionStatus: 'connected' }),
}));

vi.mock('@/stores', () => ({
  useConfigStore: <T,>(
    selector: (state: {
      config: {
        geminiApiKeys: unknown[];
        claudeApiKeys: unknown[];
        codexApiKeys: unknown[];
        vertexApiKeys: unknown[];
        openaiCompatibility: unknown[];
      };
    }) => T
  ) =>
    selector({
      config: {
        geminiApiKeys: [],
        claudeApiKeys: [],
        codexApiKeys: [],
        vertexApiKeys: [],
        openaiCompatibility: [],
      },
    }),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    title,
  }: React.PropsWithChildren<{
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
  }>) => createElement('button', { type: 'button', onClick, disabled, title }, children),
}));

vi.mock('@/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: () => createElement('div', null, 'loading'),
}));

vi.mock('@/components/ui/Select', () => ({
  Select: ({
    value,
    options,
    onChange,
  }: {
    value?: string;
    options: Array<{ value: string; label: string }>;
    onChange?: (value: string) => void;
  }) =>
    createElement(
      'select',
      {
        value,
        onChange: (event: Event) => onChange?.((event.target as HTMLSelectElement).value),
      },
      options.map((option) =>
        createElement('option', { key: option.value, value: option.value }, option.label)
      )
    ),
}));

vi.mock('@/components/usage', () => {
  const Stub = ({ children }: React.PropsWithChildren = {}) =>
    createElement('div', null, children ?? 'stub');

  return {
    StatCards: Stub,
    RuntimeQualityCard: Stub,
    TokenEfficiencyCenter: Stub,
    ApiDetailsCard: Stub,
    ModelStatsCard: Stub,
    PriceSettingsCard: Stub,
    CredentialStatsCard: Stub,
    RequestEventsDetailsCard: Stub,
    ServiceHealthCard: Stub,
    useUsageData: () => ({
      usage: { totalRequests: 1 },
      usageDetails: [],
      loading: false,
      error: '',
      lastRefreshedAt: null,
      modelPrices: {},
      setModelPrices: mocks.setModelPrices,
      loadUsage: mocks.loadUsage,
      handleExport: mocks.handleExport,
      handleImport: mocks.handleImport,
      handleImportChange: mocks.handleImportChange,
      importInputRef: { current: null },
      exporting: false,
      importing: false,
    }),
    useAuthFilesMap: () => ({
      authFileMap: {},
      authFiles: [],
    }),
    useSparklines: () => ({
      requestsSparkline: [],
      tokensSparkline: [],
      rpmSparkline: [],
      tpmSparkline: [],
      costSparkline: [],
      dayRpmSparkline: [],
      dayTpmSparkline: [],
      dayCostSparkline: [],
    }),
    useUsageAnalyticsSnapshot: () => ({
      filteredUsage: { totalRequests: 1 },
      modelNames: [],
      apiStats: [],
      modelStats: [],
      usageSummary: {},
      requestEventRows: [],
      healthRequestEventRows: [],
      credentialRows: [],
      efficiencyOverview: {},
      modelEfficiencyRows: [],
      credentialEfficiencyRows: [],
      runtimeQualitySummary: {},
    }),
    useUsageReliabilitySnapshot: () => ({
      serviceHealth: {},
    }),
    useUsageSubscriptionTier: () => ({
      loading: false,
    }),
    useModelAliasReverseMap: () => ({
      aliasReverseMap: {},
    }),
  };
});

import { UsagePage } from './UsagePage';

const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';

describe('UsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('hydrates the persisted time range and writes updates back to localStorage', async () => {
    localStorage.setItem(TIME_RANGE_STORAGE_KEY, '30d');

    render(createElement(UsagePage));

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('30d');

    fireEvent.change(select, { target: { value: '1d' } });

    await waitFor(() => {
      expect(localStorage.getItem(TIME_RANGE_STORAGE_KEY)).toBe('1d');
    });
  });

  it('invokes usage reload when the refresh button is clicked', async () => {
    render(createElement(UsagePage));

    fireEvent.click(screen.getByTitle('usage_stats.refresh'));

    await waitFor(() => {
      expect(mocks.loadUsage).toHaveBeenCalled();
    });
  });
});
