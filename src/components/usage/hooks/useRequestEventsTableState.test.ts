import { describe, expect, it } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useRequestEventsTableState,
  ALL_REQUEST_EVENT_FILTER,
} from './useRequestEventsTableState';
import type { RequestEventRow } from './usageAnalyticsSnapshot';

const createRow = (overrides: Partial<RequestEventRow> = {}): RequestEventRow => ({
  id: 'row-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  timestampMs: Date.parse('2026-01-01T00:00:00.000Z'),
  timestampLabel: '2026/1/1 00:00:00',
  model: 'model-a',
  sourceRaw: 'tenant-a',
  source: 'tenant-a',
  sourceType: 'claude',
  authIndex: '7',
  failed: false,
  inputTokens: 10,
  outputTokens: 5,
  reasoningTokens: 2,
  cachedTokens: 3,
  totalTokens: 20,
  ...overrides,
});

describe('useRequestEventsTableState', () => {
  describe('初始状态', () => {
    it('默认筛选器值为 ALL', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: [createRow()] })
      );

      expect(result.current.effectiveModelFilter).toBe(ALL_REQUEST_EVENT_FILTER);
      expect(result.current.effectiveSourceFilter).toBe(ALL_REQUEST_EVENT_FILTER);
      expect(result.current.effectiveResultFilter).toBe(ALL_REQUEST_EVENT_FILTER);
      expect(result.current.effectiveAuthIndexFilter).toBe(ALL_REQUEST_EVENT_FILTER);
    });

    it('默认页码为 1', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: [createRow()] })
      );

      expect(result.current.currentPage).toBe(1);
      expect(result.current.totalPages).toBe(1);
    });

    it('没有活动筛选器', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: [createRow()] })
      );

      expect(result.current.hasActiveFilters).toBe(false);
      expect(result.current.hasExternalDrilldown).toBe(false);
    });
  });

  describe('筛选器选项提取', () => {
    it('从行数据中提取唯一的模型选项', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ model: 'model-a' }),
            createRow({ id: 'row-2', model: 'model-b' }),
            createRow({ id: 'row-3', model: 'model-a' }),
          ],
        })
      );

      expect(result.current.modelSet.size).toBe(2);
      expect(result.current.modelSet.has('model-a')).toBe(true);
      expect(result.current.modelSet.has('model-b')).toBe(true);
    });

    it('从行数据中提取唯一的来源选项', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ source: 'tenant-a' }),
            createRow({ id: 'row-2', source: 'tenant-b' }),
          ],
        })
      );

      expect(result.current.sourceSet.size).toBe(2);
      expect(result.current.sourceSet.has('tenant-a')).toBe(true);
      expect(result.current.sourceSet.has('tenant-b')).toBe(true);
    });

    it('从行数据中提取唯一的认证索引选项', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ authIndex: 'auth-1' }),
            createRow({ id: 'row-2', authIndex: 'auth-2' }),
          ],
        })
      );

      expect(result.current.authIndexSet.size).toBe(2);
      expect(result.current.authIndexSet.has('auth-1')).toBe(true);
      expect(result.current.authIndexSet.has('auth-2')).toBe(true);
    });
  });

  describe('筛选功能', () => {
    it('按模型筛选', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ model: 'model-a' }),
            createRow({ id: 'row-2', model: 'model-b' }),
          ],
        })
      );

      act(() => {
        result.current.handleModelFilterChange('model-b');
      });

      expect(result.current.filteredRows).toHaveLength(1);
      expect(result.current.filteredRows[0].model).toBe('model-b');
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('按来源筛选', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ source: 'tenant-a' }),
            createRow({ id: 'row-2', source: 'tenant-b' }),
          ],
        })
      );

      act(() => {
        result.current.handleSourceFilterChange('tenant-b');
      });

      expect(result.current.filteredRows).toHaveLength(1);
      expect(result.current.filteredRows[0].source).toBe('tenant-b');
    });

    it('按结果状态筛选 - 成功', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ failed: false }),
            createRow({ id: 'row-2', failed: true }),
          ],
        })
      );

      act(() => {
        result.current.handleResultFilterChange('success');
      });

      expect(result.current.filteredRows).toHaveLength(1);
      expect(result.current.filteredRows[0].failed).toBe(false);
    });

    it('按结果状态筛选 - 失败', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ failed: false }),
            createRow({ id: 'row-2', failed: true }),
          ],
        })
      );

      act(() => {
        result.current.handleResultFilterChange('failure');
      });

      expect(result.current.filteredRows).toHaveLength(1);
      expect(result.current.filteredRows[0].failed).toBe(true);
    });

    it('按认证索引筛选', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ authIndex: 'auth-1' }),
            createRow({ id: 'row-2', authIndex: 'auth-2' }),
          ],
        })
      );

      act(() => {
        result.current.handleAuthIndexFilterChange('auth-2');
      });

      expect(result.current.filteredRows).toHaveLength(1);
      expect(result.current.filteredRows[0].authIndex).toBe('auth-2');
    });

    it('组合多个筛选条件', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ model: 'model-a', source: 'tenant-a' }),
            createRow({ id: 'row-2', model: 'model-b', source: 'tenant-a' }),
            createRow({ id: 'row-3', model: 'model-b', source: 'tenant-b' }),
          ],
        })
      );

      act(() => {
        result.current.handleModelFilterChange('model-b');
        result.current.handleSourceFilterChange('tenant-a');
      });

      expect(result.current.filteredRows).toHaveLength(1);
      expect(result.current.filteredRows[0].id).toBe('row-2');
    });

    it('重置筛选器', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ model: 'model-a' }),
            createRow({ id: 'row-2', model: 'model-b' }),
          ],
        })
      );

      act(() => {
        result.current.handleModelFilterChange('model-b');
      });

      expect(result.current.filteredRows).toHaveLength(1);

      act(() => {
        result.current.resetFilters();
      });

      expect(result.current.filteredRows).toHaveLength(2);
      expect(result.current.hasActiveFilters).toBe(false);
    });
  });

  describe('外部筛选器', () => {
    it('应用外部模型筛选器', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ model: 'model-a' }),
            createRow({ id: 'row-2', model: 'model-b' }),
          ],
          externalModelFilter: 'model-b',
        })
      );

      expect(result.current.effectiveModelFilter).toBe('model-b');
      expect(result.current.filteredRows).toHaveLength(1);
      expect(result.current.hasExternalDrilldown).toBe(true);
    });

    it('应用外部来源筛选器', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ source: 'tenant-a' }),
            createRow({ id: 'row-2', source: 'tenant-b' }),
          ],
          externalSourceFilter: 'tenant-b',
        })
      );

      expect(result.current.effectiveSourceFilter).toBe('tenant-b');
      expect(result.current.filteredRows).toHaveLength(1);
    });

    it('应用外部认证索引筛选器', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ authIndex: 'auth-1' }),
            createRow({ id: 'row-2', authIndex: 'auth-2' }),
          ],
          externalAuthIndexFilter: 'auth-2',
        })
      );

      expect(result.current.effectiveAuthIndexFilter).toBe('auth-2');
      expect(result.current.filteredRows).toHaveLength(1);
    });

    it('外部筛选器优先级高于本地筛选器', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ model: 'model-a' }),
            createRow({ id: 'row-2', model: 'model-b' }),
          ],
          externalModelFilter: 'model-b',
        })
      );

      // 尝试更改本地筛选器，但外部筛选器应该优先
      act(() => {
        result.current.handleModelFilterChange('model-a');
      });

      expect(result.current.effectiveModelFilter).toBe('model-b');
    });

    it('externalSourceRawFilter 筛选', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ source: 'shared', sourceRaw: 'raw-a' }),
            createRow({ id: 'row-2', source: 'shared', sourceRaw: 'raw-b' }),
          ],
          externalSourceFilter: 'shared',
          externalSourceRawFilter: 'raw-b',
        })
      );

      expect(result.current.filteredRows).toHaveLength(1);
      expect(result.current.filteredRows[0].sourceRaw).toBe('raw-b');
    });
  });

  describe('分页功能', () => {
    it('计算正确的总页数', () => {
      const manyRows = Array.from({ length: 120 }, (_, i) =>
        createRow({ id: `row-${i}` })
      );

      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: manyRows })
      );

      expect(result.current.totalPages).toBe(3);
    });

    it('切换页面', () => {
      const manyRows = Array.from({ length: 120 }, (_, i) =>
        createRow({ id: `row-${i}` })
      );

      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: manyRows })
      );

      act(() => {
        result.current.handleNextPage();
      });

      expect(result.current.currentPage).toBe(2);

      act(() => {
        result.current.handleNextPage();
      });

      expect(result.current.currentPage).toBe(3);

      act(() => {
        result.current.handlePreviousPage();
      });

      expect(result.current.currentPage).toBe(2);
    });

    it('页码不超过总页数', () => {
      const manyRows = Array.from({ length: 60 }, (_, i) =>
        createRow({ id: `row-${i}` })
      );

      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: manyRows })
      );

      act(() => {
        result.current.handleNextPage();
        result.current.handleNextPage();
        result.current.handleNextPage();
      });

      expect(result.current.currentPage).toBe(2);
    });

    it('页码不小于 1', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: [createRow()] })
      );

      act(() => {
        result.current.handlePreviousPage();
      });

      expect(result.current.currentPage).toBe(1);
    });

    it('更改筛选器时重置到第一页', () => {
      const manyRows = Array.from({ length: 120 }, (_, i) =>
        createRow({ id: `row-${i}`, model: `model-${i % 2}` })
      );

      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: manyRows })
      );

      act(() => {
        result.current.handleNextPage();
      });

      expect(result.current.currentPage).toBe(2);

      act(() => {
        result.current.handleModelFilterChange('model-0');
      });

      expect(result.current.currentPage).toBe(1);
    });

    it('正确渲染当前页的行', () => {
      const manyRows = Array.from({ length: 60 }, (_, i) =>
        createRow({ id: `row-${i}`, model: `model-${i}` })
      );

      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: manyRows })
      );

      expect(result.current.renderedRows).toHaveLength(50);
      expect(result.current.renderedRows[0].id).toBe('row-0');
      expect(result.current.renderedRows[49].id).toBe('row-49');

      act(() => {
        result.current.handleNextPage();
      });

      expect(result.current.renderedRows).toHaveLength(10);
      expect(result.current.renderedRows[0].id).toBe('row-50');
    });
  });

  describe('新数据脉冲', () => {
    it('数据增加时触发新数据脉冲', async () => {
      // 先渲染一些数据，然后增加更多数据
      const { result, rerender } = renderHook(
        ({ rows }) => useRequestEventsTableState({ rows }),
        {
          initialProps: { rows: [createRow()] },
        }
      );

      // 初始有数据，不触发脉冲
      expect(result.current.newDataPulse).toBe(false);

      // 再次添加数据，应该触发脉冲（因为 prevRowsLengthRef.current > 0）
      rerender({
        rows: [createRow(), createRow({ id: 'row-2' })],
      });

      // 等待状态更新
      await waitFor(() => expect(result.current.newDataPulse).toBe(true));

      // 等待脉冲结束
      await waitFor(() => expect(result.current.newDataPulse).toBe(false), {
        timeout: 1500,
      });
    });

    it('初始加载不触发脉冲', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: [createRow()] })
      );

      expect(result.current.newDataPulse).toBe(false);
    });

    it('从空到非空不触发脉冲', () => {
      const { result, rerender } = renderHook(
        ({ rows }) => useRequestEventsTableState({ rows }),
        {
          initialProps: { rows: [] as RequestEventRow[] },
        }
      );

      expect(result.current.newDataPulse).toBe(false);

      rerender({
        rows: [createRow()],
      });

      // 从空到非空不触发脉冲
      expect(result.current.newDataPulse).toBe(false);
    });
  });

  describe('筛选器变化时重置', () => {
    it('更改模型筛选器时重置页码', () => {
      const manyRows = Array.from({ length: 120 }, (_, i) =>
        createRow({ id: `row-${i}` })
      );

      const { result } = renderHook(() =>
        useRequestEventsTableState({ rows: manyRows })
      );

      act(() => {
        result.current.handleNextPage();
      });

      expect(result.current.currentPage).toBe(2);

      act(() => {
        result.current.handleModelFilterChange('some-model');
      });

      expect(result.current.currentPage).toBe(1);
    });

    it('更改来源筛选器时重置认证索引筛选器', () => {
      const { result } = renderHook(() =>
        useRequestEventsTableState({
          rows: [
            createRow({ source: 'tenant-a', authIndex: 'auth-1' }),
            createRow({ id: 'row-2', source: 'tenant-b', authIndex: 'auth-2' }),
          ],
        })
      );

      act(() => {
        result.current.handleAuthIndexFilterChange('auth-1');
      });

      expect(result.current.effectiveAuthIndexFilter).toBe('auth-1');

      act(() => {
        result.current.handleSourceFilterChange('tenant-b');
      });

      expect(result.current.effectiveAuthIndexFilter).toBe(ALL_REQUEST_EVENT_FILTER);
    });
  });
});
