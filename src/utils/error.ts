/**
 * 统一错误处理工具函数
 *
 * 提供项目中所有错误消息提取、请求取消判断、API 错误处理的统一实现，
 * 替代各页面/Store 中分散重复的本地定义。
 */

/**
 * 从未知类型的错误中提取可读消息字符串
 *
 * 优先级：Error.message → 对象.message → 字符串本身 → fallback
 *
 * @param error - 抛出的未知类型错误
 * @param fallback - 可选的兜底消息，默认为空字符串
 */
export function getErrorMessage(error: unknown, fallback = ''): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    if ('message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  return fallback;
}

/**
 * 判断错误是否为请求被取消（AbortController / Axios cancel token）
 *
 * 用于在 catch 块中过滤掉因组件卸载、StrictMode 双重调用或手动取消
 * 而产生的预期中断，避免向用户展示无意义的错误提示。
 */
export function isCanceledRequestError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || (error as { code?: unknown }).code === 'ERR_CANCELED')
  );
}

/**
 * 统一 API 错误处理：提取消息并（可选地）执行副作用
 *
 * 典型用法：
 * ```ts
 * try {
 *   await someApi();
 * } catch (err: unknown) {
 *   if (isCanceledRequestError(err)) return;
 *   const message = handleApiError(err, { fallback: t('common.load_error') });
 *   set({ error: message, loading: false });
 * }
 * ```
 */
export function handleApiError(
  error: unknown,
  { fallback = '' }: { fallback?: string } = {}
): string {
  return getErrorMessage(error, fallback);
}
