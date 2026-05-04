import type { UsageTimeRange } from './types';

export const USAGE_TIME_RANGE_MS: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function formatHourLabel(date: Date): string {
  if (!(date instanceof Date)) {
    return '';
  }
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hour = date.getHours().toString().padStart(2, '0');
  return `${month}-${day} ${hour}:00`;
}

export function formatDayLabel(date: Date): string {
  if (!(date instanceof Date)) {
    return '';
  }
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDetailTimestampMs(detail: { timestamp: string; __timestampMs?: number }): number {
  if (typeof detail.__timestampMs === 'number' && Number.isFinite(detail.__timestampMs)) {
    return detail.__timestampMs;
  }
  if (typeof detail.timestamp !== 'string') {
    return Number.NaN;
  }
  const date = new Date(detail.timestamp);
  return Number.isNaN(date.getTime()) ? Number.NaN : date.getTime();
}

export function resolveHourWindow(hourWindow: number): number {
  return Number.isFinite(hourWindow) && hourWindow > 0
    ? Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31)
    : 24;
}
