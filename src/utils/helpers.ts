/**
 * 辅助工具函数
 * 从原项目 src/utils/array.js, dom.js, html.js 迁移
 */

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 对字符串进行哈希处理，生成 8 位十六进制字符串
 * 用于 scope key 隔离，确保敏感信息不直接暴露在 localStorage 键中
 */
export function hashScopeSegment(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 构建 scope key，用于缓存/持久化的域隔离
 */
export const buildScopeKey = (apiBase: string, managementKey: string): string =>
  `${apiBase}::${hashScopeSegment(managementKey)}`;
