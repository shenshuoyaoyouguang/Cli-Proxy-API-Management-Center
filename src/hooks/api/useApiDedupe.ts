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
}

let cleanupTimerId: ReturnType<typeof setInterval> | null = null;

function getCleanupInterval(): ReturnType<typeof setInterval> | null {
  if (!cleanupTimerId) {
    cleanupTimerId = setInterval(cleanupExpiredRequests, CLEANUP_INTERVAL_MS);
  }
  return cleanupTimerId;
}

getCleanupInterval();

import type { HttpMethod } from './types';

export function generateDedupKey(url: string, method: HttpMethod, params?: unknown): string {
  const paramsKey = params ? JSON.stringify(params) : '';
  return `${method}:${url}:${paramsKey}`;
}
