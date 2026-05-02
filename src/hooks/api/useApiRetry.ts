const BASE_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;

export function calculateRetryDelay(attempt: number): number {
  const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
  return Math.min(delay, MAX_RETRY_DELAY);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
