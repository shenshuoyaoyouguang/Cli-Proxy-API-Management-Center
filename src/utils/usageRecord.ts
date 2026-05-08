export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseString(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return null;
  return String(raw);
}

export function parseAuthIndex(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeAuthIndex(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

export function parseBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
}

export function getApisRecord(usageData: unknown): Record<string, unknown> | null {
  const usageRecord = isRecord(usageData) ? usageData : null;
  const apisRaw = usageRecord ? usageRecord.apis : null;
  return isRecord(apisRaw) ? apisRaw : null;
}
