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
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useUsageSSE } from '@/hooks/useUsageSSE';
import { useConfigStore } from '@/stores';
import {
  IconRefreshCw,
  IconDownload,
  IconUpload,
} from '@/components/ui/icons';
import {
  StatCards,
  RuntimeQualityCard,
  TokenEfficiencyCenter,
  ApiDetailsCard,
  ModelStatsCard,
  PriceSettingsCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  ServiceHealthCard,
  useUsageData,
  useAuthFilesMap,
  useSparklines,
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

const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const DEFAULT_TIME_RANGE: UsageTimeRange = '7d';
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

  const { authFileMap, authFiles } = useAuthFilesMap();

  const { aliasReverseMap } = useModelAliasReverseMap();

  useHeaderRefresh(loadUsage);

  const { connectionStatus } = useUsageSSE({ enabled: true });

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
    modelNames,
    apiStats,
    modelStats,
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

  const { loading: subscriptionTierLoading } =
    useUsageSubscriptionTier(authFiles);

  const { healthAssessment, serviceHealth } = useUsageReliabilitySnapshot({
    usageDetails,
    nowMs,
  });

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

  const [highlightedSection, setHighlightedSection] = useState<string | null>(null);

  const scrollToSection = useCallback((sectionId: string) => {
    if (typeof document === 'undefined') {
      return;
    }

    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Add highlight animation
      setHighlightedSection(sectionId);
      setTimeout(() => {
        setHighlightedSection((current) => (current === sectionId ? null : current));
      }, 2000);
    }
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

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return t('usage_stats.sse_realtime');
      case 'degraded':
        return t('usage_stats.sse_polling');
      case 'connecting':
        return t('usage_stats.sse_connecting');
      case 'disconnected':
        return t('usage_stats.sse_disconnected');
      default:
        return '';
    }
  };

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

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
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
        </div>
        <div className={styles.headerRight}>
          <Button
            variant="icon"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            disabled={loading || exporting || importing}
            icon={<IconRefreshCw size={16} />}
            title={loading ? t('common.loading') : t('usage_stats.refresh')}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
          <span className={`${styles.connectionStatus} ${styles[connectionStatus] ?? ''}`}>
            <span className={styles.statusDot} />
            {getConnectionStatusText()}
          </span>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {/* Overview Section */}
      <section className={styles.section}>
        <StatCards
          usage={filteredUsage}
          loading={loading || subscriptionTierLoading}
          hasPrices={hasPrices}
          usageSummary={usageSummary}
          healthAssessment={healthAssessment}
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
      </section>

      {/* Health Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('usage_stats.health_section_title')}</h2>
        <div
          id={SERVICE_HEALTH_SECTION_ID}
          className={highlightedSection === SERVICE_HEALTH_SECTION_ID ? styles.drilldownHighlight : ''}
        >
          <ServiceHealthCard details={usageDetails} loading={loading} healthData={serviceHealth} />
        </div>

        <TokenEfficiencyCenter
          overview={efficiencyOverview}
          modelRows={modelEfficiencyRows}
          credentialRows={credentialEfficiencyRows}
          loading={loading}
          onDrilldownChange={handleEfficiencyDrilldown}
        />
      </section>

      {/* Details Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('usage_stats.details_section_title')}</h2>
        <div className={styles.detailsGrid}>
          <CredentialStatsCard rows={credentialRows} loading={loading} />
          <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
        </div>

        <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />

        <div
          id={REQUEST_EVENTS_SECTION_ID}
          className={highlightedSection === REQUEST_EVENTS_SECTION_ID ? styles.drilldownHighlight : ''}
        >
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
      </section>

      {/* Settings Section */}
      <section className={styles.settingsSection}>
        <div className={styles.settingsHeader}>
          <h2 className={styles.settingsTitle}>{t('usage_stats.settings_title')}</h2>
          <div className={styles.settingsActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
              loading={exporting}
              disabled={loading || importing}
              icon={<IconDownload size={16} />}
            >
              {t('usage_stats.export')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleImport}
              loading={importing}
              disabled={loading || exporting}
              icon={<IconUpload size={16} />}
            >
              {t('usage_stats.import')}
            </Button>
          </div>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportChange}
        />
        <PriceSettingsCard
          modelNames={modelNames}
          modelPrices={modelPrices}
          onPricesChange={setModelPrices}
        />
      </section>
    </div>
  );
}
