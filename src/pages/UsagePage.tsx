import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore, useConfigStore } from '@/stores';
import {
  StatCards,
  RuntimeQualityCard,
  TokenEfficiencyCenter,
  UsageChart,
  ChartLineSelector,
  ApiDetailsCard,
  ModelStatsCard,
  PriceSettingsCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  TokenBreakdownChart,
  TokenDistributionChart,
  CostTrendChart,
  ServiceHealthCard,
  useUsageData,
  useAuthFilesMap,
  useSparklines,
  useChartData,
  useUsageAnalyticsSnapshot,
  useUsageReliabilitySnapshot,
  useUsageSubscriptionTier,
  useModelAliasReverseMap,
  type EfficiencyDrilldown,
} from '@/components/usage';
import { type UsageTimeRange } from '@/utils/usage';
import styles from './UsagePage.module.scss';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const CHART_LINES_STORAGE_KEY = 'cli-proxy-usage-chart-lines-v1';
const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const DEFAULT_CHART_LINES = ['all'];
const DEFAULT_TIME_RANGE: UsageTimeRange = '7d';
const MAX_CHART_LINES = 9;
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: 'all', labelKey: 'usage_stats.range_all' },
  { value: '1d', labelKey: 'usage_stats.range_1d' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: '30d', labelKey: 'usage_stats.range_30d' },
];
const HOUR_WINDOW_BY_TIME_RANGE: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '1d': 24,
  '7d': 7 * 24,
  '30d': 30 * 24,
};
const SERVICE_HEALTH_SECTION_ID = 'usage-service-health-card';
const REQUEST_EVENTS_SECTION_ID = 'usage-request-events-card';

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '1d' || value === '7d' || value === '30d' || value === 'all';

const normalizeChartLines = (value: unknown, maxLines = MAX_CHART_LINES): string[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_CHART_LINES;
  }

  const filtered = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  return filtered.length ? filtered : DEFAULT_CHART_LINES;
};

const loadChartLines = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_CHART_LINES;
    }
    const raw = localStorage.getItem(CHART_LINES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHART_LINES;
    }
    return normalizeChartLines(JSON.parse(raw));
  } catch {
    return DEFAULT_CHART_LINES;
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

export function UsagePage() {
  const { t, i18n } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const config = useConfigStore((state) => state.config);

  const {
    usage,
    usageDetails,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    setModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  } = useUsageData();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const { authFileMap, authFiles } = useAuthFilesMap();

  // 获取 OAuth 模型别名反向映射，用于将 usage 中的别名解析为原始模型名
  const { aliasReverseMap } = useModelAliasReverseMap();

  useHeaderRefresh(loadUsage);

  // Background polling every 60s (does not show loading overlay)
  useInterval(() => {
    setIsRefreshing(true);
    void loadUsage().finally(() => setIsRefreshing(false));
  }, 60000);

  const [chartLines, setChartLines] = useState<string[]>(loadChartLines);
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [efficiencyDrilldown, setEfficiencyDrilldown] = useState<EfficiencyDrilldown>({
    type: 'none',
  });
  const [requestEventsResultFilter, setRequestEventsResultFilter] = useState<
    'success' | 'failure' | null
  >(null);

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey),
      })),
    [t]
  );

  const handleChartLinesChange = useCallback((lines: string[]) => {
    setChartLines(normalizeChartLines(lines));
  }, []);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CHART_LINES_STORAGE_KEY, JSON.stringify(chartLines));
    } catch {
      // Ignore storage errors.
    }
  }, [chartLines]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  const nowMs = lastRefreshedAt?.getTime() ?? 0;
  const hourWindowHours = timeRange === 'all' ? undefined : HOUR_WINDOW_BY_TIME_RANGE[timeRange];

  const includeHealthRequestEventRows = requestEventsResultFilter !== null;

  const {
    filteredUsage,
    canonicalUsage,
    modelNames,
    apiStats,
    modelStats,
    tokenDistribution,
    usageSummary,
    requestEventRows,
    healthRequestEventRows,
    credentialRows,
    efficiencyOverview,
    modelEfficiencyRows,
    credentialEfficiencyRows,
    runtimeQualitySummary,
  } = useUsageAnalyticsSnapshot({
    usage,
    usageDetails,
    timeRange,
    modelPrices,
    nowMs,
    authFileMap,
    locale: i18n.language,
    geminiKeys: config?.geminiApiKeys || [],
    claudeConfigs: config?.claudeApiKeys || [],
    codexConfigs: config?.codexApiKeys || [],
    vertexConfigs: config?.vertexApiKeys || [],
    openaiProviders: config?.openaiCompatibility || [],
    includeHealthRequestEventRows,
    aliasReverseMap,
  });

  const { requestsSparkline, tokensSparkline, rpmSparkline, tpmSparkline, costSparkline } =
    useSparklines({ usage: filteredUsage, usageDetails, loading, modelPrices, nowMs });

  const { subscriptionTier, loading: subscriptionTierLoading } =
    useUsageSubscriptionTier(authFiles);

  const { healthAssessment, slaAssessment, serviceHealth } = useUsageReliabilitySnapshot({
    usageDetails,
    tier: subscriptionTier,
    nowMs,
  });

  const {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions,
  } = useChartData({ usage: canonicalUsage, chartLines, isDark, isMobile, hourWindowHours });

  const hasPrices = Object.keys(modelPrices).length > 0;
  const externalModelFilter =
    efficiencyDrilldown.type === 'model' ? (efficiencyDrilldown.value ?? null) : null;
  const credentialDrilldown = useMemo(() => {
    if (efficiencyDrilldown.type !== 'credential' || !efficiencyDrilldown.value) {
      return { source: null, sourceRaw: null, authIndex: null };
    }

    try {
      const parsed = JSON.parse(efficiencyDrilldown.value) as {
        source?: string | null;
        authIndex?: string | null;
        fallbackSource?: string | null;
      };

      return parsed.authIndex
        ? {
            source: null,
            sourceRaw: null,
            authIndex: parsed.authIndex ?? null,
          }
        : {
            source: parsed.fallbackSource ?? null,
            sourceRaw: parsed.source ?? null,
            authIndex: null,
          };
    } catch {
      return { source: efficiencyDrilldown.value, sourceRaw: null, authIndex: null };
    }
  }, [efficiencyDrilldown]);

  const scrollToSection = useCallback((sectionId: string) => {
    if (typeof document === 'undefined') {
      return;
    }

    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleAvailabilityDrillDown = useCallback(() => {
    scrollToSection(SERVICE_HEALTH_SECTION_ID);
  }, [scrollToSection]);

  const handleSuccessRateDrillDown = useCallback(() => {
    setEfficiencyDrilldown({ type: 'none' });
    setRequestEventsResultFilter('failure');
    scrollToSection(REQUEST_EVENTS_SECTION_ID);
  }, [scrollToSection]);

  const handleEfficiencyDrilldown = useCallback(
    (drilldown: EfficiencyDrilldown) => {
      setRequestEventsResultFilter(null);
      setEfficiencyDrilldown(drilldown);
      scrollToSection(REQUEST_EVENTS_SECTION_ID);
    },
    [scrollToSection]
  );

  const handleClearRequestEventDrillDown = useCallback(() => {
    setEfficiencyDrilldown({ type: 'none' });
    setRequestEventsResultFilter(null);
  }, []);

  const requestEventsRowsForDisplay = requestEventsResultFilter
    ? healthRequestEventRows
    : requestEventRows;

  return (
    <div className={styles.container}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
            <Select
              value={timeRange}
              options={timeRangeOptions}
              onChange={(value) => setTimeRange(value as UsageTimeRange)}
              className={styles.timeRangeSelectControl}
              ariaLabel={t('usage_stats.range_filter')}
              fullWidth={false}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
              {isRefreshing && (
                <span title={t('common.loading')}>
                  <LoadingSpinner size={12} />
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <StatCards
        usage={filteredUsage}
        loading={loading || subscriptionTierLoading}
        hasPrices={hasPrices}
        modelStats={modelStats}
        usageSummary={usageSummary}
        healthAssessment={healthAssessment}
        slaAssessment={slaAssessment}
        onAvailabilityDrillDown={handleAvailabilityDrillDown}
        onSuccessRateDrillDown={handleSuccessRateDrillDown}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline,
        }}
      />

      <RuntimeQualityCard summary={runtimeQualitySummary} loading={loading} />

      <div id={SERVICE_HEALTH_SECTION_ID}>
        <ServiceHealthCard details={usageDetails} loading={loading} healthData={serviceHealth} />
      </div>

      <div className={styles.detailsGrid}>
        <CredentialStatsCard rows={credentialRows} loading={loading} />
        <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
      </div>

      <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />

      <TokenEfficiencyCenter
        overview={efficiencyOverview}
        modelRows={modelEfficiencyRows}
        credentialRows={credentialEfficiencyRows}
        loading={loading}
        onDrilldownChange={handleEfficiencyDrilldown}
      />

      <div id={REQUEST_EVENTS_SECTION_ID}>
        <RequestEventsDetailsCard
          rows={requestEventsRowsForDisplay}
          loading={loading}
          error={error}
          externalModelFilter={externalModelFilter}
          externalSourceFilter={credentialDrilldown.source}
          externalSourceRawFilter={credentialDrilldown.sourceRaw}
          externalAuthIndexFilter={credentialDrilldown.authIndex}
          externalResultFilter={requestEventsResultFilter}
          onClearExternalFilters={handleClearRequestEventDrillDown}
        />
      </div>

      <ChartLineSelector
        chartLines={chartLines}
        modelNames={modelNames}
        maxLines={MAX_CHART_LINES}
        onChange={handleChartLinesChange}
      />

      <div className={styles.chartsGrid}>
        <UsageChart
          title={t('usage_stats.requests_trend')}
          period={requestsPeriod}
          onPeriodChange={setRequestsPeriod}
          chartData={requestsChartData}
          chartOptions={requestsChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
        <UsageChart
          title={t('usage_stats.tokens_trend')}
          period={tokensPeriod}
          onPeriodChange={setTokensPeriod}
          chartData={tokensChartData}
          chartOptions={tokensChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
      </div>

      <div className={styles.chartsGrid}>
        <TokenDistributionChart
          distribution={tokenDistribution}
          loading={loading}
          isDark={isDark}
        />
        <TokenBreakdownChart
          usage={filteredUsage}
          loading={loading}
          isDark={isDark}
          isMobile={isMobile}
          hourWindowHours={hourWindowHours}
        />
      </div>

      <CostTrendChart
        usage={filteredUsage}
        loading={loading}
        isDark={isDark}
        isMobile={isMobile}
        modelPrices={modelPrices}
        hourWindowHours={hourWindowHours}
      />

      <PriceSettingsCard
        modelNames={modelNames}
        modelPrices={modelPrices}
        onPricesChange={setModelPrices}
      />
    </div>
  );
}
