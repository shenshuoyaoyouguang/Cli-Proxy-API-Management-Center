import { describe, expect, it } from 'vitest';
import { collectUsageDetails, collectUsageDetailsWithEndpoint } from './collectDetails';

const createUsagePayload = (timestamp = '2026-01-01T00:00:00.000Z') => ({
  apis: {
    'POST /v1/chat/completions': {
      models: {
        'gpt-4.1': {
          details: [
            {
              timestamp,
              source: 'tenant-a',
              auth_index: '7',
              tokens: {
                input_tokens: 10,
                output_tokens: 5,
                cached_tokens: 3,
                total_tokens: 18,
              },
              failed: false,
            },
          ],
        },
      },
    },
  },
});

describe('collectDetails', () => {
  it('extracts token usage from nested usage payloads when detail.tokens is absent', () => {
    const details = collectUsageDetails({
      apis: {
        'POST /v1/chat/completions': {
          models: {
            minimax: {
              details: [
                {
                  timestamp: '2026-01-01T00:00:00.000Z',
                  source: 'tenant-a',
                  auth_index: '7',
                  usage: {
                    prompt_tokens: 120,
                    completion_tokens: 30,
                    total_tokens: 150,
                  },
                  failed: false,
                },
              ],
            },
          },
        },
      },
    });

    expect(details).toHaveLength(1);
    expect(details[0].tokens).toMatchObject({
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
    });
  });

  it('keeps invalid timestamps as NaN instead of silently coercing them to epoch 0', () => {
    const details = collectUsageDetails(createUsagePayload('not-a-timestamp'));

    expect(details).toHaveLength(1);
    expect(Number.isNaN(details[0].__timestampMs)).toBe(true);

    const endpointDetails = collectUsageDetailsWithEndpoint(createUsagePayload('not-a-timestamp'));
    expect(endpointDetails).toHaveLength(1);
    expect(Number.isNaN(endpointDetails[0].__timestampMs)).toBe(true);
  });

  it('reuses cached details across different wrapper objects when they share the same apis payload', () => {
    const usage = createUsagePayload();
    const wrapperA = { usage };
    const wrapperB = { usage };

    const first = collectUsageDetails(wrapperA);
    const second = collectUsageDetails(wrapperB);

    expect(second).toBe(first);
  });
});
