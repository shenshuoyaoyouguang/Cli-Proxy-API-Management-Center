import { describe, expect, it } from 'vitest';
import { getUsageDetailTotalTokenCount, normalizeUsageDetailTokens } from './tokens';

describe('usage token detail normalization', () => {
  it('extracts MiniMax/OpenAI style usage objects when details do not expose a tokens field', () => {
    const tokens = normalizeUsageDetailTokens({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
      },
      status_code: 200,
    });

    expect(tokens).toMatchObject({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
    });
  });

  it('extracts Gemini-style usageMetadata aliases including candidates and thoughts token counts', () => {
    const tokens = normalizeUsageDetailTokens({
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 60,
        cachedContentTokenCount: 20,
        thoughtsTokenCount: 5,
        totalTokenCount: 185,
      },
    });

    expect(tokens).toMatchObject({
      input_tokens: 100,
      output_tokens: 60,
      cached_tokens: 20,
      reasoning_tokens: 5,
      total_tokens: 185,
    });
  });

  it('falls back to the full detail payload when token data is flattened at the root', () => {
    const totalTokens = getUsageDetailTotalTokenCount({
      prompt_tokens: 42,
      completion_tokens: 8,
      total_tokens: 50,
      auth_index: '7',
    });

    expect(totalTokens).toBe(50);
  });

  it('keeps inputIncludesCached=true when total_tokens already equals prompt+completion without adding cached twice', () => {
    const tokens = normalizeUsageDetailTokens({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        cached_tokens: 10,
        total_tokens: 120,
      },
    });

    expect(tokens).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      cached_tokens: 10,
      total_tokens: 120,
      inputIncludesCached: true,
    });
  });

  it('switches inputIncludesCached=false when total_tokens includes cached tokens separately', () => {
    const tokens = normalizeUsageDetailTokens({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        cached_tokens: 10,
        total_tokens: 130,
      },
    });

    expect(tokens).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      cached_tokens: 10,
      total_tokens: 130,
      inputIncludesCached: false,
    });
  });
});
