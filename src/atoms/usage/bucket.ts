import type { StatusBlockState, StatusBlockDetail, StatusBarData } from './types';
import { getDetailTimestampMs } from './time';

export interface BucketConfig {
  bucketCount: number;
  bucketDurationMs: number;
  windowMs: number;
}

export function createBucketConfig(
  bucketCount: number,
  bucketDurationMinutes: number
): BucketConfig {
  const bucketDurationMs = bucketDurationMinutes * 60 * 1000;
  return {
    bucketCount,
    bucketDurationMs,
    windowMs: bucketCount * bucketDurationMs,
  };
}

export interface BucketableDetail {
  timestamp: string;
  __timestampMs?: number;
  failed?: boolean;
}

export function bucketDetails<T extends BucketableDetail>(
  details: T[],
  config: BucketConfig,
  nowMs: number
): {
  blocks: StatusBlockState[];
  blockDetails: StatusBlockDetail[];
  successRate: number;
  totalSuccess: number;
  totalFailure: number;
} {
  const { bucketCount, bucketDurationMs, windowMs } = config;
  const windowStart = nowMs - windowMs;

  const blockStats: Array<{ success: number; failure: number }> = Array.from(
    { length: bucketCount },
    () => ({ success: 0, failure: 0 })
  );

  let totalSuccess = 0;
  let totalFailure = 0;

  details.forEach((detail) => {
    const timestamp = getDetailTimestampMs(detail);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > nowMs) {
      return;
    }

    const ageMs = nowMs - timestamp;
    const blockIndex = bucketCount - 1 - Math.floor(ageMs / bucketDurationMs);

    if (blockIndex >= 0 && blockIndex < bucketCount) {
      if (detail.failed) {
        blockStats[blockIndex].failure += 1;
        totalFailure += 1;
      } else {
        blockStats[blockIndex].success += 1;
        totalSuccess += 1;
      }
    }
  });

  const blocks: StatusBlockState[] = [];
  const blockDetails: StatusBlockDetail[] = [];

  blockStats.forEach((stat, idx) => {
    const total = stat.success + stat.failure;
    if (total === 0) {
      blocks.push('idle');
    } else if (stat.failure === 0) {
      blocks.push('success');
    } else if (stat.success === 0) {
      blocks.push('failure');
    } else {
      blocks.push('mixed');
    }

    const blockStartTime = windowStart + idx * bucketDurationMs;
    blockDetails.push({
      success: stat.success,
      failure: stat.failure,
      rate: total > 0 ? stat.success / total : -1,
      startTime: blockStartTime,
      endTime: blockStartTime + bucketDurationMs,
    });
  });

  const total = totalSuccess + totalFailure;
  const successRate = total > 0 ? (totalSuccess / total) * 100 : 100;

  return {
    blocks,
    blockDetails,
    successRate,
    totalSuccess,
    totalFailure,
  };
}

export function calculateStatusBarData(
  usageDetails: Array<{ timestamp: string; __timestampMs?: number; failed?: boolean }>,
  nowMs: number = Date.now()
): StatusBarData {
  const BLOCK_COUNT = 20;
  const BLOCK_DURATION_MINUTES = 10;
  const config = createBucketConfig(BLOCK_COUNT, BLOCK_DURATION_MINUTES);

  const result = bucketDetails(usageDetails, config, nowMs);

  return {
    ...result,
  };
}

export function calculateServiceHealthData(
  usageDetails: Array<{ timestamp: string; __timestampMs?: number; failed?: boolean }>,
  nowMs: number = Date.now()
): {
  blocks: StatusBlockState[];
  blockDetails: StatusBlockDetail[];
  successRate: number;
  totalSuccess: number;
  totalFailure: number;
  rows: number;
  cols: number;
} {
  const ROWS = 7;
  const COLS = 96;
  const BLOCK_COUNT = ROWS * COLS;
  const BLOCK_DURATION_MINUTES = 15;
  const config = createBucketConfig(BLOCK_COUNT, BLOCK_DURATION_MINUTES);

  const result = bucketDetails(usageDetails, config, nowMs);

  return {
    ...result,
    rows: ROWS,
    cols: COLS,
  };
}
