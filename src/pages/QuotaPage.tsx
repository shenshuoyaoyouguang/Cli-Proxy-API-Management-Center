/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles()]);
  }, [loadConfig, loadFiles]);

  useHeaderRefresh(handleHeaderRefresh);

  // Background polling every 60s (does not show loading overlay)
  useInterval(() => {
    if (connectionStatus !== 'connected') return;
    setIsRefreshing(true);
    void Promise.all([loadConfig(), loadFiles()]).finally(() => setIsRefreshing(false));
  }, 60000);

  useEffect(() => {
    loadFiles();
    loadConfig();
  }, [loadFiles, loadConfig]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>
          {t('quota_management.title')}
          {isRefreshing && (
            <span title={t('common.loading')}>
              <LoadingSpinner size={14} />
            </span>
          )}
        </h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSection
        config={CLAUDE_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
    </div>
  );
}
