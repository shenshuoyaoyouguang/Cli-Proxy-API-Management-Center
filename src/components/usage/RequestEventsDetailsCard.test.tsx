import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequestEventsDetailsCard } from './RequestEventsDetailsCard';
import type { RequestEventRow } from './hooks/usageAnalyticsSnapshot';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

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

describe('RequestEventsDetailsCard', () => {
  describe('状态渲染', () => {
    it('加载状态：当没有数据且正在加载时显示加载提示', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={[]} loading={true} />
      );

      expect(markup).toContain('common.loading');
    });

    it('错误状态：加载失败且没有数据时显示错误信息', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={[]} loading={false} error="连接超时" />
      );

      expect(markup).toContain('usage_stats.loading_error');
      expect(markup).toContain('连接超时');
      expect(markup).not.toContain('usage_stats.request_events_empty_title');
    });

    it('空状态：没有请求事件数据时显示空状态提示', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={[]} loading={false} />
      );

      expect(markup).toContain('usage_stats.request_events_empty_title');
      expect(markup).toContain('usage_stats.request_events_empty_desc');
    });

    it('筛选无结果：筛选后没有匹配结果时显示无结果提示', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[createRow()]}
          loading={false}
          externalModelFilter="不存在的模型"
        />
      );

      expect(markup).toContain('usage_stats.request_events_no_result_title');
      expect(markup).toContain('usage_stats.request_events_no_result_desc');
    });
  });

  describe('数据渲染', () => {
    it('正常渲染：有数据时显示表格和行数统计', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[createRow(), createRow({ id: 'row-2', model: 'model-b' })]}
          loading={false}
        />
      );

      expect(markup).toContain('usage_stats.request_events_count');
      expect(markup).toContain('model-a');
      expect(markup).toContain('model-b');
      expect(markup).toContain('2026/1/1 00:00:00');
    });

    it('成功状态：显示成功标记', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={[createRow({ failed: false })]} loading={false} />
      );

      expect(markup).toContain('✓');
    });

    it('失败状态：显示失败标记', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={[createRow({ failed: true })]} loading={false} />
      );

      expect(markup).toContain('✕');
    });

    it('Token 数据：正确显示各类 Token 数量', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[
            createRow({
              inputTokens: 1000,
              outputTokens: 500,
              reasoningTokens: 200,
              cachedTokens: 300,
              totalTokens: 2000,
            }),
          ]}
          loading={false}
        />
      );

      expect(markup).toContain('1,000');
      expect(markup).toContain('500');
      expect(markup).toContain('200');
      expect(markup).toContain('300');
      expect(markup).toContain('2,000');
    });

    it('来源类型：显示来源和凭证类型', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[createRow({ source: 'my-tenant', sourceType: 'openai' })]}
          loading={false}
        />
      );

      expect(markup).toContain('my-tenant');
      expect(markup).toContain('openai');
    });
  });

  describe('筛选功能', () => {
    it('外部模型筛选：应用外部传入的模型筛选条件', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[createRow(), createRow({ id: 'row-2', model: 'model-b' })]}
          loading={false}
          externalModelFilter="model-b"
        />
      );

      expect(markup).toContain('model-b');
      expect(markup).not.toContain('model-a');
    });

    it('外部来源筛选：应用外部传入的来源筛选条件', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[
            createRow({ source: 'tenant-a' }),
            createRow({ id: 'row-2', source: 'tenant-b' }),
          ]}
          loading={false}
          externalSourceFilter="tenant-b"
        />
      );

      expect(markup).toContain('tenant-b');
      expect(markup).not.toContain('tenant-a');
    });

    it('外部认证索引筛选：应用外部传入的认证索引筛选条件', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[
            createRow({ authIndex: 'auth-1' }),
            createRow({ id: 'row-2', authIndex: 'auth-2' }),
          ]}
          loading={false}
          externalAuthIndexFilter="auth-2"
        />
      );

      expect(markup).toContain('auth-2');
      expect(markup).not.toContain('auth-1');
    });

    it('组合筛选：同时应用多个外部筛选条件', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[
            createRow({ model: 'model-a', source: 'tenant-a' }),
            createRow({ id: 'row-2', model: 'model-b', source: 'tenant-b' }),
            createRow({ id: 'row-3', model: 'model-b', source: 'tenant-a' }),
          ]}
          loading={false}
          externalModelFilter="model-b"
          externalSourceFilter="tenant-a"
        />
      );

      // 应该只显示同时匹配 model-b 和 tenant-a 的行
      expect(markup).toContain('model-b');
      expect(markup).toContain('tenant-a');
      // 不应该显示 model-a 或 tenant-b
      expect(markup).not.toContain('model-a');
    });

    it('原始来源筛选：使用 externalSourceRawFilter 区分相同显示名称的不同来源', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[
            createRow({
              source: 'shared-source',
              sourceRaw: 'tenant-a',
            }),
            createRow({
              id: 'row-2',
              model: 'model-b',
              source: 'shared-source',
              sourceRaw: 'tenant-b',
            }),
          ]}
          loading={false}
          externalSourceFilter="shared-source"
          externalSourceRawFilter="tenant-b"
        />
      );

      expect(markup).toContain('model-b');
      expect(markup).not.toContain('model-a');
    });

    it('钻取横幅：有外部筛选时显示钻取状态横幅', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard
          rows={[createRow()]}
          loading={false}
          externalModelFilter="model-a"
        />
      );

      expect(markup).toContain('usage_stats.drilldown_active');
      expect(markup).toContain('usage_stats.clear_filters');
    });
  });

  describe('分页功能', () => {
    it('分页信息：数据超过一页时显示分页控件', () => {
      const manyRows = Array.from({ length: 60 }, (_, i) =>
        createRow({ id: `row-${i}`, model: `model-${i}` })
      );

      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={manyRows} loading={false} />
      );

      expect(markup).toContain('auth_files.pagination_prev');
      expect(markup).toContain('auth_files.pagination_next');
    });

    it('单页隐藏：数据少于一页时不显示分页', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={[createRow()]} loading={false} />
      );

      expect(markup).not.toContain('auth_files.pagination_prev');
      expect(markup).not.toContain('auth_files.pagination_next');
    });
  });

  describe('导出功能', () => {
    it('导出按钮：有数据时显示导出按钮', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={[createRow()]} loading={false} />
      );

      expect(markup).toContain('usage_stats.export_csv');
      expect(markup).toContain('usage_stats.export_json');
    });

    it('导出禁用：无数据时禁用导出按钮', () => {
      const markup = renderToStaticMarkup(
        <RequestEventsDetailsCard rows={[]} loading={false} />
      );

      // 空状态时导出按钮被禁用（disabled 属性存在）
      expect(markup).toContain('disabled');
      // 但仍然显示导出按钮文本
      expect(markup).toContain('usage_stats.export_csv');
    });
  });
});
