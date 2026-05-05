import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { apiClient } from '@/services/api/client';
import { apiCallApi, getApiCallErrorMessage } from './apiCall';
import type { ApiCallResult } from './apiCall';

describe('sanitizeHeaders (via apiCallApi)', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockResolvedValue({
      status_code: 200,
      header: {},
      body: '',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('strips CR characters from header names', async () => {
    await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
      header: { 'X-Custom\r': 'value' },
    });

    const payload = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>;
    const headers = payload.header as Record<string, string>;
    expect(Object.keys(headers)).not.toContain('X-Custom\r');
    expect(Object.keys(headers)).toContain('X-Custom');
  });

  it('strips LF characters from header values', async () => {
    await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
      header: { 'X-Custom': 'value\ninjected-header: evil' },
    });

    const payload = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>;
    const headers = payload.header as Record<string, string>;
    expect(headers['X-Custom']).toBe('valueinjected-header: evil');
  });

  it('strips CRLF injection attempts from header values', async () => {
    await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
      header: { 'X-Test': 'value\r\nX-Injected: malicious' },
    });

    const payload = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>;
    const headers = payload.header as Record<string, string>;
    expect(headers['X-Test']).toBe('valueX-Injected: malicious');
    expect(Object.keys(headers)).not.toContain('X-Injected');
  });

  it('strips CRLF from header names', async () => {
    await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
      header: { 'X-Test\r\nX-Injected': 'value' },
    });

    const payload = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>;
    const headers = payload.header as Record<string, string>;
    expect(Object.keys(headers)).not.toContain('X-Test\r\nX-Injected');
    expect(Object.keys(headers)).toContain('X-TestX-Injected');
  });

  it('removes headers with empty keys after sanitization', async () => {
    await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
      header: { '\r\n': 'value' },
    });

    const payload = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.header).toBeUndefined();
  });

  it('removes headers with empty values after sanitization', async () => {
    await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
      header: { 'X-Empty': '  \r\n  ' },
    });

    const payload = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.header).toBeUndefined();
  });

  it('handles undefined headers', async () => {
    await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
    });

    const payload = vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.header).toBeUndefined();
  });
});

describe('normalizeBody', () => {
  it('returns null body for non-JSON string response', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      status_code: 200,
      header: {},
      body: 'not json',
    });

    const response = await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
    });

    expect(response.body).toBeNull();
    expect(response.bodyText).toBe('not json');
  });

  it('returns parsed body for JSON string response', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      status_code: 200,
      header: {},
      body: '{"key": "value"}',
    });

    const response = await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
    });

    expect(response.body).toEqual({ key: 'value' });
  });

  it('returns null body for empty string response', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      status_code: 200,
      header: {},
      body: '',
    });

    const response = await apiCallApi.request({
      method: 'POST',
      url: 'https://example.com/api',
    });

    expect(response.body).toBeNull();
  });
});

describe('getApiCallErrorMessage', () => {
  it('extracts message from error object', () => {
    const result: ApiCallResult = {
      statusCode: 400,
      header: {},
      bodyText: '',
      body: { error: { message: 'Bad request' } },
    };
    expect(getApiCallErrorMessage(result)).toBe('400 Bad request');
  });

  it('extracts string error', () => {
    const result: ApiCallResult = {
      statusCode: 403,
      header: {},
      bodyText: '',
      body: { error: 'Forbidden' },
    };
    expect(getApiCallErrorMessage(result)).toBe('403 Forbidden');
  });

  it('falls back to bodyText', () => {
    const result: ApiCallResult = {
      statusCode: 500,
      header: {},
      bodyText: 'Internal Server Error',
      body: null,
    };
    expect(getApiCallErrorMessage(result)).toBe('500 Internal Server Error');
  });

  it('returns HTTP status only when no message', () => {
    const result: ApiCallResult = {
      statusCode: 502,
      header: {},
      bodyText: '',
      body: null,
    };
    expect(getApiCallErrorMessage(result)).toBe('HTTP 502');
  });
});
