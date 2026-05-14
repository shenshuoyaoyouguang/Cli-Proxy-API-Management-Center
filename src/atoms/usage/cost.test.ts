import { describe, expect, it } from 'vitest';
import { calculateCost, calculateTotalCost, createKahanAccumulator, kahanAdd } from './cost';

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

describe('calculateTotalCost', () => {
  const modelPrices = {
    'gpt-test': {
      prompt: 1,
      completion: 1,
      cache: 0.5,
    },
  };

  it('returns 0 for empty details', () => {
    expect(calculateTotalCost([], modelPrices)).toBe(0);
  });

  it('returns 0 when modelPrices is empty', () => {
    const details = [
      {
        __modelName: 'gpt-test',
        tokens: { input_tokens: 100, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 100 },
      },
    ];
    expect(calculateTotalCost(details, {})).toBe(0);
  });

  it('accumulates cost for multiple details', () => {
    const detail = {
      __modelName: 'gpt-test',
      tokens: { input_tokens: 100, output_tokens: 50, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 150 },
    };
    const details = Array.from({ length: 5 }, () => detail);
    const expected = calculateCost(detail, modelPrices) * 5;
    expect(calculateTotalCost(details, modelPrices)).toBeCloseTo(expected, 12);
  });

  it('Kahan summation precision: 100000 tiny prompt costs have relative error < 1e-10', () => {
    const modelPrices = {
      'cheap-model': { prompt: 0.001, completion: 0, cache: 0 },
    };
    const count = 100000;
    const promptTokens = 1;
    const details = Array.from({ length: count }, () => ({
      __modelName: 'cheap-model',
      tokens: {
        input_tokens: promptTokens,
        output_tokens: 0,
        cached_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: promptTokens,
      },
    }));

    const result = calculateTotalCost(details, modelPrices);

    const unitPrice = 0.001;
    const exact = (count * promptTokens / 1_000_000) * unitPrice;
    const relativeError = Math.abs(result - exact) / exact;

    expect(relativeError).toBeLessThan(1e-10);
  });

  it('Kahan accumulator helper works correctly', () => {
    const acc = createKahanAccumulator();
    kahanAdd(acc, 1);
    for (let i = 0; i < 10000; i++) {
      kahanAdd(acc, 1e-16);
    }
    let naive = 1;
    for (let i = 0; i < 10000; i++) {
      naive += 1e-16;
    }
    const exact = 1 + 10000 * 1e-16;
    expect(Math.abs(acc.sum - exact)).toBeLessThan(Math.abs(naive - exact));
  });
});
