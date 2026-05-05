import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSSEHandler } from '@/types/sse';
import { UsageSSEServiceImpl, SSE_RECONNECT_MAX_ATTEMPTS } from './UsageSSEService';

function createMockStreamResponse(chunks: string[], options?: { status?: number; statusText?: string }): Response {
  const status = options?.status ?? 200;
  const statusText = options?.statusText ?? 'OK';

  if (status !== 200) {
    return new Response(null, { status, statusText });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(readable, {
    status,
    statusText,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const createHandler = (): UsageSSEHandler => ({
  onDelta: vi.fn(),
  onFull: vi.fn(),
  onHeartbeat: vi.fn(),
  onError: vi.fn(),
  onAuthError: vi.fn(),
});

describe('UsageSSEService', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends Authorization header instead of URL query parameter', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([]));
    service.connect('http://localhost:3000', 'management-key', handler);

    await vi.runOnlyPendingTimersAsync();

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/v0/management/usage/stream',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer management-key',
          Accept: 'text/event-stream',
        },
      })
    );
    expect(fetchSpy.mock.calls[0][0]).not.toContain('token=');
  });

  it('triggers onAuthError on 401 response', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([], { status: 401, statusText: 'Unauthorized' }));
    service.connect('http://localhost:3000', 'bad-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onAuthError).toHaveBeenCalledTimes(1);
    expect(service.getConnectionStatus()).toBe('disconnected');
  });

  it('triggers onAuthError on 403 response', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([], { status: 403, statusText: 'Forbidden' }));
    service.connect('http://localhost:3000', 'bad-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onAuthError).toHaveBeenCalledTimes(1);
  });

  it('disconnects and aborts the fetch stream', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    let abortSignal: AbortSignal | undefined;
    fetchSpy.mockImplementation((_url: string, options: RequestInit) => {
      abortSignal = options.signal ?? undefined;
      return Promise.resolve(createMockStreamResponse([]));
    });

    service.connect('http://localhost:3000', 'test-key', handler);
    await vi.runOnlyPendingTimersAsync();

    expect(abortSignal?.aborted).toBe(false);
    service.disconnect();
    expect(abortSignal?.aborted).toBe(true);
    expect(service.getConnectionStatus()).toBe('disconnected');
  });

  it('attempts reconnection on initial connection failure instead of immediate degradation', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockRejectedValue(new Error('Network error'));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(service.getConnectionStatus()).not.toBe('degraded');

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    service.disconnect();
  });

  it('enters degraded state after max reconnection attempts', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockRejectedValue(new Error('Network error'));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    for (let i = 0; i < SSE_RECONNECT_MAX_ATTEMPTS; i++) {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    }

    expect(service.getConnectionStatus()).toBe('degraded');
    const errorEvent = (handler.onError as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(errorEvent).toBeInstanceOf(ErrorEvent);
    expect(errorEvent.message).toContain('5 attempts');
  });

  it('resets isConnecting on disconnect allowing new connections', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockReturnValue(new Promise(() => {}));
    service.connect('http://localhost:3000', 'test-key', handler);

    service.disconnect();
    expect(service.getConnectionStatus()).toBe('disconnected');

    fetchSpy.mockResolvedValue(createMockStreamResponse([]));
    service.connect('http://localhost:3000', 'test-key', handler);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    service.disconnect();
  });

  it('dispatches usage:delta events to handler', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const deltaData = JSON.stringify({
      seq: 1,
      timestamp: 1000,
      requestCount: 5,
      successCount: 4,
      failureCount: 1,
      tokenDelta: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      details: [],
    });

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:delta\ndata:${deltaData}\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onDelta).toHaveBeenCalledTimes(1);
    expect((handler.onDelta as ReturnType<typeof vi.fn>).mock.calls[0][0].seq).toBe(1);
  });

  it('dispatches usage:full events to handler', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const fullData = JSON.stringify({ seq: 1, timestamp: 1000, usage: {} });

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:full\ndata:${fullData}\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onFull).toHaveBeenCalledTimes(1);
    expect((handler.onFull as ReturnType<typeof vi.fn>).mock.calls[0][0].seq).toBe(1);
  });

  it('dispatches usage:heartbeat events to handler', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:heartbeat\ndata:{}\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('reports ErrorEvent with message on JSON parse failure', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:delta\ndata:invalid-json\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onError).toHaveBeenCalledTimes(1);
    const errorEvent = (handler.onError as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(errorEvent).toBeInstanceOf(ErrorEvent);
    expect(errorEvent.message).toContain('SSE parse error');
  });

  it('reconnects when stream ends', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getConnectionStatus()).toBe('connected');

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    service.disconnect();
  });

  it('resets retry state on successful reconnection', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockRejectedValueOnce(new Error('Network error'));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    fetchSpy.mockResolvedValueOnce(createMockStreamResponse([
      `event:usage:heartbeat\ndata:{}\n\n`,
    ]));
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getConnectionStatus()).toBe('connected');
    service.disconnect();
  });

  it('handles SSE events split across chunks', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const heartbeatData = '{}';

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:heart`,
      `beat\ndata:${heartbeatData}\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('ignores SSE comment lines', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const heartbeatData = '{}';

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `: this is a comment\nevent:usage:heartbeat\ndata:${heartbeatData}\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onHeartbeat).toHaveBeenCalledTimes(1);
  });
});
