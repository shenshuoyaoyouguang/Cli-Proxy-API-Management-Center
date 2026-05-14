import type { UsageDetail } from '@/atoms/usage/types';
import { collectUsageDetails } from '@/molecules/usage/collectDetails';
import { getDetailTimestampMs } from '@/atoms/usage/time';

export type UsageStatsSnapshot = Record<string, unknown>;

export const DEFAULT_USAGE_CACHE_MAX_DETAILS = 500_000;

type DetailSortKey = {
  detail: UsageDetail;
  index: number;
  timestampMs: number;
  tieBreaker: number;
};

const computeDetailSortKey = (detail: UsageDetail, index: number): DetailSortKey => {
  const rawMs = getDetailTimestampMs(detail);
  const timestampMs = Number.isFinite(rawMs) ? rawMs : Number.NEGATIVE_INFINITY;
  const tieBreaker = typeof detail.__timestampMs === 'number' && Number.isFinite(detail.__timestampMs)
    ? detail.__timestampMs
    : timestampMs;
  return { detail, index, timestampMs, tieBreaker };
};

export const trimUsageDetailsForCache = (
  usageDetails: UsageDetail[],
  maxDetails: number = DEFAULT_USAGE_CACHE_MAX_DETAILS
): UsageDetail[] => {
  if (usageDetails.length <= maxDetails) {
    return usageDetails;
  }

  return usageDetails
    .map(computeDetailSortKey)
    .sort((left, right) => {
      if (right.timestampMs !== left.timestampMs) {
        return right.timestampMs - left.timestampMs;
      }
      if (right.tieBreaker !== left.tieBreaker) {
        return right.tieBreaker - left.tieBreaker;
      }
      return right.index - left.index;
    })
    .slice(0, maxDetails)
    .sort((left, right) => left.index - right.index)
    .map(({ detail }) => detail);
};

export const resolveCachedUsageDetailsFromUsage = (
  usage: UsageStatsSnapshot | null,
  usageDetails: UsageDetail[] | undefined,
  maxDetails: number = DEFAULT_USAGE_CACHE_MAX_DETAILS
): UsageDetail[] => {
  const normalizedStoredDetails = trimUsageDetailsForCache(
    Array.isArray(usageDetails) ? usageDetails : [],
    maxDetails
  );

  if (!usage) {
    return normalizedStoredDetails;
  }

  const derivedDetails = trimUsageDetailsForCache(collectUsageDetails(usage), maxDetails);

  if (derivedDetails.length === 0) {
    return normalizedStoredDetails;
  }

  if (normalizedStoredDetails.length === 0) {
    return derivedDetails;
  }

  const derivedLatest = derivedDetails.length > 0
    ? getDetailTimestampMs(derivedDetails[derivedDetails.length - 1])
    : Number.NEGATIVE_INFINITY;
  const storedLatest = normalizedStoredDetails.length > 0
    ? getDetailTimestampMs(normalizedStoredDetails[normalizedStoredDetails.length - 1])
    : Number.NEGATIVE_INFINITY;

  if (derivedLatest >= storedLatest && derivedDetails.length >= normalizedStoredDetails.length) {
    return derivedDetails;
  }

  return normalizedStoredDetails;
};
