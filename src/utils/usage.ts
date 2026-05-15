/**
 * 使用统计相关工具 —— 兼容层
 * 所有实现已迁移至 atoms/usage/、molecules/usage/ 和 utils/usage/ 子模块
 * 此文件保留以维持向后兼容，新代码请直接引用原子层/分子层模块
 */

// === 类型重导出 ===
export type {
  KeyStatBucket,
  KeyStats,
  TokenBreakdown,
  RateStats,
  ModelPrice,
  UsageDetail,
  UsageDetailWithEndpoint,
  ApiStats,
  UsageTimeRange,
  UsageSummary,
  StatusBlockState,
  StatusBlockDetail,
  StatusBarData,
  ServiceHealthData,
} from '@/atoms/usage/types';

// === 守卫与工具重导出 ===
export { isRecord, getApisRecord, parseAuthIndex, normalizeAuthIndex } from '@/atoms/usage/guards';

// === 时间相关重导出 ===
export {
  FUTURE_TIMESTAMP_TOLERANCE_MS,
  USAGE_TIME_RANGE_MS,
  formatHourLabel,
  formatDayLabel,
  getDetailTimestampMs,
  resolveHourWindow,
} from '@/atoms/usage/time';

// === Token 相关重导出 ===
export {
  hasUsageTokenEvidence,
  normalizeUsageTokens,
  normalizeUsageDetailTokens,
  extractCanonicalTotalTokens,
  getCanonicalCachedTokens,
  toNormalizedTokens,
  getCachedTokenCount,
  getTotalTokenCount,
  getUsageDetailTotalTokenCount,
} from '@/atoms/usage/tokens';

// === Source 相关重导出 ===
export {
  normalizeUsageSourceId,
  buildCandidateUsageSourceIds,
  maskUsageSensitiveValue,
} from '@/atoms/usage/source';

// === 分桶相关重导出 ===
export {
  createBucketConfig,
  bucketDetails,
  calculateStatusBarData,
  calculateServiceHealthData,
} from '@/atoms/usage/bucket';

// === 成本相关重导出 ===
export {
  calculateCost,
  calculateTotalCost,
  createKahanAccumulator,
  kahanAdd,
  type KahanAccumulator,
} from '@/atoms/usage/cost';

// === 分子层重导出 ===
export {
  collectUsageDetails,
  collectUsageDetailsFromEvents,
  collectUsageDetailsWithEndpoint,
} from '@/molecules/usage/collectDetails';

export {
  filterUsageByTimeRange,
  filterUsageDetailsByTimeRange,
} from '@/molecules/usage/filterTimeRange';

export {
  createAggregateOnlyUsageSnapshot,
  createAggregateUsageSnapshotFromDetails,
  computeKeyStats,
  computeKeyStatsFromDetails,
  mergeKeyStatsIncremental,
  subtractKeyStatsForDetails,
  getApiStats,
  getModelStats,
  rehydrateUsageAggregatesFromDetails,
} from '@/molecules/usage/aggregate';

// === 格式化重导出 ===
export { formatPerMinuteValue, formatCompactNumber, formatUsd } from './usage/formatting';

// === 模型价格存储重导出 ===
export { loadModelPrices, saveModelPrices } from './usage/modelPrices';

// === 速率与 Token 计算重导出 ===
export {
  extractTotalTokens,
  calculateTokenBreakdown,
  calculateRecentPerMinuteRates,
  getModelNamesFromUsage,
} from './usage/rates';

// === 模型名称规范化重导出 ===
export { normalizeUsageModelNames, resolveModelNameInDetails } from './usage/normalize';
