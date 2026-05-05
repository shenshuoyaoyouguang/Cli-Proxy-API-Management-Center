import type { UsageDetail } from '@/utils/usage';
import { reliabilityConfig } from './config';
import type {
  ReliabilityCounts,
  ReliabilityDetail,
  ReliabilitySnapshot,
  ServiceHealthData,
  StatusBlockDetail,
  StatusBlockState
} from './types';
import { parseTimestampMs } from '@/utils/timestamp';

const EMPTY_COUNTS: ReliabilityCounts = { success: 0, failure: 0, total: 0 };

const createEmptyCounts = (): ReliabilityCounts => ({ ...EMPTY_COUNTS });

const appendOutcome = (counts: ReliabilityCounts | undefined, failed: boolean): ReliabilityCounts => {
  const previous = counts ?? EMPTY_COUNTS;
  const success = previous.success + (failed ? 0 : 1);
  const failure = previous.failure + (failed ? 1 : 0);
  return {
    success,
    failure,
    total: success + failure
  };
};

const normalizeTimestampMs = (detail: UsageDetail): number => {
  if (typeof detail.__timestampMs === 'number' && Number.isFinite(detail.__timestampMs)) {
    return detail.__timestampMs;
  }
  return parseTimestampMs(detail.timestamp);
};

const normalizeModelName = (detail: UsageDetail): string => {
  const candidate = typeof detail.__modelName === 'string' ? detail.__modelName.trim() : '';
  return candidate || 'unknown';
};

const toReliabilityDetail = (detail: UsageDetail, timestampMs: number): ReliabilityDetail => ({
  timestamp: detail.timestamp,
  source: detail.source,
  auth_index: detail.auth_index,
  failed: detail.failed === true,
  tokens: detail.tokens,
  timestampMs,
  modelName: normalizeModelName(detail),
  minuteKey: Math.floor(timestampMs / reliabilityConfig.minuteMs),
  hourKey: Math.floor(timestampMs / reliabilityConfig.hourMs),
  dayKey: Math.floor(timestampMs / reliabilityConfig.dayMs)
});

const buildRollingBlockHealthData = (
  details: ReliabilityDetail[],
  nowMs: number,
  {
    rows,
    cols,
    blockDurationMs,
    windowMs
  }: {
    rows: number;
    cols: number;
    blockDurationMs: number;
    windowMs: number;
  }
): ServiceHealthData => {
  const blockCount = rows * cols;
  const windowStart = nowMs - windowMs;
  const blockStats = Array.from({ length: blockCount }, () => createEmptyCounts());

  details.forEach((detail) => {
    if (detail.timestampMs < windowStart || detail.timestampMs > nowMs) {
      return;
    }

    const ageMs = nowMs - detail.timestampMs;
    const blockIndex = blockCount - 1 - Math.floor(ageMs / blockDurationMs);
    if (blockIndex < 0 || blockIndex >= blockCount) {
      return;
    }

    blockStats[blockIndex] = appendOutcome(blockStats[blockIndex], detail.failed);
  });

  const blocks: StatusBlockState[] = [];
  const blockDetails: StatusBlockDetail[] = [];

  blockStats.forEach((counts, index) => {
    if (counts.total === 0) {
      blocks.push('idle');
    } else if (counts.failure === 0) {
      blocks.push('success');
    } else if (counts.success === 0) {
      blocks.push('failure');
    } else {
      blocks.push('mixed');
    }

    const startTime = windowStart + index * blockDurationMs;
    blockDetails.push({
      success: counts.success,
      failure: counts.failure,
      rate: counts.total > 0 ? counts.success / counts.total : -1,
      startTime,
      endTime: startTime + blockDurationMs
    });
  });

  const totals = blockStats.reduce(
    (accumulator, counts) => ({
      success: accumulator.success + counts.success,
      failure: accumulator.failure + counts.failure,
      total: accumulator.total + counts.total
    }),
    createEmptyCounts()
  );

  return {
    blocks,
    blockDetails,
    successRate: totals.total > 0 ? (totals.success / totals.total) * 100 : 100,
    totalSuccess: totals.success,
    totalFailure: totals.failure,
    rows,
    cols
  };
};

export const createReliabilityCounts = (success = 0, failure = 0): ReliabilityCounts => ({
  success,
  failure,
  total: success + failure
});

export const getDetailTimestampMs = normalizeTimestampMs;

export function collectWindowCounts(snapshot: ReliabilitySnapshot, windowMs: number): ReliabilityCounts {
  const windowStart = snapshot.generatedAtMs - windowMs;

  return snapshot.details.reduce((accumulator, detail) => {
    if (detail.timestampMs < windowStart || detail.timestampMs > snapshot.generatedAtMs) {
      return accumulator;
    }

    return detail.failed
      ? createReliabilityCounts(accumulator.success, accumulator.failure + 1)
      : createReliabilityCounts(accumulator.success + 1, accumulator.failure);
  }, createEmptyCounts());
}

export function collectWindowAvailability(snapshot: ReliabilitySnapshot, windowMs: number): {
  availability: number | null;
  totalWeight: number;
  degradedWeight: number;
} {
  const minuteStartKey = Math.floor((snapshot.generatedAtMs - windowMs) / reliabilityConfig.minuteMs);
  const minuteEndKey = Math.floor(snapshot.generatedAtMs / reliabilityConfig.minuteMs);

  let totalWeight = 0;
  let degradedWeight = 0;

  snapshot.minuteByModel.forEach((modelBuckets, minuteKey) => {
    if (minuteKey < minuteStartKey || minuteKey > minuteEndKey) {
      return;
    }

    modelBuckets.forEach((counts) => {
      totalWeight += counts.total;
      const successRate = counts.total > 0 ? counts.success / counts.total : 1;
      if (successRate <= reliabilityConfig.thresholds.degradedSuccessRate) {
        degradedWeight += counts.total;
      }
    });
  });

  return {
    availability: totalWeight > 0 ? 1 - degradedWeight / totalWeight : null,
    totalWeight,
    degradedWeight
  };
}

export function collectWindowHourlyRates(snapshot: ReliabilitySnapshot, windowMs: number): number[] {
  const hourStartKey = Math.floor((snapshot.generatedAtMs - windowMs) / reliabilityConfig.hourMs);
  const hourEndKey = Math.floor(snapshot.generatedAtMs / reliabilityConfig.hourMs);
  const hourlyRates: number[] = [];

  snapshot.hourBuckets.forEach((counts, hourKey) => {
    if (hourKey < hourStartKey || hourKey > hourEndKey || counts.total === 0) {
      return;
    }

    hourlyRates.push(counts.success / counts.total);
  });

  return hourlyRates;
}

export function collectDailyAvailability(snapshot: ReliabilitySnapshot, dayCount: number): Map<number, number> {
  const earliestDayKey = Math.floor((snapshot.generatedAtMs - dayCount * reliabilityConfig.dayMs) / reliabilityConfig.dayMs);
  const availabilityByDay = new Map<number, { totalWeight: number; degradedWeight: number }>();

  snapshot.minuteByModel.forEach((modelBuckets, minuteKey) => {
    const dayKey = Math.floor((minuteKey * reliabilityConfig.minuteMs) / reliabilityConfig.dayMs);
    if (dayKey < earliestDayKey) {
      return;
    }

    const current = availabilityByDay.get(dayKey) ?? { totalWeight: 0, degradedWeight: 0 };
    const next = Array.from(modelBuckets.values()).reduce(
      (accumulator, counts) => {
        const successRate = counts.total > 0 ? counts.success / counts.total : 1;
        return {
          totalWeight: accumulator.totalWeight + counts.total,
          degradedWeight:
            accumulator.degradedWeight +
            (successRate <= reliabilityConfig.thresholds.degradedSuccessRate ? counts.total : 0)
        };
      },
      current
    );

    availabilityByDay.set(dayKey, next);
  });

  return new Map(
    Array.from(availabilityByDay.entries()).map(([dayKey, weights]) => [
      dayKey,
      weights.totalWeight > 0 ? 1 - weights.degradedWeight / weights.totalWeight : 0
    ])
  );
}

export function buildServiceHealthData(
  details: ReliabilityDetail[],
  nowMs: number = Date.now()
): ServiceHealthData {
  return buildRollingBlockHealthData(details, nowMs, {
    rows: reliabilityConfig.serviceHealthRows,
    cols: reliabilityConfig.serviceHealthCols,
    blockDurationMs: reliabilityConfig.serviceHealthBucketMs,
    windowMs: reliabilityConfig.serviceHealthWindowMs
  });
}

export function buildReliabilitySnapshot(
  usageDetails: UsageDetail[],
  nowMs: number = Date.now()
): ReliabilitySnapshot {
  const safeNowMs = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now();
  const maxLookbackMs = Math.max(
    reliabilityConfig.slaWindowMs,
    reliabilityConfig.trendWindowMs * 2,
    reliabilityConfig.streakWindowDays * reliabilityConfig.dayMs,
    reliabilityConfig.serviceHealthWindowMs
  );
  const windowStart = safeNowMs - maxLookbackMs;

  const minuteByModel = new Map<number, Map<string, ReliabilityCounts>>();
  const hourBuckets = new Map<number, ReliabilityCounts>();
  const dayBuckets = new Map<number, ReliabilityCounts>();

  const details = usageDetails
    .map((detail) => {
      const timestampMs = normalizeTimestampMs(detail);
      if (!Number.isFinite(timestampMs) || timestampMs < windowStart || timestampMs > safeNowMs) {
        return null;
      }

      return toReliabilityDetail(detail, timestampMs);
    })
    .filter((detail): detail is ReliabilityDetail => detail !== null)
    .sort((left, right) => left.timestampMs - right.timestampMs);

  details.forEach((detail) => {
    const existingMinuteBuckets = minuteByModel.get(detail.minuteKey) ?? new Map<string, ReliabilityCounts>();
    const nextMinuteBuckets = new Map(existingMinuteBuckets);
    nextMinuteBuckets.set(detail.modelName, appendOutcome(existingMinuteBuckets.get(detail.modelName), detail.failed));
    minuteByModel.set(detail.minuteKey, nextMinuteBuckets);

    hourBuckets.set(detail.hourKey, appendOutcome(hourBuckets.get(detail.hourKey), detail.failed));
    dayBuckets.set(detail.dayKey, appendOutcome(dayBuckets.get(detail.dayKey), detail.failed));
  });

  const totals = details.reduce(
    (accumulator, detail) =>
      detail.failed
        ? createReliabilityCounts(accumulator.success, accumulator.failure + 1)
        : createReliabilityCounts(accumulator.success + 1, accumulator.failure),
    createEmptyCounts()
  );

  return {
    generatedAtMs: safeNowMs,
    details,
    totals,
    minuteByModel,
    hourBuckets,
    dayBuckets,
    serviceHealth: buildServiceHealthData(details, safeNowMs)
  };
}
