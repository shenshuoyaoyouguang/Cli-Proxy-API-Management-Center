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

  it('handles OpenAI-style format where input_tokens includes cached_tokens', () => {
    const cost = calculateCost(
      {
        __modelName: 'gpt-test',
        tokens: {
          input_tokens: 130,
          output_tokens: 50,
          reasoning_tokens: 0,
          cached_tokens: 30,
          total_tokens: 180,
        },
      },
      modelPrices
    );

    const promptCost = ((130 - 30) / 1_000_000) * 1;
    const cachedCost = (30 / 1_000_000) * 0.5;
    const completionCost = (50 / 1_000_000) * 2;
    expect(cost).toBeCloseTo(promptCost + cachedCost + completionCost, 10);
  });

  it('handles Anthropic-style format where input_tokens does NOT include cached_tokens', () => {
    const cost = calculateCost(
      {
        __modelName: 'gpt-test',
        tokens: {
          input_tokens: 100,
          output_tokens: 50,
          reasoning_tokens: 0,
          cached_tokens: 30,
          total_tokens: 180,
        },
      },
      modelPrices
    );

    const promptCost = (100 / 1_000_000) * 1;
    const cachedCost = (30 / 1_000_000) * 0.5;
    const completionCost = (50 / 1_000_000) * 2;
    expect(cost).toBeCloseTo(promptCost + cachedCost + completionCost, 10);
  });

  it('falls back to assuming input includes cached when total_tokens is absent or ambiguous', () => {
    const cost = calculateCost(
      {
        __modelName: 'gpt-test',
        tokens: {
          input_tokens: 130,
          output_tokens: 50,
          reasoning_tokens: 0,
          cached_tokens: 30,
          total_tokens: 0,
        },
      },
      modelPrices
    );

    const promptCost = ((130 - 30) / 1_000_000) * 1;
    const cachedCost = (30 / 1_000_000) * 0.5;
    const completionCost = (50 / 1_000_000) * 2;
    expect(cost).toBeCloseTo(promptCost + cachedCost + completionCost, 10);
  });
});
