export interface PendingRequest {
  promise: Promise<unknown>;
  abortController: AbortController;
  timestamp: number;
}

export const pendingRequests = new Map<string, PendingRequest>();

const REQUEST_EXPIRY_MS = 30000;
const CLEANUP_INTERVAL_MS = 10000;

function cleanupExpiredRequests(): void {
  const now = Date.now();
  for (const [key, request] of pendingRequests) {
    if (now - request.timestamp > REQUEST_EXPIRY_MS) {
      request.abortController.abort();
      pendingRequests.delete(key);
    }
  }
  scheduleCleanup();
}

let cleanupTimerId: ReturnType<typeof setInterval> | null = null;

function startCleanupTimer(): void {
  if (!cleanupTimerId) {
    cleanupTimerId = setInterval(cleanupExpiredRequests, CLEANUP_INTERVAL_MS);
  }
}

function stopCleanupTimer(): void {
  if (cleanupTimerId && pendingRequests.size === 0) {
    clearInterval(cleanupTimerId);
    cleanupTimerId = null;
  }
}

function scheduleCleanup(): void {
  if (pendingRequests.size > 0) {
    startCleanupTimer();
  } else {
    stopCleanupTimer();
  }
}

import type { HttpMethod } from './types';

export function generateDedupKey(url: string, method: HttpMethod, params?: unknown): string {
  const paramsKey = params ? JSON.stringify(params) : '';
  return `${method}:${url}:${paramsKey}`;
}

export { scheduleCleanup };
