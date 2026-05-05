import type { UsageDetail } from '@/atoms/usage/types';
import { collectUsageDetails } from '@/molecules/usage/collectDetails';
import { getDetailTimestampMs } from '@/atoms/usage/time';

export type UsageStatsSnapshot = Record<string, unknown>;

export const DEFAULT_USAGE_CACHE_MAX_DETAILS = 5_000;

export const trimUsageDetailsForCache = (
  usageDetails: UsageDetail[],
  maxDetails: number = DEFAULT_USAGE_CACHE_MAX_DETAILS
): UsageDetail[] => {
  if (usageDetails.length <= maxDetails) {
    return usageDetails;
  }

  return usageDetails
    .map((detail, index) => ({
      detail,
      index,
      timestampMs: Number.isFinite(getDetailTimestampMs(detail))
        ? getDetailTimestampMs(detail)
        : Number.NEGATIVE_INFINITY,
    }))
    .sort((left, right) => {
      if (right.timestampMs !== left.timestampMs) {
        return right.timestampMs - left.timestampMs;
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
  if (
    derivedDetails.length > 0 &&
    (normalizedStoredDetails.length === 0 || derivedDetails.length >= normalizedStoredDetails.length)
  ) {
    return derivedDetails;
  }

  return normalizedStoredDetails.length > 0 ? normalizedStoredDetails : derivedDetails;
};
