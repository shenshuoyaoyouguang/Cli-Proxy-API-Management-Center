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
  it('shows an error state instead of the empty state when loading fails and there are no rows', () => {
    const markup = renderToStaticMarkup(
      <RequestEventsDetailsCard rows={[]} loading={false} error="boom" />
    );

    expect(markup).toContain('usage_stats.loading_error');
    expect(markup).toContain('boom');
    expect(markup).not.toContain('usage_stats.request_events_empty_title');
  });

  it('applies external drilldown filters immediately even when the value is absent from the local option list', () => {
    const markup = renderToStaticMarkup(
      <RequestEventsDetailsCard
        rows={[createRow()]}
        loading={false}
        externalModelFilter="model-b"
      />
    );

    expect(markup).toContain('usage_stats.request_events_no_result_title');
    expect(markup).not.toContain('model-a');
  });
});
