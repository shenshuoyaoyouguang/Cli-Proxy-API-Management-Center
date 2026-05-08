import { describe, expect, it } from 'vitest';
import { calculateCost } from './cost';

describe('calculateCost', () => {
  const modelPrices = {
    'gpt-test': {
      prompt: 1,
      completion: 2,
      cache: 0.5,
    },
  };

  it('treats cache_tokens and cached_tokens as the same semantic field', () => {
    const withBothFields = calculateCost(
      {
        __modelName: 'gpt-test',
        tokens: {
          input_tokens: 100,
          output_tokens: 50,
          reasoning_tokens: 0,
          cache_tokens: 40,
          cached_tokens: 40,
          total_tokens: 150,
        },
      },
      modelPrices
    );

    const withSingleField = calculateCost(
      {
        __modelName: 'gpt-test',
        tokens: {
          input_tokens: 100,
          output_tokens: 50,
          reasoning_tokens: 0,
          cached_tokens: 40,
          total_tokens: 150,
        },
      },
      modelPrices
    );

    expect(withBothFields).toBe(withSingleField);
  });

  it('uses whichever cache field is present without double counting', () => {
    const legacyFieldCost = calculateCost(
      {
        __modelName: 'gpt-test',
        tokens: {
          input_tokens: 100,
          output_tokens: 50,
          reasoning_tokens: 0,
          cache_tokens: 25,
          cached_tokens: 25,
          total_tokens: 150,
        },
      },
      modelPrices
    );

    const canonicalFieldCost = calculateCost(
      {
        __modelName: 'gpt-test',
        tokens: {
          input_tokens: 100,
          output_tokens: 50,
          reasoning_tokens: 0,
          cached_tokens: 25,
          total_tokens: 150,
        },
      },
      modelPrices
    );

    expect(legacyFieldCost).toBe(canonicalFieldCost);
  });
});
