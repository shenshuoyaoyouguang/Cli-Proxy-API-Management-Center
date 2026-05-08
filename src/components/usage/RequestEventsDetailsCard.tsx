import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { downloadBlob } from '@/utils/download';
import type { RequestEventRow } from './hooks/usageAnalyticsSnapshot';
import styles from '@/pages/UsagePage.module.scss';

const ALL_FILTER = '__all__';
const REQUEST_EVENTS_PAGE_SIZE = 100;

export interface RequestEventsDetailsCardProps {
  rows: RequestEventRow[];
  loading: boolean;
  error?: string | null;
  externalModelFilter?: string | null;
  externalSourceFilter?: string | null;
  externalSourceRawFilter?: string | null;
  externalAuthIndexFilter?: string | null;
  externalResultFilter?: 'success' | 'failure' | null;
  onClearExternalFilters?: () => void;
}

const encodeCsv = (value: string | number): string => {
  const text = String(value ?? '');
  const trimmedLeft = text.replace(/^\s+/, '');
  const safeText = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

const appendActiveOption = (
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null
) => {
  if (!value || value === ALL_FILTER || options.some((option) => option.value === value)) {
    return options;
  }

  return [...options, { value, label: value }];
};

export const RequestEventsDetailsCard = memo(function RequestEventsDetailsCard({
  rows,
  loading,
  error = null,
  externalModelFilter = null,
  externalSourceFilter = null,
  externalSourceRawFilter = null,
  externalAuthIndexFilter = null,
  externalResultFilter = null,
  onClearExternalFilters,
}: RequestEventsDetailsCardProps) {
  const { t } = useTranslation();

  const [modelFilter, setModelFilter] = useState<string>(ALL_FILTER);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL_FILTER);
  const [resultFilter, setResultFilter] = useState<string>(ALL_FILTER);
  const [authIndexFilter, setAuthIndexFilter] = useState<string>(ALL_FILTER);
  const [page, setPage] = useState(1);
  const [newDataPulse, setNewDataPulse] = useState(false);
  const prevRowsLengthRef = useRef(rows.length);

  const handleModelFilterChange = (value: string) => {
    setModelFilter(value);
    setPage(1);
  };

  const handleSourceFilterChange = (value: string) => {
    setSourceFilter(value);
    setPage(1);
  };

  const handleResultFilterChange = (value: string) => {
    setResultFilter(value);
    setPage(1);
  };

  const handleAuthIndexFilterChange = (value: string) => {
    setAuthIndexFilter(value);
    setPage(1);
  };

  const activeModelFilter = externalModelFilter ?? modelFilter;
  const activeSourceFilter = externalSourceFilter ?? sourceFilter;
  const activeAuthIndexFilter = externalAuthIndexFilter ?? authIndexFilter;

  const resultOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      { value: 'failure', label: t('stats.failure') },
      { value: 'success', label: t('stats.success') },
    ],
    [t]
  );

  const modelOptions = useMemo(
    () =>
      appendActiveOption(
        [
          { value: ALL_FILTER, label: t('usage_stats.filter_all') },
          ...Array.from(new Set(rows.map((row) => row.model))).map((model) => ({
            value: model,
            label: model,
          })),
        ],
        activeModelFilter
      ),
    [activeModelFilter, rows, t]
  );

  const sourceOptions = useMemo(
    () =>
      appendActiveOption(
        [
          { value: ALL_FILTER, label: t('usage_stats.filter_all') },
          ...Array.from(new Set(rows.map((row) => row.source))).map((source) => ({
            value: source,
            label: source,
          })),
        ],
        activeSourceFilter
      ),
    [activeSourceFilter, rows, t]
  );

  const authIndexOptions = useMemo(
    () =>
      appendActiveOption(
        [
          { value: ALL_FILTER, label: t('usage_stats.filter_all') },
          ...Array.from(new Set(rows.map((row) => row.authIndex))).map((authIndex) => ({
            value: authIndex,
            label: authIndex,
          })),
        ],
        activeAuthIndexFilter
      ),
    [activeAuthIndexFilter, rows, t]
  );

  const modelOptionSet = useMemo(
    () => new Set(modelOptions.map((option) => option.value)),
    [modelOptions]
  );
  const sourceOptionSet = useMemo(
    () => new Set(sourceOptions.map((option) => option.value)),
    [sourceOptions]
  );
  const resultOptionSet = useMemo(
    () => new Set(resultOptions.map((option) => option.value)),
    [resultOptions]
  );
  const authIndexOptionSet = useMemo(
    () => new Set(authIndexOptions.map((option) => option.value)),
    [authIndexOptions]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to local fallback state
    setModelFilter(externalModelFilter ?? ALL_FILTER);
    setPage(1);
  }, [externalModelFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to local fallback state
    setSourceFilter(externalSourceFilter ?? ALL_FILTER);
    if (externalSourceFilter !== null && externalAuthIndexFilter === null) {
      setAuthIndexFilter(ALL_FILTER);
    }
    setPage(1);
  }, [externalAuthIndexFilter, externalSourceFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to local fallback state
    setAuthIndexFilter(externalAuthIndexFilter ?? ALL_FILTER);
    setPage(1);
  }, [externalAuthIndexFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to local fallback state
    setResultFilter(externalResultFilter ?? ALL_FILTER);
    setPage(1);
  }, [externalResultFilter]);

  const effectiveModelFilter =
    externalModelFilter ?? (modelOptionSet.has(modelFilter) ? modelFilter : ALL_FILTER);
  const effectiveSourceFilter =
    externalSourceFilter ?? (sourceOptionSet.has(sourceFilter) ? sourceFilter : ALL_FILTER);
  const effectiveResultFilter =
    externalResultFilter ?? (resultOptionSet.has(resultFilter) ? resultFilter : ALL_FILTER);
  const effectiveAuthIndexFilter =
    externalAuthIndexFilter ??
    (authIndexOptionSet.has(authIndexFilter) ? authIndexFilter : ALL_FILTER);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const modelMatched =
          effectiveModelFilter === ALL_FILTER || row.model === effectiveModelFilter;
        const sourceMatched =
          effectiveSourceFilter === ALL_FILTER || row.source === effectiveSourceFilter;
        const sourceRawMatched =
          externalSourceRawFilter === null || row.sourceRaw === externalSourceRawFilter;
        const resultMatched =
          effectiveResultFilter === ALL_FILTER ||
          (effectiveResultFilter === 'failure' ? row.failed : !row.failed);
        const authIndexMatched =
          effectiveAuthIndexFilter === ALL_FILTER || row.authIndex === effectiveAuthIndexFilter;
        return (
          modelMatched && sourceMatched && sourceRawMatched && resultMatched && authIndexMatched
        );
      }),
    [
      effectiveAuthIndexFilter,
      effectiveModelFilter,
      effectiveResultFilter,
      effectiveSourceFilter,
      externalSourceRawFilter,
      rows,
    ]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / REQUEST_EVENTS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to internal state
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (rows.length > prevRowsLengthRef.current && prevRowsLengthRef.current > 0) {
      const timer = setTimeout(() => setNewDataPulse(false), 1200);
      queueMicrotask(() => setNewDataPulse(true));
      prevRowsLengthRef.current = rows.length;
      return () => clearTimeout(timer);
    }
    prevRowsLengthRef.current = rows.length;
  }, [rows.length]);

  const renderedRows = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * REQUEST_EVENTS_PAGE_SIZE;
    return filteredRows.slice(start, start + REQUEST_EVENTS_PAGE_SIZE);
  }, [filteredRows, page, totalPages]);

  const hasActiveFilters =
    effectiveModelFilter !== ALL_FILTER ||
    effectiveSourceFilter !== ALL_FILTER ||
    effectiveResultFilter !== ALL_FILTER ||
    effectiveAuthIndexFilter !== ALL_FILTER ||
    externalSourceRawFilter !== null;

  const hasExternalDrilldown =
    externalModelFilter !== null ||
    externalSourceFilter !== null ||
    externalAuthIndexFilter !== null ||
    externalResultFilter !== null ||
    externalSourceRawFilter !== null;

  const drilldownLabels = [
    externalModelFilter
      ? `${t('usage_stats.request_events_filter_model')}: ${externalModelFilter}`
      : null,
    externalSourceFilter
      ? `${t('usage_stats.request_events_filter_source')}: ${externalSourceFilter}`
      : null,
    externalAuthIndexFilter
      ? `${t('usage_stats.request_events_filter_auth_index')}: ${externalAuthIndexFilter}`
      : null,
    externalResultFilter
      ? `${t('usage_stats.request_events_result')}: ${
          externalResultFilter === 'failure' ? t('stats.failure') : t('stats.success')
        }`
      : null,
  ].filter((value): value is string => Boolean(value));

  const handleClearFilters = () => {
    setModelFilter(ALL_FILTER);
    setSourceFilter(ALL_FILTER);
    setResultFilter(ALL_FILTER);
    setAuthIndexFilter(ALL_FILTER);
    setPage(1);
    onClearExternalFilters?.();
  };

  const handleExportCsv = () => {
    if (!filteredRows.length) return;

    const csvHeader = [
      'timestamp',
      'model',
      'source',
      'source_raw',
      'auth_index',
      'result',
      'input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'total_tokens',
    ];

    const csvRows = filteredRows.map((row) =>
      [
        row.timestamp,
        row.model,
        row.source,
        row.sourceRaw,
        row.authIndex,
        row.failed ? 'failed' : 'success',
        row.inputTokens,
        row.outputTokens,
        row.reasoningTokens,
        row.cachedTokens,
        row.totalTokens,
      ]
        .map((value) => encodeCsv(value))
        .join(',')
    );

    const content = [csvHeader.join(','), ...csvRows].join('\n');
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.csv`,
      blob: new Blob([content], { type: 'text/csv;charset=utf-8' }),
    });
  };

  const handleExportJson = () => {
    if (!filteredRows.length) return;

    const payload = filteredRows.map((row) => ({
      timestamp: row.timestamp,
      model: row.model,
      source: row.source,
      source_raw: row.sourceRaw,
      auth_index: row.authIndex,
      failed: row.failed,
      tokens: {
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        cached_tokens: row.cachedTokens,
        total_tokens: row.totalTokens,
      },
    }));

    const content = JSON.stringify(payload, null, 2);
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.json`,
      blob: new Blob([content], { type: 'application/json;charset=utf-8' }),
    });
  };

  return (
    <Card
      title={t('usage_stats.request_events_title')}
      extra={
        <div className={styles.requestEventsActions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            disabled={!hasActiveFilters}
          >
            {t('usage_stats.clear_filters')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
          >
            {t('usage_stats.export_csv')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportJson}
            disabled={filteredRows.length === 0}
          >
            {t('usage_stats.export_json')}
          </Button>
        </div>
      }
    >
      {hasExternalDrilldown && (
        <div className={styles.requestEventsDrilldownBanner}>
          <div className={styles.requestEventsDrilldownInfo}>
            <span className={styles.requestEventsDrilldownText}>
              {t('usage_stats.drilldown_active')}
            </span>
            {drilldownLabels.length > 0 && (
              <div className={styles.requestEventsDrilldownChips}>
                {drilldownLabels.map((label) => (
                  <span key={label} className={styles.requestEventsDrilldownChip}>
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            {t('usage_stats.clear_filters')}
          </Button>
        </div>
      )}

      <div className={styles.requestEventsToolbar}>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_model')}
          </span>
          <Select
            value={effectiveModelFilter}
            options={modelOptions}
            onChange={handleModelFilterChange}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_model')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_source')}
          </span>
          <Select
            value={effectiveSourceFilter}
            options={sourceOptions}
            onChange={handleSourceFilterChange}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_source')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_result')}
          </span>
          <Select
            value={effectiveResultFilter}
            options={resultOptions}
            onChange={handleResultFilterChange}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_result')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_auth_index')}
          </span>
          <Select
            value={effectiveAuthIndexFilter}
            options={authIndexOptions}
            onChange={handleAuthIndexFilterChange}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_auth_index')}
            fullWidth={false}
          />
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : error && rows.length === 0 ? (
        <EmptyState title={t('usage_stats.loading_error')} description={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_empty_title')}
          description={t('usage_stats.request_events_empty_desc')}
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_no_result_title')}
          description={t('usage_stats.request_events_no_result_desc')}
        />
      ) : (
        <>
          <div className={styles.requestEventsMeta}>
            <span className={newDataPulse ? styles.requestEventsNewDataPulse : ''}>
              {t('usage_stats.request_events_count', { count: filteredRows.length })}
              {newDataPulse && (
                <span className={styles.requestEventsLiveIndicator}> {t('usage_stats.live')}</span>
              )}
            </span>
            {filteredRows.length > REQUEST_EVENTS_PAGE_SIZE && (
              <span className={styles.requestEventsLimitHint}>
                {currentPage}/{totalPages}
              </span>
            )}
          </div>

          {filteredRows.length > REQUEST_EVENTS_PAGE_SIZE && (
            <div className={styles.requestEventsPagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <span className={styles.requestEventsPaginationInfo}>
                {currentPage}/{totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}

          <div className={styles.requestEventsTableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage_stats.request_events_timestamp')}</th>
                  <th>{t('usage_stats.model_name')}</th>
                  <th>{t('usage_stats.request_events_source')}</th>
                  <th>{t('usage_stats.request_events_auth_index')}</th>
                  <th>{t('usage_stats.request_events_result')}</th>
                  <th>{t('usage_stats.input_tokens')}</th>
                  <th>{t('usage_stats.output_tokens')}</th>
                  <th>{t('usage_stats.reasoning_tokens')}</th>
                  <th>{t('usage_stats.cached_tokens')}</th>
                  <th>{t('usage_stats.total_tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => (
                  <tr key={row.id}>
                    <td title={row.timestamp} className={styles.requestEventsTimestamp}>
                      {row.timestampLabel}
                    </td>
                    <td className={styles.modelCell}>{row.model}</td>
                    <td className={styles.requestEventsSourceCell} title={row.source}>
                      <span>{row.source}</span>
                      {row.sourceType && (
                        <span className={styles.credentialType}>{row.sourceType}</span>
                      )}
                    </td>
                    <td className={styles.requestEventsAuthIndex} title={row.authIndex}>
                      {row.authIndex}
                    </td>
                    <td>
                      <span
                        className={
                          row.failed
                            ? styles.requestEventsResultFailed
                            : styles.requestEventsResultSuccess
                        }
                      >
                        {row.failed ? t('stats.failure') : t('stats.success')}
                      </span>
                    </td>
                    <td>{row.inputTokens.toLocaleString()}</td>
                    <td>{row.outputTokens.toLocaleString()}</td>
                    <td>{row.reasoningTokens.toLocaleString()}</td>
                    <td>{row.cachedTokens.toLocaleString()}</td>
                    <td>{row.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
});
