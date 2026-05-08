import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageDetail } from '@/utils/usage';
import { buildHealthAssessment, buildReliabilitySnapshot, collectWindowAvailability } from './index';

const baseNow = Date.parse('2025-01-01T12:00:00.000Z');

const createDetail = ({
  minutesAgo,
  modelName,
  failed
}: {
  minutesAgo: number;
  modelName: string;
  failed: boolean;
}): UsageDetail => {
  const timestampMs = baseNow - minutesAgo * 60 * 1000;
  return {
    timestamp: new Date(timestampMs).toISOString(),
    source: 'test',
    auth_index: '0',
    failed,
    tokens: {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      total_tokens: 0
    },
    __modelName: modelName,
    __timestampMs: timestampMs
  };
};

describe('buildReliabilitySnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups recent usage into minute/model buckets and excludes stale records', () => {
    const snapshot = buildReliabilitySnapshot(
      [
        createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
        createDetail({ minutesAgo: 1, modelName: 'model-a', failed: true }),
        createDetail({ minutesAgo: 1, modelName: 'model-b', failed: false }),
        createDetail({ minutesAgo: 99999, modelName: 'model-c', failed: false })
      ],
      baseNow
    );

    expect(snapshot.totals.total).toBe(3);
    expect(snapshot.minuteByModel.size).toBe(1);
    const minuteBucket = Array.from(snapshot.minuteByModel.values())[0];
    expect(minuteBucket.get('model-a')?.total).toBe(2);
    expect(minuteBucket.get('model-b')?.success).toBe(1);
    expect(snapshot.serviceHealth.totalSuccess).toBe(2);
    expect(snapshot.serviceHealth.totalFailure).toBe(1);
  });

  it('weights degraded availability by request volume', () => {
    const snapshot = buildReliabilitySnapshot(
      [
        createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
        createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
        createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
        createDetail({ minutesAgo: 1, modelName: 'model-b', failed: false }),
        createDetail({ minutesAgo: 1, modelName: 'model-b', failed: true })
      ],
      baseNow
    );

    const availability = collectWindowAvailability(snapshot, 24 * 60 * 60 * 1000);

    expect(availability.totalWeight).toBe(5);
    expect(availability.degradedWeight).toBe(2);
    expect(availability.availability).toBeCloseTo(0.6, 5);
  });

  it('keeps slightly future-dated records but excludes timestamps beyond the tolerance window', () => {
    const snapshot = buildReliabilitySnapshot(
      [
        {
          ...createDetail({ minutesAgo: 1, modelName: 'model-a', failed: false }),
          timestamp: new Date(baseNow + 2 * 60 * 1000).toISOString(),
          __timestampMs: baseNow + 2 * 60 * 1000,
        },
        {
          ...createDetail({ minutesAgo: 1, modelName: 'model-b', failed: true }),
          timestamp: new Date(baseNow + 5 * 60 * 1000).toISOString(),
          __timestampMs: baseNow + 5 * 60 * 1000,
        },
        {
          ...createDetail({ minutesAgo: 1, modelName: 'model-c', failed: false }),
          timestamp: new Date(baseNow + 5 * 60 * 1000 + 1).toISOString(),
          __timestampMs: baseNow + 5 * 60 * 1000 + 1,
        },
      ],
      baseNow
    );

    expect(snapshot.totals.total).toBe(2);
    expect(snapshot.totals.success).toBe(1);
    expect(snapshot.totals.failure).toBe(1);
    expect(snapshot.details.every((detail) => detail.timestampMs <= snapshot.generatedAtMs)).toBe(true);
    expect(snapshot.serviceHealth.totalSuccess).toBe(1);
    expect(snapshot.serviceHealth.totalFailure).toBe(1);

    const availability = collectWindowAvailability(snapshot, 24 * 60 * 60 * 1000);
    expect(availability.totalWeight).toBe(2);
    expect(availability.degradedWeight).toBe(1);

    const assessment = buildHealthAssessment(snapshot);
    expect(assessment.metrics.successRate.sampleCount).toBe(2);
    expect(assessment.hasData).toBe(true);
  });
});
