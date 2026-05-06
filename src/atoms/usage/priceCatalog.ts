import type { ModelPrice } from './types';

const CATALOG_URL = 'https://models.dev/api.json';
const CATALOG_STORAGE_KEY = 'cli-proxy-price-catalog-v1';
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedCatalog {
  ts: number;
  prices: Record<string, ModelPrice>;
}

let memoryCache: Record<string, ModelPrice> | null = null;

function normalizeCatalog(raw: unknown): Record<string, ModelPrice> {
  if (!raw || typeof raw !== 'object') return {};
  const root = raw as Record<string, unknown>;
  const result: Record<string, ModelPrice> = {};

  for (const providerKey of Object.keys(root)) {
    const provider = root[providerKey];
    if (!provider || typeof provider !== 'object') continue;
    const models = (provider as Record<string, unknown>).models;
    if (!models || typeof models !== 'object') continue;

    for (const modelKey of Object.keys(models as Record<string, unknown>)) {
      const model = (models as Record<string, unknown>)[modelKey];
      if (!model || typeof model !== 'object') continue;
      const cost = (model as Record<string, unknown>).cost;
      if (!cost || typeof cost !== 'object') continue;

      const c = cost as Record<string, unknown>;
      const input = Number(c.input) || 0;
      const output = Number(c.output) || 0;
      if (input <= 0 && output <= 0) continue;

      const cacheRead = Number(c.cache_read) || 0;
      const cacheWrite = Number(c.cache_write) || 0;

      result[modelKey.toLowerCase()] = {
        prompt: input,
        completion: output,
        cache: cacheRead || cacheWrite || 0,
      };
    }
  }
  return result;
}

function loadCachedCatalog(): Record<string, ModelPrice> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return null;
    const cached: CachedCatalog = JSON.parse(raw);
    if (!cached.ts || Date.now() - cached.ts > CATALOG_TTL_MS) return null;
    return cached.prices;
  } catch {
    return null;
  }
}

function persistCatalog(prices: Record<string, ModelPrice>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const cached: CachedCatalog = { ts: Date.now(), prices };
    localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // storage full or unavailable
  }
}

export async function fetchPriceCatalog(): Promise<Record<string, ModelPrice>> {
  if (memoryCache) return memoryCache;

  const cached = loadCachedCatalog();
  if (cached) {
    memoryCache = cached;
    return cached;
  }

  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  const raw = await res.json();
  const prices = normalizeCatalog(raw);

  memoryCache = prices;
  persistCatalog(prices);
  return prices;
}

export function clearPriceCatalogCache(): void {
  memoryCache = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CATALOG_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}
