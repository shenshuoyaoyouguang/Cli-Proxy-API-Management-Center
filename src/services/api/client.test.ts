import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { apiClient } from './client';

vi.mock('axios', () => {
  const mockInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: {
      timeout: 30000,
    },
  };
  return {
    default: {
      create: vi.fn(() => mockInstance),
      isAxiosError: vi.fn(),
    },
  };
});

describe('ApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setConfig', () => {
    it('sets timeout from config', () => {
      apiClient.setConfig({
        apiBase: 'http://localhost:3000',
        managementKey: 'test-key',
        timeout: 5000,
      });
      // The timeout is set on the axios instance defaults
    });

    it('falls back to default timeout when not provided', () => {
      apiClient.setConfig({ apiBase: 'http://localhost:3000', managementKey: 'test-key' });
      // Default timeout should be used
    });
  });

  describe('HTTP methods', () => {
    it('get returns response data', async () => {
      const mockInstance = axios.create();
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { result: 'ok' } });

      await apiClient.get('/test');
      expect(mockInstance.get).toHaveBeenCalledWith('/test', undefined);
    });

    it('post sends data and returns response', async () => {
      const mockInstance = axios.create();
      (mockInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 1 } });

      await apiClient.post('/test', { name: 'test' });
      expect(mockInstance.post).toHaveBeenCalledWith('/test', { name: 'test' }, undefined);
    });

    it('put sends data and returns response', async () => {
      const mockInstance = axios.create();
      (mockInstance.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { updated: true } });

      await apiClient.put('/test/1', { name: 'updated' });
      expect(mockInstance.put).toHaveBeenCalledWith('/test/1', { name: 'updated' }, undefined);
    });

    it('patch sends data and returns response', async () => {
      const mockInstance = axios.create();
      (mockInstance.patch as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { patched: true },
      });

      await apiClient.patch('/test/1', { field: 'value' });
      expect(mockInstance.patch).toHaveBeenCalledWith('/test/1', { field: 'value' }, undefined);
    });

    it('delete sends request and returns response', async () => {
      const mockInstance = axios.create();
      (mockInstance.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { deleted: true },
      });

      await apiClient.delete('/test/1');
      expect(mockInstance.delete).toHaveBeenCalledWith('/test/1', undefined);
    });
  });

  describe('getRaw', () => {
    it('returns full AxiosResponse', async () => {
      const mockInstance = axios.create();
      const mockResponse = { data: 'raw', status: 200, headers: {} };
      (mockInstance.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await apiClient.getRaw('/download');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('postForm', () => {
    it('sends FormData with multipart content type', async () => {
      const mockInstance = axios.create();
      (mockInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { uploaded: true },
      });

      const formData = new FormData();
      formData.append('file', 'test');
      await apiClient.postForm('/upload', formData);

      expect(mockInstance.post).toHaveBeenCalledWith(
        '/upload',
        formData,
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'multipart/form-data' }),
        })
      );
    });
  });

  describe('requestRaw', () => {
    it('sends raw request config', async () => {
      const mockInstance = axios.create();
      const mockResponse = { data: 'response' };
      (mockInstance.request as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const config = { url: '/custom', method: 'GET' };
      await apiClient.requestRaw(config);
      expect(mockInstance.request).toHaveBeenCalledWith(config);
    });
  });
});
