import type { ModelPrice } from '@/atoms/usage/types';
import { isRecord } from '@/atoms/usage/guards';

const MODEL_PRICE_STORAGE_KEY = 'cli-proxy-model-prices-v2';

export function loadModelPrices(): Record<string, ModelPrice> {
  try {
    if (typeof localStorage === 'undefined') {
      return {};
    }
    const raw = localStorage.getItem(MODEL_PRICE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    const normalized: Record<string, ModelPrice> = {};
    Object.entries(parsed).forEach(([model, price]: [string, unknown]) => {
      if (!model) return;
      const priceRecord = isRecord(price) ? price : null;
      const promptRaw = Number(priceRecord?.prompt);
      const completionRaw = Number(priceRecord?.completion);
      const cacheRaw = Number(priceRecord?.cache);
      const rpmRaw = Number(priceRecord?.rpm);
      const tpmRaw = Number(priceRecord?.tpm);

      if (
        !Number.isFinite(promptRaw) &&
        !Number.isFinite(completionRaw) &&
        !Number.isFinite(cacheRaw)
      ) {
        return;
      }

      const prompt = Number.isFinite(promptRaw) && promptRaw >= 0 ? promptRaw : 0;
      const completion = Number.isFinite(completionRaw) && completionRaw >= 0 ? completionRaw : 0;
      const cache =
        Number.isFinite(cacheRaw) && cacheRaw >= 0
          ? cacheRaw
          : Number.isFinite(promptRaw) && promptRaw >= 0
            ? promptRaw
            : prompt;

      const entry: ModelPrice = {
        prompt,
        completion,
        cache,
      };
      if (Number.isFinite(rpmRaw) && rpmRaw >= 0) {
        entry.rpm = rpmRaw;
      }
      if (Number.isFinite(tpmRaw) && tpmRaw >= 0) {
        entry.tpm = tpmRaw;
      }

      normalized[model] = entry;
    });
    return normalized;
  } catch {
    return {};
  }
}

export function saveModelPrices(prices: Record<string, ModelPrice>): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(MODEL_PRICE_STORAGE_KEY, JSON.stringify(prices));
  } catch {
    // Ignore storage errors
  }
}
