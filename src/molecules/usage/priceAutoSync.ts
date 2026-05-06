import type { ModelPrice } from '@/atoms/usage/types';
import { fetchPriceCatalog } from '@/atoms/usage/priceCatalog';

function findBestMatch(
  modelName: string,
  catalog: Record<string, ModelPrice>
): ModelPrice | null {
  const lower = modelName.toLowerCase();

  if (catalog[lower]) return catalog[lower];

  let bestKey = '';
  for (const key of Object.keys(catalog)) {
    if (lower.startsWith(key + '-') || lower.startsWith(key + ':')) {
      if (key.length > bestKey.length) bestKey = key;
    }
  }
  return bestKey ? catalog[bestKey] : null;
}

export async function syncPricesForModels(
  usedModelNames: string[],
  existingPrices: Record<string, ModelPrice>
): Promise<Record<string, ModelPrice>> {
  const missing = usedModelNames.filter((name) => !existingPrices[name.toLowerCase()]);
  if (missing.length === 0) return existingPrices;

  let catalog: Record<string, ModelPrice>;
  try {
    catalog = await fetchPriceCatalog();
  } catch {
    return existingPrices;
  }

  const updated = { ...existingPrices };
  let added = 0;

  for (const name of missing) {
    const lower = name.toLowerCase();
    if (updated[lower]) continue;

    const price = findBestMatch(lower, catalog);
    if (price) {
      updated[lower] = price;
      added++;
    }
  }

  return added > 0 ? updated : existingPrices;
}
