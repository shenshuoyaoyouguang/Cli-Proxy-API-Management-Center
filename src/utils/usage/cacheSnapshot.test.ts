import { describe, expect, it } from 'vitest';
import {
  trimUsageDetailsForCache,
  resolveCachedUsageDetailsFromUsage,
} from './cacheSnapshot';
import type { UsageDetail } from '@/atoms/usage/types';
import type { UsageStatsSnapshot } from './cacheSnapshot';

const TEST_MAX_DETAILS = 5000;
const JAN_2025 = Date.parse('2025-01-01T00:00:00.000Z');

const createUsageDetail = (overrides: Partial<UsageDetail> = {}): UsageDetail => ({
  timestamp: new Date().toISOString(),
  source: 'test-source',
  auth_index: '0',
  tokens: {
    input_tokens: 100,
    output_tokens: 50,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 150,
  },
  failed: false,
  ...overrides,
});

const createDetailsWithSameTimestamp = (count: number, timestamp: string): UsageDetail[] =>
  Array.from({ length: count }, (_, index) =>
    createUsageDetail({
      timestamp,
      source: `source-${index}`,
    })
  );

const createDetailsWithIncreasingTimestamp = (
  count: number,
  startTimeMs: number
): UsageDetail[] =>
  Array.from({ length: count }, (_, index) => {
    const timeMs = startTimeMs + index * 1000;
    return createUsageDetail({
      timestamp: new Date(timeMs).toISOString(),
      source: `source-${index}`,
    });
  });

describe('trimUsageDetailsForCache', () => {
  describe('基础功能', () => {
    it('小于等于上限时返回原数组', () => {
      const details = createUsageDetail({ timestamp: new Date(JAN_2025).toISOString() });
      const result = trimUsageDetailsForCache([details], TEST_MAX_DETAILS);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(details);
    });

    it('恰好等于上限时返回原数组', () => {
      const details = Array.from({ length: TEST_MAX_DETAILS }, (_, i) =>
        createUsageDetail({ timestamp: new Date(JAN_2025 + i * 1000).toISOString() })
      );
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);
      expect(result).toHaveLength(TEST_MAX_DETAILS);
    });

    it('超过上限时保留最新的记录', () => {
      const overflow = 1000;
      const total = TEST_MAX_DETAILS + overflow;
      const details = createDetailsWithIncreasingTimestamp(total, JAN_2025);
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);

      expect(result).toHaveLength(TEST_MAX_DETAILS);
      expect(result[0].source).toBe(`source-${overflow}`);
      expect(result[result.length - 1].source).toBe(`source-${total - 1}`);
    });

    it('超过上限时丢弃最早的记录', () => {
      const overflow = 1000;
      const total = TEST_MAX_DETAILS + overflow;
      const details = createDetailsWithIncreasingTimestamp(total, JAN_2025);
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);

      const sources = result.map((d) => d.source);
      expect(sources).not.toContain('source-0');
      expect(sources).not.toContain(`source-${overflow - 1}`);
      expect(sources).toContain(`source-${overflow}`);
    });
  });

  describe('时间戳相等的边界情况', () => {
    it('相同时间戳时按数组索引降序保留（保留后加入的）', () => {
      const overflow = 500;
      const total = TEST_MAX_DETAILS + overflow;
      const sameTimestamp = new Date(JAN_2025).toISOString();
      const details = createDetailsWithSameTimestamp(total, sameTimestamp);
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);

      expect(result).toHaveLength(TEST_MAX_DETAILS);
      expect(result[0].source).toBe(`source-${overflow}`);
      expect(result[result.length - 1].source).toBe(`source-${total - 1}`);
    });

    it('部分相同时间戳时正确混合处理', () => {
      const half = Math.floor(TEST_MAX_DETAILS / 2);
      const baseDetails = createDetailsWithIncreasingTimestamp(half, JAN_2025);
      const sameTimeDetails = createDetailsWithSameTimestamp(half, new Date(JAN_2025 + 86400000).toISOString());
      const allDetails = [...baseDetails, ...sameTimeDetails];

      const result = trimUsageDetailsForCache(allDetails, TEST_MAX_DETAILS);

      expect(result).toHaveLength(TEST_MAX_DETAILS);
      const timestamps = result.map((d) => d.timestamp);
      const uniqueTimestamps = [...new Set(timestamps)];
      expect(uniqueTimestamps.length).toBeGreaterThan(1);
    });

    it('大量相同时间戳边界情况：exactly MAX_DETAILS + 1', () => {
      const sameTimestamp = new Date(JAN_2025).toISOString();
      const details = createDetailsWithSameTimestamp(TEST_MAX_DETAILS + 1, sameTimestamp);
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);

      expect(result).toHaveLength(TEST_MAX_DETAILS);
      expect(result[0].source).toBe(`source-1`);
    });
  });

  describe('顺序稳定性', () => {
    it('返回结果按时间戳升序排列', () => {
      const details = createDetailsWithIncreasingTimestamp(TEST_MAX_DETAILS + 500, JAN_2025);
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);

      const isAscending = result.every((d, i) => {
        if (i === 0) return true;
        const prevTime = new Date(result[i - 1].timestamp).getTime();
        const currTime = new Date(d.timestamp).getTime();
        return currTime >= prevTime;
      });
      expect(isAscending).toBe(true);
    });

    it('多次调用结果一致（幂等性）', () => {
      const details = createDetailsWithIncreasingTimestamp(TEST_MAX_DETAILS + 1000, JAN_2025);

      const result1 = trimUsageDetailsForCache([...details], TEST_MAX_DETAILS);
      const result2 = trimUsageDetailsForCache([...details], TEST_MAX_DETAILS);
      const result3 = trimUsageDetailsForCache([...details], TEST_MAX_DETAILS);

      expect(result1.map((d) => d.source)).toEqual(result2.map((d) => d.source));
      expect(result2.map((d) => d.source)).toEqual(result3.map((d) => d.source));
    });
  });
});

describe('resolveCachedUsageDetailsFromUsage', () => {
  describe('基础功能', () => {
    it('无 usage 时返回 trimmed stored details', () => {
      const details = Array.from({ length: TEST_MAX_DETAILS + 500 }, (_, i) =>
        createUsageDetail({ source: `source-${i}`, timestamp: new Date(JAN_2025 + i * 1000).toISOString() })
      );
      const result = resolveCachedUsageDetailsFromUsage(null, details, TEST_MAX_DETAILS);

      expect(result).toHaveLength(TEST_MAX_DETAILS);
    });

    it('有 usage 但无 stored details 时从 usage 派生', () => {
      const usage: UsageStatsSnapshot = {
        apis: {
          '/v1/chat/completions': {
            models: {
              'gpt-4': {
                details: Array.from({ length: 100 }, (_, i) => ({
                  timestamp: new Date(JAN_2025 + i * 1000).toISOString(),
                  tokens: { total_tokens: 100 },
                })),
              },
            },
          },
        },
      };

      const result = resolveCachedUsageDetailsFromUsage(usage, undefined, TEST_MAX_DETAILS);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('优先级逻辑', () => {
    it('stored details 比 derived 更优先当 stored 更多时', () => {
      const storedDetails = Array.from({ length: 100 }, (_, i) =>
        createUsageDetail({ source: `stored-${i}`, timestamp: new Date(JAN_2025).toISOString() })
      );
      const usage: UsageStatsSnapshot = {
        apis: {
          '/v1/chat/completions': {
            models: {
              'gpt-4': {
                details: Array.from({ length: 50 }, (_) => ({
                  timestamp: new Date(JAN_2025 + 86400000).toISOString(),
                  tokens: { total_tokens: 100 },
                })),
              },
            },
          },
        },
      };

      const result = resolveCachedUsageDetailsFromUsage(usage, storedDetails, TEST_MAX_DETAILS);
      expect(result.length).toBe(100);
      expect(result[0].source).toBe('stored-0');
    });

    it('derived details 比 stored 更优先当 derived 更多时', () => {
      const storedDetails = Array.from({ length: 50 }, (_, i) =>
        createUsageDetail({ source: `stored-${i}`, timestamp: new Date(JAN_2025).toISOString() })
      );
      const usage: UsageStatsSnapshot = {
        apis: {
          '/v1/chat/completions': {
            models: {
              'gpt-4': {
                details: Array.from({ length: 100 }, (_) => ({
                  timestamp: new Date(JAN_2025 + 86400000).toISOString(),
                  tokens: { total_tokens: 100 },
                })),
              },
            },
          },
        },
      };

      const result = resolveCachedUsageDetailsFromUsage(usage, storedDetails, TEST_MAX_DETAILS);
      expect(result.length).toBe(100);
    });
  });

  describe('并发场景模拟', () => {
    it('场景1：逐步累积请求后截断（模拟 applyDelta 增量更新）', () => {
      const maxDetails = TEST_MAX_DETAILS;
      const usage: UsageStatsSnapshot = {
        apis: {
          '/v1/chat/completions': {
            models: {
              'gpt-4': {
                details: Array.from({ length: 100 }, (_, i) => ({
                  timestamp: new Date(JAN_2025 + i * 1000).toISOString(),
                  tokens: { total_tokens: 100 },
                })),
              },
            },
          },
        },
      };

      let currentDetails: UsageDetail[] = [];

      for (let i = 0; i < 6; i++) {
        const batch = Array.from({ length: 1000 }, (_, j) =>
          createUsageDetail({
            timestamp: new Date(JAN_2025 + i * 1000 * 1000 + j * 1000).toISOString(),
            source: `source-${i * 1000 + j}`,
          })
        );
        currentDetails = [...currentDetails, ...batch];
        currentDetails = resolveCachedUsageDetailsFromUsage(usage, currentDetails, maxDetails);
      }

      expect(currentDetails).toHaveLength(maxDetails);
      const sources = currentDetails.map((d) => d.source);
      expect(sources).toContain('source-1000');
      expect(sources).not.toContain('source-0');
    });

    it('场景2：快速连续到达的相同时间戳请求', () => {
      const maxDetails = TEST_MAX_DETAILS;
      const sameTimestamp = new Date(JAN_2025).toISOString();
      const details = Array.from({ length: maxDetails + 500 }, (_, i) =>
        createUsageDetail({
          timestamp: sameTimestamp,
          source: `source-${i}`,
        })
      );

      const result = trimUsageDetailsForCache(details, maxDetails);
      expect(result).toHaveLength(maxDetails);
      expect(result[0].source).toBe('source-500');
    });

    it('场景3：时间递增但有重叠的批次', () => {
      const maxDetails = TEST_MAX_DETAILS;
      const batch1 = Array.from({ length: 3000 }, (_, i) =>
        createUsageDetail({
          timestamp: new Date(JAN_2025 + i * 1000).toISOString(),
          source: `batch1-${i}`,
        })
      );
      const batch2 = Array.from({ length: 3000 }, (_, i) =>
        createUsageDetail({
          timestamp: new Date(JAN_2025 + 2000 * 1000 + i * 1000).toISOString(),
          source: `batch2-${i}`,
        })
      );

      const allDetails = [...batch1, ...batch2];
      const result = trimUsageDetailsForCache(allDetails, maxDetails);

      expect(result).toHaveLength(maxDetails);
      const sources = result.map((d) => d.source);
      expect(sources).toContain('batch2-0');
      expect(sources).toContain('batch2-2999');
    });

    it('模拟 applyDelta 逻辑：detailCount 使用原始长度', () => {
      const maxDetails = TEST_MAX_DETAILS;
      const batch1 = Array.from({ length: 3000 }, (_, i) =>
        createUsageDetail({
          timestamp: new Date(JAN_2025 + i * 1000).toISOString(),
          source: `batch1-${i}`,
        })
      );

      const batch2 = Array.from({ length: 3000 }, (_, i) =>
        createUsageDetail({
          timestamp: new Date(JAN_2025 + 3000 * 1000 + i * 1000).toISOString(),
          source: `batch2-${i}`,
        })
      );

      const mergedDetails = [...batch1, ...batch2];
      const trimmedDetails = trimUsageDetailsForCache(mergedDetails, maxDetails);
      const detailCount = mergedDetails.length;

      expect(detailCount).toBe(6000);
      expect(trimmedDetails).toHaveLength(maxDetails);
    });

    it('模拟并发写入：两个系统各自 trim 后比较', () => {
      const maxDetails = TEST_MAX_DETAILS;
      const details = Array.from({ length: maxDetails + 1000 }, (_, i) =>
        createUsageDetail({
          timestamp: new Date(JAN_2025 + i * 1000).toISOString(),
          source: `source-${i}`,
        })
      );

      const result1 = trimUsageDetailsForCache(details, maxDetails);
      const result2 = trimUsageDetailsForCache(details, maxDetails);

      expect(result1.map((d) => d.source)).toEqual(result2.map((d) => d.source));
    });
  });

  describe('边界值测试', () => {
    it('空数组', () => {
      const result = trimUsageDetailsForCache([], TEST_MAX_DETAILS);
      expect(result).toHaveLength(0);
    });

    it('undefined 作为输入', () => {
      const result = resolveCachedUsageDetailsFromUsage(null, undefined, TEST_MAX_DETAILS);
      expect(result).toHaveLength(0);
    });

    it('边界值：MAX_DETAILS - 1', () => {
      const details = createDetailsWithIncreasingTimestamp(TEST_MAX_DETAILS - 1, JAN_2025);
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);
      expect(result).toHaveLength(TEST_MAX_DETAILS - 1);
    });

    it('边界值：MAX_DETAILS + 1', () => {
      const details = createDetailsWithIncreasingTimestamp(TEST_MAX_DETAILS + 1, JAN_2025);
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);
      expect(result).toHaveLength(TEST_MAX_DETAILS);
    });

    it('边界值：2 * MAX_DETAILS', () => {
      const details = createDetailsWithIncreasingTimestamp(2 * TEST_MAX_DETAILS, JAN_2025);
      const result = trimUsageDetailsForCache(details, TEST_MAX_DETAILS);
      expect(result).toHaveLength(TEST_MAX_DETAILS);
    });

    it('自定义 maxDetails', () => {
      const details = createDetailsWithIncreasingTimestamp(100, JAN_2025);
      const result = trimUsageDetailsForCache(details, 50);
      expect(result).toHaveLength(50);
    });
  });

  describe('时间戳处理', () => {
    it('无效时间戳被标记为最旧', () => {
      const validDetails = Array.from({ length: 100 }, (_, i) =>
        createUsageDetail({
          timestamp: new Date(JAN_2025 + i * 1000).toISOString(),
          source: `valid-${i}`,
        })
      );
      const invalidDetails = Array.from({ length: 100 }, (_, i) =>
        createUsageDetail({
          timestamp: 'invalid-timestamp',
          source: `invalid-${i}`,
        })
      );

      const allDetails = [...validDetails, ...invalidDetails];
      const result = trimUsageDetailsForCache(allDetails, 100);

      expect(result).toHaveLength(100);
      const sources = result.map((d) => d.source);
      expect(sources.every((s) => s.startsWith('valid-'))).toBe(true);
    });

    it('不同时间戳范围：正确保留较新的数据', () => {
      const oldDetails = Array.from({ length: 100 }, (_, i) =>
        createUsageDetail({
          timestamp: new Date(JAN_2025 + i * 1000).toISOString(),
          source: `old-${i}`,
        })
      );
      const newDetails = Array.from({ length: 100 }, (_, i) =>
        createUsageDetail({
          timestamp: new Date(JAN_2025 + 86400000 + i * 1000).toISOString(),
          source: `new-${i}`,
        })
      );

      const allDetails = [...oldDetails, ...newDetails];
      const result = trimUsageDetailsForCache(allDetails, 100);

      expect(result).toHaveLength(100);
      const sources = result.map((d) => d.source);
      expect(sources.every((s) => s.startsWith('new-'))).toBe(true);
    });
  });
});
