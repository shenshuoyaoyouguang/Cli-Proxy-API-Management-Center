import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IconKey, IconBot, IconFileText, IconSatellite } from '@/components/ui/icons';
import { useAuthStore, useConfigStore, useModelsStore } from '@/stores';
import { apiKeysApi, providersApi, authFilesApi } from '@/services/api';
import styles from './DashboardPage.module.scss';

interface QuickStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  path: string;
  loading?: boolean;
  sublabel?: string;
}

interface ProviderStats {
  gemini: number | null;
  codex: number | null;
  claude: number | null;
  openai: number | null;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);

  const [stats, setStats] = useState<{
    apiKeys: number | null;
    authFiles: number | null;
  }>({
    apiKeys: null,
    authFiles: null,
  });

  const [providerStats, setProviderStats] = useState<ProviderStats>({
    gemini: null,
    codex: null,
    claude: null,
    openai: null,
  });

  const [loading, setLoading] = useState(true);

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' });

  useEffect(() => {
    if (connectionStatus === 'connected' && !config) {
      fetchConfig().catch(() => {
        // ignore config preload errors here; page handles missing config state gracefully
      });
    }
  }, [connectionStatus, config, fetchConfig]);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;

    const fetchStats = async () => {
      setLoading(true);
      try {
        const [keysRes, filesRes, geminiRes, codexRes, claudeRes, openaiRes] =
          await Promise.allSettled([
            apiKeysApi.list({ signal: abortController.signal }),
            authFilesApi.list({ signal: abortController.signal }),
            providersApi.getGeminiKeys({ signal: abortController.signal }),
            providersApi.getCodexConfigs({ signal: abortController.signal }),
            providersApi.getClaudeConfigs({ signal: abortController.signal }),
            providersApi.getOpenAIProviders({ signal: abortController.signal }),
          ]);

        if (!active || abortController.signal.aborted) {
          return;
        }

        setStats({
          apiKeys: keysRes.status === 'fulfilled' ? keysRes.value.length : null,
          authFiles: filesRes.status === 'fulfilled' ? filesRes.value.files.length : null,
        });

        setProviderStats({
          gemini: geminiRes.status === 'fulfilled' ? geminiRes.value.length : null,
          codex: codexRes.status === 'fulfilled' ? codexRes.value.length : null,
          claude: claudeRes.status === 'fulfilled' ? claudeRes.value.length : null,
          openai: openaiRes.status === 'fulfilled' ? openaiRes.value.length : null,
        });
      } finally {
        if (active && !abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    if (connectionStatus === 'connected') {
      void fetchStats();
    } else {
      setLoading(false);
    }

    return () => {
      active = false;
      abortController.abort();
    };
  }, [connectionStatus]);

  // Calculate total provider keys only when all provider stats are available.
  const providerStatsReady =
    providerStats.gemini !== null &&
    providerStats.codex !== null &&
    providerStats.claude !== null &&
    providerStats.openai !== null;
  const hasProviderStats =
    providerStats.gemini !== null ||
    providerStats.codex !== null ||
    providerStats.claude !== null ||
    providerStats.openai !== null;
  const totalProviderKeys = providerStatsReady
    ? (providerStats.gemini ?? 0) +
      (providerStats.codex ?? 0) +
      (providerStats.claude ?? 0) +
      (providerStats.openai ?? 0)
    : 0;

  const quickStats: QuickStat[] = [
    {
      label: t('dashboard.management_keys'),
      value: stats.apiKeys ?? '-',
      icon: <IconKey size={24} />,
      path: '/config',
      loading: loading && stats.apiKeys === null,
      sublabel: t('nav.config_management'),
    },
    {
      label: t('nav.ai_providers'),
      value: loading ? '-' : providerStatsReady ? totalProviderKeys : '-',
      icon: <IconBot size={24} />,
      path: '/ai-providers',
      loading: loading,
      sublabel: hasProviderStats
        ? t('dashboard.provider_keys_detail', {
            gemini: providerStats.gemini ?? '-',
            codex: providerStats.codex ?? '-',
            claude: providerStats.claude ?? '-',
            openai: providerStats.openai ?? '-',
          })
        : undefined,
    },
    {
      label: t('nav.auth_files'),
      value: stats.authFiles ?? '-',
      icon: <IconFileText size={24} />,
      path: '/auth-files',
      loading: loading && stats.authFiles === null,
      sublabel: t('dashboard.oauth_credentials'),
    },
    {
      label: t('dashboard.available_models'),
      value: modelsLoading ? '-' : models.length > 0 ? models.length : '-',
      icon: <IconSatellite size={24} />,
      path: '/system',
      loading: modelsLoading,
      sublabel: t('dashboard.available_models_desc'),
    },
  ];

  const routingStrategyRaw = config?.routingStrategy?.trim() || '';
  const routingStrategyDisplay = !routingStrategyRaw
    ? '-'
    : routingStrategyRaw === 'round-robin'
      ? t('basic_settings.routing_strategy_round_robin')
      : routingStrategyRaw === 'fill-first'
        ? t('basic_settings.routing_strategy_fill_first')
        : routingStrategyRaw;
  const routingStrategyBadgeClass = !routingStrategyRaw
    ? styles.configBadgeUnknown
    : routingStrategyRaw === 'round-robin'
      ? styles.configBadgeRoundRobin
      : routingStrategyRaw === 'fill-first'
        ? styles.configBadgeFillFirst
        : styles.configBadgeUnknown;

  return (
    <div className={styles.dashboard}>
      {/* Animated Background Mesh */}
      <div className={styles.backgroundMesh}>
        <div className={styles.meshGradient1} />
        <div className={styles.meshGradient2} />
        <div className={styles.meshGradient3} />
      </div>

      {/* Hero Section */}
      <div className={styles.hero}>
        <div className={styles.heroContent}>
          <span className={styles.heroGreeting}>{t('dashboard.title')}</span>
          <h1 className={styles.heroTitle}>{t('dashboard.subtitle')}</h1>
          <p className={styles.heroCaring}>
            {t('dashboard.welcome_message', { version: serverVersion?.trim() || '-' })}
          </p>
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.dateTimeBlock}>
            <span className={styles.time}>
              {timeStr}
            </span>
            <span className={styles.date}>
              {dateStr}
            </span>
          </div>
          <div className={styles.connectionPill}>
            <span
              className={`${styles.statusDot} ${
                connectionStatus === 'connected'
                  ? styles.connected
                  : connectionStatus === 'connecting'
                    ? styles.connecting
                    : styles.disconnected
              }`}
            />
            <span className={styles.pillText}>
              {t(
                connectionStatus === 'connected'
                  ? 'common.connected'
                  : connectionStatus === 'connecting'
                    ? 'common.connecting'
                    : 'common.disconnected'
              )}
            </span>
          </div>
          {serverBuildDate && (
            <span className={styles.buildDate}>
              {new Date(serverBuildDate).toLocaleDateString(i18n.language)}
            </span>
          )}
        </div>
      </div>

      {/* Stats Section - Bento Grid */}
      <div className={styles.statsSection}>
        <h2 className={styles.sectionHeading}>{t('dashboard.overview')}</h2>
        <div className={styles.bentoGrid}>
          {quickStats.map((stat, index) => (
            <Link
              key={stat.path}
              to={stat.path}
              className={`${styles.bentoCard} ${index === 0 ? styles.bentoLarge : ''}`}
            >
              <div className={styles.bentoIcon}>{stat.icon}</div>
              <div className={styles.bentoContent}>
                <span className={styles.bentoValue}>{stat.loading ? '...' : stat.value}</span>
                <span className={styles.bentoLabel}>{stat.label}</span>
                {stat.sublabel && !stat.loading && (
                  <span className={styles.bentoSublabel}>{stat.sublabel}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Config Section */}
      {config && (
        <div className={styles.configSection}>
          <h2 className={styles.sectionHeading}>{t('dashboard.current_config')}</h2>
          <div className={styles.configPillGrid}>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.debug_enable')}</span>
              <span className={`${styles.configPillValue} ${config.debug ? styles.on : styles.off}`}>
                {config.debug ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.usage_statistics_enable')}</span>
              <span className={`${styles.configPillValue} ${config.usageStatisticsEnabled ? styles.on : styles.off}`}>
                {config.usageStatisticsEnabled ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.logging_to_file_enable')}</span>
              <span className={`${styles.configPillValue} ${config.loggingToFile ? styles.on : styles.off}`}>
                {config.loggingToFile ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.retry_count_label')}</span>
              <span className={styles.configPillValue}>{config.requestRetry ?? 0}</span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.ws_auth_enable')}</span>
              <span className={`${styles.configPillValue} ${config.wsAuth ? styles.on : styles.off}`}>
                {config.wsAuth ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={`${styles.configPill} ${styles.configBadge} ${routingStrategyBadgeClass}`}>
              <span className={styles.configPillLabel}>{t('dashboard.routing_strategy')}</span>
              <span className={styles.configPillValue}>{routingStrategyDisplay}</span>
            </div>
            {config.proxyUrl && (
              <div className={`${styles.configPill} ${styles.configPillWide}`}>
                <span className={styles.configPillLabel}>{t('basic_settings.proxy_url_label')}</span>
                <span className={styles.configPillMono}>{config.proxyUrl}</span>
              </div>
            )}
          </div>
          <Link to="/config" className={styles.viewMoreLink}>
            {t('dashboard.edit_settings')} →
          </Link>
        </div>
      )}
    </div>
  );
}
