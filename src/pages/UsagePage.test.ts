import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const loadUsage = vi.fn(async () => {});
  const handleExport = vi.fn();
  const handleImport = vi.fn();
  const handleImportChange = vi.fn();
  const setModelPrices = vi.fn();
  const callOrder: string[] = [];
  const scrollIntoView = vi.fn();

  return {
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    setModelPrices,
    useHeaderRefresh: vi.fn(),
    callOrder,
    scrollIntoView,
    useUsageSSE: vi.fn(() => {
      callOrder.push('useUsageSSE');
      return { connectionStatus: 'connected' };
    }),
    useUsageData: vi.fn(() => {
      callOrder.push('useUsageData');
      return {
        usage: { totalRequests: 1 },
        usageDetails: [],
        loading: false,
        error: '',
        lastRefreshedAt: null,
        modelPrices: {},
        setModelPrices,
        loadUsage,
        handleExport,
        handleImport,
        handleImportChange,
        importInputRef: { current: null },
        exporting: false,
        importing: false,
      };
    }),
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
  useUsageSSE: mocks.useUsageSSE,
}));

vi.mock('@/hooks/useIntersectionObserver', () => ({
  useIntersectionObserver: () => [vi.fn(), true],
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
  useUsageStatsStore: <T,>(
    selector: (state: { dataQualityWarning: null; dataWindowMessage: null }) => T
  ) =>
    selector({ dataQualityWarning: null, dataWindowMessage: null }),
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

  const PropEcho = ({
    usageDetails,
    details,
  }: {
    usageDetails?: unknown;
    details?: unknown;
  }) =>
    createElement(
      'pre',
      { 'data-testid': details ? 'service-health-props' : 'stat-cards-props' },
      JSON.stringify({ usageDetails, details })
    );

  const TokenEfficiencyCenter = ({
    onDrilldownChange,
  }: {
    onDrilldownChange?: (drilldown: { type: 'model' | 'credential' | 'none'; value?: string }) => void;
  }) =>
    createElement(
      'div',
      null,
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => onDrilldownChange?.({ type: 'model', value: 'model-b' }),
        },
        'trigger-model-drilldown'
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () =>
            onDrilldownChange?.({
              type: 'credential',
              value: JSON.stringify({
                source: 'tenant-auth-raw',
                authIndex: '7',
                fallbackSource: 'Tenant Auth',
              }),
            }),
        },
        'trigger-credential-auth-drilldown'
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () =>
            onDrilldownChange?.({
              type: 'credential',
              value: JSON.stringify({
                source: 'tenant-source-raw',
                fallbackSource: 'Tenant Source',
              }),
            }),
        },
        'trigger-credential-source-drilldown'
      )
    );

  const RequestEventsDetailsCard = ({
    externalModelFilter = null,
    externalSourceFilter = null,
    externalSourceRawFilter = null,
    externalAuthIndexFilter = null,
    onClearExternalFilters,
  }: {
    externalModelFilter?: string | null;
    externalSourceFilter?: string | null;
    externalSourceRawFilter?: string | null;
    externalAuthIndexFilter?: string | null;
    onClearExternalFilters?: () => void;
  }) =>
    createElement(
      'div',
      null,
      createElement(
        'pre',
        { 'data-testid': 'request-events-props' },
        JSON.stringify({
          externalModelFilter,
          externalSourceFilter,
          externalSourceRawFilter,
          externalAuthIndexFilter,
        })
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => onClearExternalFilters?.(),
        },
        'clear-request-events-drilldown'
      )
    );

  return {
    StatCards: PropEcho,
    RuntimeQualityCard: Stub,
    TokenEfficiencyCenter,
    ApiDetailsCard: Stub,
    ModelStatsCard: Stub,
    PriceSettingsCard: Stub,
    CredentialStatsCard: Stub,
    RequestEventsDetailsCard,
    ServiceHealthCard: PropEcho,
    useUsageData: mocks.useUsageData,
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
      filteredDetails: [{ id: 'filtered-detail' }],
      modelNames: [],
      apiStats: [],
      modelStats: [],
      usageSummary: {},
      requestEventRows: [],
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
const readRequestEventsProps = () =>
  JSON.parse(screen.getByTestId('request-events-props').textContent ?? '{}') as {
    externalModelFilter: string | null;
    externalSourceFilter: string | null;
    externalSourceRawFilter: string | null;
    externalAuthIndexFilter: string | null;
  };

describe('UsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.callOrder.length = 0;
    mocks.scrollIntoView.mockReset();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: mocks.scrollIntoView,
    });
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

  it('registers the live SSE hook before usage data bootstrap logic', () => {
    render(createElement(UsagePage));

    expect(mocks.callOrder.indexOf('useUsageSSE')).toBeGreaterThanOrEqual(0);
    expect(mocks.callOrder.indexOf('useUsageData')).toBeGreaterThanOrEqual(0);
    expect(mocks.callOrder.indexOf('useUsageSSE')).toBeLessThan(
      mocks.callOrder.indexOf('useUsageData')
    );
  });

  it('passes model drilldown into the request events card and clears it on reset', async () => {
    render(createElement(UsagePage));

    fireEvent.click(screen.getByText('trigger-model-drilldown'));

    await waitFor(() => {
      expect(readRequestEventsProps().externalModelFilter).toBe('model-b');
    });
    expect(mocks.scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByText('clear-request-events-drilldown'));

    await waitFor(() => {
      expect(readRequestEventsProps().externalModelFilter).toBeNull();
    });
  });

  it('maps credential drilldown with auth index into the auth-index filter only', async () => {
    render(createElement(UsagePage));

    fireEvent.click(screen.getByText('trigger-credential-auth-drilldown'));

    await waitFor(() => {
      expect(readRequestEventsProps()).toEqual({
        externalModelFilter: null,
        externalSourceFilter: null,
        externalSourceRawFilter: null,
        externalAuthIndexFilter: '7',
      });
    });
  });

  it('maps credential drilldown without auth index into source filters', async () => {
    render(createElement(UsagePage));

    fireEvent.click(screen.getByText('trigger-credential-source-drilldown'));

    await waitFor(() => {
      expect(readRequestEventsProps()).toEqual({
        externalModelFilter: null,
        externalSourceFilter: 'Tenant Source',
        externalSourceRawFilter: 'tenant-source-raw',
        externalAuthIndexFilter: null,
      });
    });
  });

  it('passes filteredDetails into downstream analytics consumers', () => {
    render(createElement(UsagePage));

    expect(screen.getByTestId('stat-cards-props').textContent).toContain('filtered-detail');
    expect(screen.getByTestId('service-health-props').textContent).toContain('filtered-detail');
  });
});
