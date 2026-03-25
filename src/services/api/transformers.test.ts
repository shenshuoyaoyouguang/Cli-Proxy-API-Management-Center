import { describe, expect, it } from 'vitest';
import {
  normalizeApiKeyEntry,
  normalizeGeminiKeyConfig,
  normalizeModelAliases,
  normalizeOpenAIProvider,
  normalizeProviderKeyConfig,
  normalizeHeaders,
  normalizeExcludedModels,
  normalizeConfigResponse,
} from './transformers';

describe('normalizeApiKeyEntry', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizeApiKeyEntry(null)).toBeNull();
    expect(normalizeApiKeyEntry(undefined)).toBeNull();
  });

  it('normalizes string input as apiKey', () => {
    expect(normalizeApiKeyEntry('my-api-key')).toEqual({ apiKey: 'my-api-key' });
  });

  it('extracts api-key from object with api-key property', () => {
    expect(normalizeApiKeyEntry({ 'api-key': 'key-123' })).toEqual({ apiKey: 'key-123' });
  });

  it('extracts apiKey from camelCase property', () => {
    expect(normalizeApiKeyEntry({ apiKey: 'key-456' })).toEqual({ apiKey: 'key-456' });
  });

  it('includes optional proxyUrl when provided', () => {
    expect(normalizeApiKeyEntry({ 'api-key': 'key', 'proxy-url': 'http://proxy' })).toEqual({
      apiKey: 'key',
      proxyUrl: 'http://proxy',
    });
  });

  it('returns null for empty apiKey', () => {
    expect(normalizeApiKeyEntry({ 'api-key': '' })).toBeNull();
    expect(normalizeApiKeyEntry('')).toBeNull();
  });
});

describe('normalizeGeminiKeyConfig', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizeGeminiKeyConfig(null)).toBeNull();
    expect(normalizeGeminiKeyConfig(undefined)).toBeNull();
  });

  it('normalizes string input as apiKey', () => {
    expect(normalizeGeminiKeyConfig('gemini-key')).toEqual({ apiKey: 'gemini-key' });
  });

  it('extracts config from object input', () => {
    const input = {
      'api-key': 'gem-key-1',
      priority: 1,
      prefix: 'gpt-',
    };
    const result = normalizeGeminiKeyConfig(input);
    expect(result?.apiKey).toBe('gem-key-1');
    expect(result?.priority).toBe(1);
    expect(result?.prefix).toBe('gpt-');
  });

  it('includes baseUrl when provided', () => {
    const result = normalizeGeminiKeyConfig({
      'api-key': 'key',
      'base-url': 'https://api.gemini.com',
    });
    expect(result?.baseUrl).toBe('https://api.gemini.com');
  });

  it('includes proxyUrl when provided', () => {
    const result = normalizeGeminiKeyConfig({ 'api-key': 'key', 'proxy-url': 'http://proxy' });
    expect(result?.proxyUrl).toBe('http://proxy');
  });
});

describe('normalizeModelAliases', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeModelAliases(null)).toEqual([]);
    expect(normalizeModelAliases(undefined)).toEqual([]);
    expect(normalizeModelAliases('string')).toEqual([]);
  });

  it('converts string array to ModelAlias array', () => {
    const result = normalizeModelAliases(['gpt-4', 'gpt-3.5-turbo']);
    expect(result).toEqual([{ name: 'gpt-4' }, { name: 'gpt-3.5-turbo' }]);
  });

  it('extracts name from object with name property', () => {
    const result = normalizeModelAliases([{ name: 'gpt-4' }]);
    expect(result).toEqual([{ name: 'gpt-4' }]);
  });

  it('extracts name from object with id property', () => {
    const result = normalizeModelAliases([{ id: 'model-1' }]);
    expect(result).toEqual([{ name: 'model-1' }]);
  });

  it('includes alias when different from name', () => {
    const result = normalizeModelAliases([{ name: 'gpt-4', alias: 'GPT-4 Turbo' }]);
    expect(result).toEqual([{ name: 'gpt-4', alias: 'GPT-4 Turbo' }]);
  });

  it('filters out null/undefined entries', () => {
    const result = normalizeModelAliases(['gpt-4', null, undefined, '', 'gpt-3.5']);
    expect(result).toEqual([{ name: 'gpt-4' }, { name: 'gpt-3.5' }]);
  });

  it('includes priority when provided', () => {
    const result = normalizeModelAliases([{ name: 'model', priority: 5 }]);
    expect(result[0].priority).toBe(5);
  });
});

describe('normalizeProviderKeyConfig', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizeProviderKeyConfig(null)).toBeNull();
    expect(normalizeProviderKeyConfig(undefined)).toBeNull();
  });

  it('normalizes string input', () => {
    expect(normalizeProviderKeyConfig('provider-key')).toEqual({ apiKey: 'provider-key' });
  });

  it('extracts config from object input', () => {
    const input = {
      'api-key': 'prov-key-1',
      priority: 2,
      prefix: 'claude-',
      'base-url': 'https://api.claude.com',
    };
    const result = normalizeProviderKeyConfig(input);
    expect(result?.apiKey).toBe('prov-key-1');
    expect(result?.priority).toBe(2);
    expect(result?.prefix).toBe('claude-');
    expect(result?.baseUrl).toBe('https://api.claude.com');
  });

  it('returns null for empty apiKey', () => {
    expect(normalizeProviderKeyConfig({ 'api-key': '' })).toBeNull();
  });

  it('includes websockets when provided', () => {
    const result = normalizeProviderKeyConfig({ 'api-key': 'key', websockets: true });
    expect(result?.websockets).toBe(true);
  });

  it('includes proxyUrl when provided', () => {
    const result = normalizeProviderKeyConfig({ 'api-key': 'key', 'proxy-url': 'http://proxy' });
    expect(result?.proxyUrl).toBe('http://proxy');
  });
});

describe('normalizeOpenAIProvider', () => {
  it('returns null for non-object input', () => {
    expect(normalizeOpenAIProvider(null)).toBeNull();
    expect(normalizeOpenAIProvider('string')).toBeNull();
  });

  it('returns null when name or baseUrl is missing', () => {
    expect(normalizeOpenAIProvider({ name: 'provider' })).toBeNull();
    expect(normalizeOpenAIProvider({ 'base-url': 'https://api.com' })).toBeNull();
  });

  it('normalizes valid provider config', () => {
    const input = {
      name: 'my-provider',
      'base-url': 'https://api.provider.com',
      'api-key-entries': [{ 'api-key': 'key-1' }],
    };
    const result = normalizeOpenAIProvider(input);
    expect(result?.name).toBe('my-provider');
    expect(result?.baseUrl).toBe('https://api.provider.com');
    expect(result?.apiKeyEntries).toEqual([{ apiKey: 'key-1' }]);
  });

  it('normalizes api-keys array format', () => {
    const input = {
      name: 'provider',
      'base-url': 'https://api.com',
      'api-keys': ['key-1', 'key-2'],
    };
    const result = normalizeOpenAIProvider(input);
    expect(result?.apiKeyEntries).toHaveLength(2);
    expect(result?.apiKeyEntries[0].apiKey).toBe('key-1');
  });

  it('includes optional prefix when provided', () => {
    const result = normalizeOpenAIProvider({
      name: 'provider',
      'base-url': 'https://api.com',
      prefix: 'gpt-',
    });
    expect(result?.prefix).toBe('gpt-');
  });
});

describe('normalizeHeaders', () => {
  it('returns undefined for null/undefined input', () => {
    expect(normalizeHeaders(null)).toBeUndefined();
    expect(normalizeHeaders(undefined)).toBeUndefined();
  });

  it('returns undefined for non-object input', () => {
    expect(normalizeHeaders('string')).toBeUndefined();
    expect(normalizeHeaders(123)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(normalizeHeaders({})).toBeUndefined();
  });
});

describe('normalizeExcludedModels', () => {
  it('returns empty array for null/undefined', () => {
    expect(normalizeExcludedModels(null)).toEqual([]);
    expect(normalizeExcludedModels(undefined)).toEqual([]);
  });

  it('handles array input', () => {
    expect(normalizeExcludedModels(['gpt-4', 'gpt-3.5'])).toEqual(['gpt-4', 'gpt-3.5']);
  });

  it('handles comma-separated string input', () => {
    expect(normalizeExcludedModels('gpt-4,gpt-3.5')).toEqual(['gpt-4', 'gpt-3.5']);
  });

  it('handles newline-separated string input', () => {
    expect(normalizeExcludedModels('gpt-4\ngpt-3.5')).toEqual(['gpt-4', 'gpt-3.5']);
  });

  it('deduplicates entries (case-insensitive)', () => {
    expect(normalizeExcludedModels(['GPT-4', 'gpt-4', 'GPT-3.5'])).toEqual(['GPT-4', 'GPT-3.5']);
  });

  it('trims whitespace', () => {
    expect(normalizeExcludedModels(['  gpt-4  ', ' gpt-3.5 '])).toEqual(['gpt-4', 'gpt-3.5']);
  });

  it('filters out empty strings', () => {
    expect(normalizeExcludedModels(['gpt-4', '', '  ', 'gpt-3.5'])).toEqual(['gpt-4', 'gpt-3.5']);
  });
});

describe('normalizeConfigResponse', () => {
  it('returns config with raw for non-object input', () => {
    const result = normalizeConfigResponse(null);
    expect(result.raw).toEqual({});
  });

  it('parses debug flag from various formats', () => {
    expect(normalizeConfigResponse({ debug: true }).debug).toBe(true);
    expect(normalizeConfigResponse({ debug: 'true' }).debug).toBe(true);
    expect(normalizeConfigResponse({ debug: 0 }).debug).toBe(false);
    expect(normalizeConfigResponse({ debug: 'false' }).debug).toBe(false);
  });

  it('parses proxyUrl', () => {
    expect(normalizeConfigResponse({ 'proxy-url': 'http://proxy' }).proxyUrl).toBe('http://proxy');
    expect(normalizeConfigResponse({ proxyUrl: 'http://proxy' }).proxyUrl).toBe('http://proxy');
  });

  it('parses requestRetry from number or string', () => {
    expect(normalizeConfigResponse({ 'request-retry': 3 }).requestRetry).toBe(3);
    expect(normalizeConfigResponse({ requestRetry: '5' }).requestRetry).toBe(5);
  });

  it('parses routingStrategy', () => {
    expect(normalizeConfigResponse({ 'routing-strategy': 'round-robin' }).routingStrategy).toBe(
      'round-robin'
    );
    expect(normalizeConfigResponse({ routingStrategy: 'weighted' }).routingStrategy).toBe(
      'weighted'
    );
  });

  it('parses apiKeys array', () => {
    const result = normalizeConfigResponse({ 'api-keys': ['key1', 'key2', ''] });
    expect(result.apiKeys).toEqual(['key1', 'key2']);
  });

  it('parses geminiApiKeys from array', () => {
    const result = normalizeConfigResponse({
      'gemini-api-key': [{ 'api-key': 'gem-key-1' }],
    });
    expect(result.geminiApiKeys).toHaveLength(1);
    expect(result.geminiApiKeys?.[0].apiKey).toBe('gem-key-1');
  });

  it('parses quotaExceeded config', () => {
    const result = normalizeConfigResponse({
      'quota-exceeded': {
        'switch-project': true,
        'switch-preview-model': false,
      },
    });
    expect(result.quotaExceeded?.switchProject).toBe(true);
    expect(result.quotaExceeded?.switchPreviewModel).toBe(false);
  });

  it('preserves raw config object', () => {
    const raw = { debug: true, custom: 'value' };
    const result = normalizeConfigResponse(raw);
    expect(result.raw).toEqual(raw);
  });
});
