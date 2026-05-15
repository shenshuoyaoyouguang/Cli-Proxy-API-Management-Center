import { memo, useMemo } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { downloadBlob } from '@/utils/download';
import type { RequestEventRow } from './hooks/usageAnalyticsSnapshot';
import {
  ALL_REQUEST_EVENT_FILTER,
  useRequestEventsTableState,
} from './hooks/useRequestEventsTableState';
import styles from '@/pages/UsagePage.module.scss';

const ROW_HEIGHT = 40;
const TABLE_HEADER_HEIGHT = 40;
const TABLE_MAX_HEIGHT = 480;
const TABLE_GRID_TEMPLATE =
  'minmax(140px, 1.2fr) minmax(100px, 1fr) minmax(80px, 0.8fr) minmax(60px, 0.6fr) minmax(50px, 0.5fr) minmax(70px, 0.7fr) minmax(70px, 0.7fr) minmax(80px, 0.8fr) minmax(70px, 0.7fr) minmax(80px, 0.8fr)';

export interface RequestEventsDetailsCardProps {
  rows: RequestEventRow[];
  loading: boolean;
  error?: string | null;
  externalModelFilter?: string | null;
  externalSourceFilter?: string | null;
  externalSourceRawFilter?: string | null;
  externalAuthIndexFilter?: string | null;
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
  if (
    !value ||
    value === ALL_REQUEST_EVENT_FILTER ||
    options.some((option) => option.value === value)
  ) {
    return options;
  }

  return [...options, { value, label: value }];
};

function VirtualRow({
  index,
  style,
  rows,
}: RowComponentProps<{ rows: RequestEventRow[] }>) {
  const row = rows[index];

  if (!row) {
    return null;
  }

  return (
    <div
      role="row"
      className={styles.requestEventsVirtualRow}
      style={{ ...style, display: 'grid', gridTemplateColumns: TABLE_GRID_TEMPLATE }}
    >
      <div title={row.timestamp} className={styles.requestEventsTimestamp}>
        {row.timestampLabel}
      </div>
      <div className={styles.modelCell}>{row.model}</div>
      <div className={styles.requestEventsSourceCell} title={row.source}>
        <span>{row.source}</span>
        {row.sourceType && <span className={styles.credentialType}>{row.sourceType}</span>}
      </div>
      <div className={styles.requestEventsAuthIndex} title={row.authIndex}>
        {row.authIndex}
      </div>
      <div>
        <span
          className={row.failed ? styles.requestEventsResultFailed : styles.requestEventsResultSuccess}
        >
          {row.failed ? '✕' : '✓'}
        </span>
      </div>
      <div>{row.inputTokens.toLocaleString()}</div>
      <div>{row.outputTokens.toLocaleString()}</div>
      <div>{row.reasoningTokens.toLocaleString()}</div>
      <div>{row.cachedTokens.toLocaleString()}</div>
      <div>{row.totalTokens.toLocaleString()}</div>
    </div>
  );
}

export const RequestEventsDetailsCard = memo(function RequestEventsDetailsCard({
  rows,
  loading,
  error = null,
  externalModelFilter = null,
  externalSourceFilter = null,
  externalSourceRawFilter = null,
  externalAuthIndexFilter = null,
  onClearExternalFilters,
}: RequestEventsDetailsCardProps) {
  const { t } = useTranslation();
  const {
    listRef,
    modelSet,
    sourceSet,
    authIndexSet,
    effectiveModelFilter,
    effectiveSourceFilter,
    effectiveResultFilter,
    effectiveAuthIndexFilter,
    filteredRows,
    renderedRows,
    currentPage,
    totalPages,
    newDataPulse,
    hasActiveFilters,
    hasExternalDrilldown,
    handleModelFilterChange,
    handleSourceFilterChange,
    handleResultFilterChange,
    handleAuthIndexFilterChange,
    handlePreviousPage,
    handleNextPage,
    resetFilters,
  } = useRequestEventsTableState({
    rows,
    externalModelFilter,
    externalSourceFilter,
    externalSourceRawFilter,
    externalAuthIndexFilter,
  });

  const resultOptions = useMemo(
    () => [
      { value: ALL_REQUEST_EVENT_FILTER, label: t('usage_stats.filter_all') },
      { value: 'failure', label: t('stats.failure') },
      { value: 'success', label: t('stats.success') },
    ],
    [t]
  );

  const modelOptions = useMemo(
    () =>
      appendActiveOption(
        [
          { value: ALL_REQUEST_EVENT_FILTER, label: t('usage_stats.filter_all') },
          ...Array.from(modelSet, (model) => ({ value: model, label: model })),
        ],
        effectiveModelFilter
      ),
    [effectiveModelFilter, modelSet, t]
  );

  const sourceOptions = useMemo(
    () =>
      appendActiveOption(
        [
          { value: ALL_REQUEST_EVENT_FILTER, label: t('usage_stats.filter_all') },
          ...Array.from(sourceSet, (source) => ({ value: source, label: source })),
        ],
        effectiveSourceFilter
      ),
    [effectiveSourceFilter, sourceSet, t]
  );

  const authIndexOptions = useMemo(
    () =>
      appendActiveOption(
        [
          { value: ALL_REQUEST_EVENT_FILTER, label: t('usage_stats.filter_all') },
          ...Array.from(authIndexSet, (authIndex) => ({
            value: authIndex,
            label: authIndex,
          })),
        ],
        effectiveAuthIndexFilter
      ),
    [authIndexSet, effectiveAuthIndexFilter, t]
  );

  const virtualListHeight = Math.min(
    renderedRows.length * ROW_HEIGHT,
    TABLE_MAX_HEIGHT - TABLE_HEADER_HEIGHT
  );

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
  ].filter((value): value is string => Boolean(value));

  const handleClearFilters = () => {
    resetFilters();
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
      blob: new Blob([content], { type: 'application/json' }),
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
        <div className={styles.requestEventsFilterGroup}>
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
              fullWidth
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
              fullWidth
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
              fullWidth
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
              fullWidth
            />
          </div>
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
          <div className={styles.requestEventsTableHeader}>
            <div className={styles.requestEventsMeta}>
              <span className={newDataPulse ? styles.requestEventsNewDataPulse : ''}>
                {t('usage_stats.request_events_count', { count: filteredRows.length })}
                {newDataPulse && (
                  <span className={styles.requestEventsLiveIndicator}> {t('usage_stats.live')}</span>
                )}
              </span>
            </div>
            {totalPages > 1 && (
              <div className={styles.requestEventsPagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePreviousPage}
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
                  onClick={handleNextPage}
                  disabled={currentPage >= totalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </div>

          <div className={styles.requestEventsTableWrapper}>
            <div
              role="table"
              className={styles.requestEventsTableGrid}
              style={{ gridTemplateColumns: TABLE_GRID_TEMPLATE }}
            >
              <div role="row" className={styles.requestEventsTableHeaderRow}>
                <div role="columnheader">{t('usage_stats.request_events_timestamp')}</div>
                <div role="columnheader">{t('usage_stats.model_name')}</div>
                <div role="columnheader">{t('usage_stats.request_events_source')}</div>
                <div role="columnheader">{t('usage_stats.request_events_auth_index')}</div>
                <div role="columnheader">{t('usage_stats.request_events_result')}</div>
                <div role="columnheader">{t('usage_stats.input_tokens')}</div>
                <div role="columnheader">{t('usage_stats.output_tokens')}</div>
                <div role="columnheader">{t('usage_stats.reasoning_tokens')}</div>
                <div role="columnheader">{t('usage_stats.cached_tokens')}</div>
                <div role="columnheader">{t('usage_stats.total_tokens')}</div>
              </div>
              <div role="rowgroup">
                <List
                  listRef={listRef}
                  rowCount={renderedRows.length}
                  rowHeight={ROW_HEIGHT}
                  rowComponent={VirtualRow}
                  rowProps={{ rows: renderedRows }}
                  style={{ height: virtualListHeight }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
});
