import type { UsageDetail } from '@/atoms/usage/types';
import { getDetailTimestampMs } from '@/atoms/usage/time';

/** 过期失败记录的默认 TTL：1 天 */
export const FAILED_DETAIL_TTL_MS = 24 * 60 * 60 * 1000;

export type ExpireFailedResult = {
  details: UsageDetail[];
  removedCount: number;
};

/**
 * 从 details 中移除超过 TTL 的失败记录。
 * 成功记录不受影响，近期失败记录也不受影响。
 */
export function expireFailedDetails(
  details: UsageDetail[],
  ttlMs: number = FAILED_DETAIL_TTL_MS
): ExpireFailedResult {
  const cutoff = Date.now() - ttlMs;
  let removedCount = 0;

  const cleaned = details.filter((detail) => {
    if (!detail.failed) return true;

    const ts = getDetailTimestampMs(detail);
    if (!Number.isFinite(ts)) return true; // 无法解析时间的失败记录保守保留

    if (ts < cutoff) {
      removedCount += 1;
      return false;
    }
    return true;
  });

  return { details: cleaned, removedCount };
}