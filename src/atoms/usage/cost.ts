import type { UsageDetail, ModelPrice } from './types';
import { normalizeUsageTokens } from '@/utils/usageTokenNormalizer';

const TOKENS_PER_PRICE_UNIT = 1_000_000;
const RPM_TPM_PER_PRICE_UNIT = 1_000;

export function calculateCost(
  detail: Pick<UsageDetail, 'tokens' | '__modelName'> & { requestCount?: number },
  modelPrices: Record<string, ModelPrice>
): number {
  const modelName = detail.__modelName || '';
  const price = modelPrices[modelName];
  if (!price) {
    return 0;
  }
  const tokens = detail.tokens;
  if (!tokens) {
    return 0;
  }
  const normalizedTokens = normalizeUsageTokens(tokens);
  const inputTokens = normalizedTokens.input_tokens;
  const completionTokens = normalizedTokens.output_tokens;
  const cachedTokens = normalizedTokens.cached_tokens;
  const inputIncludesCached = normalizedTokens.inputIncludesCached;
  const promptTokens = inputIncludesCached
    ? Math.max(inputTokens - cachedTokens, 0)
    : inputTokens;

  const promptCost = (promptTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.prompt) || 0);
  const cachedCost = (cachedTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.cache) || 0);
  const completionCost =
    (completionTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.completion) || 0);
  const totalTokens = inputTokens + completionTokens;
  const requestCount = detail.requestCount ?? 1;
  const rpmCost =
    typeof price.rpm === 'number' && price.rpm >= 0
      ? (requestCount / RPM_TPM_PER_PRICE_UNIT) * price.rpm
      : 0;
  const tpmCost =
    typeof price.tpm === 'number' && price.tpm >= 0
      ? (totalTokens / RPM_TPM_PER_PRICE_UNIT) * price.tpm
      : 0;
  const total = promptCost + cachedCost + completionCost + rpmCost + tpmCost;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

export function calculateTotalCost(
  details: (Pick<UsageDetail, 'tokens' | '__modelName'> & { requestCount?: number })[],
  modelPrices: Record<string, ModelPrice>
): number {
  if (!details.length || !Object.keys(modelPrices).length) {
    return 0;
  }
  return details.reduce((sum, detail) => sum + calculateCost(detail, modelPrices), 0);
}
