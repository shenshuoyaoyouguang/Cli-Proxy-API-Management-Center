import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { USAGE_STATS_STALE_TIME_MS, useNotificationStore, useUsageStatsStore } from '@/stores';
import { usageApi } from '@/services/api/usage';
import { downloadBlob } from '@/utils/download';
import { loadModelPrices, saveModelPrices, type ModelPrice, type UsageDetail } from '@/utils/usage';
import { syncPricesForModels } from '@/molecules/usage/priceAutoSync';

const MODEL_PRICE_SYNC_RETRY_MS = 30_000;

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UseUsageDataReturn {
  usage: UsagePayload | null;
  loading: boolean;
  error: string;
  lastRefreshedAt: Date | null;
  usageDetails: UsageDetail[];
  modelPrices: Record<string, ModelPrice>;
  setModelPrices: (prices: Record<string, ModelPrice>) => void;
  loadUsage: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleImport: () => void;
  handleImportChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  exporting: boolean;
  importing: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isUsageImportPayload = (payload: unknown): payload is Record<string, unknown> => {
  if (!isRecord(payload)) {
    return false;
  }

  if (payload.version !== undefined && !Number.isFinite(Number(payload.version))) {
    return false;
  }

  if (payload.exported_at !== undefined && typeof payload.exported_at !== 'string') {
    return false;
  }

  if (payload.usage !== undefined) {
    return isRecord(payload.usage);
  }

  if (payload.apis !== undefined) {
    return isRecord(payload.apis);
  }

  return false;
};

export function useUsageData(): UseUsageDataReturn {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const usageSnapshot = useUsageStatsStore((state) => state.usage);
  const loading = useUsageStatsStore((state) => state.loading);
  const storeError = useUsageStatsStore((state) => state.error);
  const lastRefreshedAtTs = useUsageStatsStore((state) => state.lastRefreshedAt);
  const usageDetails = useUsageStatsStore((state) => state.usageDetails);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>({});
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [priceSyncRetryNonce, setPriceSyncRetryNonce] = useState(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const priceSyncStateRef = useRef<{
    inFlightSignature: string | null;
    lastSyncedSignature: string | null;
  }>({ inFlightSignature: null, lastSyncedSignature: null });
  const priceSyncRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPriceSyncRetryTimer = () => {
    if (priceSyncRetryTimerRef.current) {
      clearTimeout(priceSyncRetryTimerRef.current);
      priceSyncRetryTimerRef.current = null;
    }
  };

  const loadUsage = useCallback(async () => {
    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  useEffect(() => {
    void loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {});
    setModelPrices(loadModelPrices());
  }, [loadUsageStats]);

  useEffect(() => {
    const modelNames = [
      ...new Set(usageDetails.map((d) => d.__modelName).filter((n): n is string => Boolean(n))),
    ].sort();
    if (modelNames.length === 0) return;

    const signature = modelNames.join('\u0000');
    if (
      priceSyncStateRef.current.inFlightSignature === signature ||
      priceSyncStateRef.current.lastSyncedSignature === signature
    ) {
      return;
    }

    priceSyncStateRef.current.inFlightSignature = signature;
    const currentPrices = loadModelPrices();
    void syncPricesForModels(modelNames, currentPrices)
      .then((updated) => {
        priceSyncStateRef.current.inFlightSignature = null;
        priceSyncStateRef.current.lastSyncedSignature = signature;
        clearPriceSyncRetryTimer();
        if (updated !== currentPrices) {
          setModelPrices(updated);
          saveModelPrices(updated);
        }
      })
      .catch(() => {
        priceSyncStateRef.current.inFlightSignature = null;
        clearPriceSyncRetryTimer();
        priceSyncRetryTimerRef.current = setTimeout(() => {
          priceSyncRetryTimerRef.current = null;
          setPriceSyncRetryNonce((value) => value + 1);
        }, MODEL_PRICE_SYNC_RETRY_MS);
      });
  }, [priceSyncRetryNonce, usageDetails]);

  useEffect(
    () => () => {
      clearPriceSyncRetryTimer();
    },
    []
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await usageApi.exportUsage();
      const exportedAt =
        typeof data?.exported_at === 'string' ? new Date(data.exported_at) : new Date();
      const safeTimestamp = Number.isNaN(exportedAt.getTime())
        ? new Date().toISOString()
        : exportedAt.toISOString();
      const filename = `usage-export-${safeTimestamp.replace(/[:.]/g, '-')}.json`;
      downloadBlob({
        filename,
        blob: new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' })
      });
      showNotification(t('usage_stats.export_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        showNotification(t('usage_stats.import_invalid'), 'error');
        return;
      }
      if (!isUsageImportPayload(payload)) {
        showNotification(t('usage_stats.import_invalid'), 'error');
        return;
      }

      const result = await usageApi.importUsage(payload);
      showNotification(
        t('usage_stats.import_success', {
          added: result?.added ?? 0,
          skipped: result?.skipped ?? 0,
          total: result?.total_requests ?? 0,
          failed: result?.failed_requests ?? 0
        }),
        'success'
      );
      try {
        await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        showNotification(
          `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setImporting(false);
    }
  };

  const handleSetModelPrices = useCallback((prices: Record<string, ModelPrice>) => {
    setModelPrices(prices);
    saveModelPrices(prices);
  }, []);

  const usage = usageSnapshot as UsagePayload | null;
  const error = storeError || '';
  const lastRefreshedAt = lastRefreshedAtTs ? new Date(lastRefreshedAtTs) : null;

  return {
    usage,
    loading,
    error,
    lastRefreshedAt,
    usageDetails,
    modelPrices,
    setModelPrices: handleSetModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing
  };
}
