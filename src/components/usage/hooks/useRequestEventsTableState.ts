import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ListImperativeAPI } from 'react-window';
import type { RequestEventRow } from './usageAnalyticsSnapshot';

export const ALL_REQUEST_EVENT_FILTER = '__all__';
const REQUEST_EVENTS_PAGE_SIZE = 50;

const extractFilterOptionSets = (rows: readonly RequestEventRow[]) => {
  const models = new Set<string>();
  const sources = new Set<string>();
  const authIndices = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    models.add(row.model);
    sources.add(row.source);
    authIndices.add(row.authIndex);
  }

  return { models, sources, authIndices };
};

export interface UseRequestEventsTableStateOptions {
  rows: RequestEventRow[];
  externalModelFilter?: string | null;
  externalSourceFilter?: string | null;
  externalSourceRawFilter?: string | null;
  externalAuthIndexFilter?: string | null;
}

export interface UseRequestEventsTableStateReturn {
  listRef: RefObject<ListImperativeAPI | null>;
  modelSet: ReadonlySet<string>;
  sourceSet: ReadonlySet<string>;
  authIndexSet: ReadonlySet<string>;
  effectiveModelFilter: string;
  effectiveSourceFilter: string;
  effectiveResultFilter: string;
  effectiveAuthIndexFilter: string;
  filteredRows: RequestEventRow[];
  renderedRows: RequestEventRow[];
  currentPage: number;
  totalPages: number;
  newDataPulse: boolean;
  hasActiveFilters: boolean;
  hasExternalDrilldown: boolean;
  handleModelFilterChange: (value: string) => void;
  handleSourceFilterChange: (value: string) => void;
  handleResultFilterChange: (value: string) => void;
  handleAuthIndexFilterChange: (value: string) => void;
  handlePreviousPage: () => void;
  handleNextPage: () => void;
  resetFilters: () => void;
}

export function useRequestEventsTableState({
  rows,
  externalModelFilter = null,
  externalSourceFilter = null,
  externalSourceRawFilter = null,
  externalAuthIndexFilter = null,
}: UseRequestEventsTableStateOptions): UseRequestEventsTableStateReturn {
  const [modelFilter, setModelFilter] = useState<string>(ALL_REQUEST_EVENT_FILTER);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL_REQUEST_EVENT_FILTER);
  const [resultFilter, setResultFilter] = useState<string>(ALL_REQUEST_EVENT_FILTER);
  const [authIndexFilter, setAuthIndexFilter] = useState<string>(ALL_REQUEST_EVENT_FILTER);
  const [page, setPage] = useState(1);
  const [newDataPulse, setNewDataPulse] = useState(false);
  const prevRowsLengthRef = useRef(rows.length);
  const listRef = useRef<ListImperativeAPI>(null);

  useEffect(() => {
    listRef.current?.scrollToRow({ index: 0, behavior: 'auto' });
  }, [page]);

  const handleModelFilterChange = useCallback((value: string) => {
    setModelFilter(value);
    setPage(1);
  }, []);

  const handleSourceFilterChange = useCallback((value: string) => {
    setSourceFilter(value);
    setAuthIndexFilter(ALL_REQUEST_EVENT_FILTER);
    setPage(1);
  }, []);

  const handleResultFilterChange = useCallback((value: string) => {
    setResultFilter(value);
    setPage(1);
  }, []);

  const handleAuthIndexFilterChange = useCallback((value: string) => {
    setAuthIndexFilter(value);
    setPage(1);
  }, []);

  const { modelSet, sourceSet, authIndexSet } = useMemo(() => {
    const { models, sources, authIndices } = extractFilterOptionSets(rows);
    return { modelSet: models, sourceSet: sources, authIndexSet: authIndices };
  }, [rows]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to local fallback state
    setModelFilter(externalModelFilter ?? ALL_REQUEST_EVENT_FILTER);
    setPage(1);
  }, [externalModelFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to local fallback state
    setSourceFilter(externalSourceFilter ?? ALL_REQUEST_EVENT_FILTER);
    if (externalSourceFilter !== null && externalAuthIndexFilter === null) {
      setAuthIndexFilter(ALL_REQUEST_EVENT_FILTER);
    }
    setPage(1);
  }, [externalAuthIndexFilter, externalSourceFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop to local fallback state
    setAuthIndexFilter(externalAuthIndexFilter ?? ALL_REQUEST_EVENT_FILTER);
    setPage(1);
  }, [externalAuthIndexFilter]);

  const effectiveModelFilter =
    externalModelFilter ??
    (modelFilter === ALL_REQUEST_EVENT_FILTER || modelSet.has(modelFilter)
      ? modelFilter
      : ALL_REQUEST_EVENT_FILTER);
  const effectiveSourceFilter =
    externalSourceFilter ??
    (sourceFilter === ALL_REQUEST_EVENT_FILTER || sourceSet.has(sourceFilter)
      ? sourceFilter
      : ALL_REQUEST_EVENT_FILTER);
  const effectiveResultFilter = resultFilter;
  const effectiveAuthIndexFilter =
    externalAuthIndexFilter ??
    (authIndexFilter === ALL_REQUEST_EVENT_FILTER || authIndexSet.has(authIndexFilter)
      ? authIndexFilter
      : ALL_REQUEST_EVENT_FILTER);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const modelMatched =
          effectiveModelFilter === ALL_REQUEST_EVENT_FILTER || row.model === effectiveModelFilter;
        const sourceMatched =
          effectiveSourceFilter === ALL_REQUEST_EVENT_FILTER ||
          row.source === effectiveSourceFilter;
        const sourceRawMatched =
          externalSourceRawFilter === null || row.sourceRaw === externalSourceRawFilter;
        const resultMatched =
          effectiveResultFilter === ALL_REQUEST_EVENT_FILTER ||
          (effectiveResultFilter === 'failure' ? row.failed : !row.failed);
        const authIndexMatched =
          effectiveAuthIndexFilter === ALL_REQUEST_EVENT_FILTER ||
          row.authIndex === effectiveAuthIndexFilter;

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync derived page bounds back to state
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
    const start = (currentPage - 1) * REQUEST_EVENTS_PAGE_SIZE;
    return filteredRows.slice(start, start + REQUEST_EVENTS_PAGE_SIZE);
  }, [currentPage, filteredRows]);

  const hasActiveFilters =
    effectiveModelFilter !== ALL_REQUEST_EVENT_FILTER ||
    effectiveSourceFilter !== ALL_REQUEST_EVENT_FILTER ||
    effectiveResultFilter !== ALL_REQUEST_EVENT_FILTER ||
    effectiveAuthIndexFilter !== ALL_REQUEST_EVENT_FILTER ||
    externalSourceRawFilter !== null;

  const hasExternalDrilldown =
    externalModelFilter !== null ||
    externalSourceFilter !== null ||
    externalAuthIndexFilter !== null ||
    externalSourceRawFilter !== null;

  const handlePreviousPage = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const resetFilters = useCallback(() => {
    setModelFilter(ALL_REQUEST_EVENT_FILTER);
    setSourceFilter(ALL_REQUEST_EVENT_FILTER);
    setResultFilter(ALL_REQUEST_EVENT_FILTER);
    setAuthIndexFilter(ALL_REQUEST_EVENT_FILTER);
    setPage(1);
  }, []);

  return {
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
  };
}
