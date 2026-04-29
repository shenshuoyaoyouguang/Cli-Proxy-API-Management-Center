import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { providersApi } from './providers';
import { apiClient } from './client';

describe('providersApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends provider delete requests in request body instead of query string', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ ok: true });

    await providersApi.deleteClaudeConfig('sk-test-key', 'https://api.example.com');

    expect(apiClient.delete).toHaveBeenCalledWith('/claude-api-key', {
      data: {
        'api-key': 'sk-test-key',
        'base-url': 'https://api.example.com',
      },
    });
  });

  it('trims delete payload values before sending them', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ ok: true });

    await providersApi.deleteGeminiKey('  api-key  ', '  https://proxy.example.com  ');

    expect(apiClient.delete).toHaveBeenCalledWith('/gemini-api-key', {
      data: {
        'api-key': 'api-key',
        'base-url': 'https://proxy.example.com',
      },
    });
  });
});
