import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSSEHandler } from '@/types/sse';
import { UsageSSEServiceImpl, SSE_RECONNECT_MAX_ATTEMPTS, SSE_BUFFER_MAX_SIZE } from './UsageSSEService';

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

  it('sends token via URL query parameter instead of Authorization header', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([]));
    service.connect('http://localhost:3000', 'management-key', handler);

    await vi.runOnlyPendingTimersAsync();

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('token=management-key');
    expect(calledUrl).toContain('/v0/management/usage/stream');
    expect(calledUrl).not.toContain('Authorization');
    const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.headers).not.toHaveProperty('Authorization');
  });

  it('sends Last-Event-ID query parameter when reconnecting with cached event id', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:delta\nid:42\ndata:${JSON.stringify({ seq: 42, timestamp: 1000, tokenDelta: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, details: [] })}\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(handler.onDelta).toHaveBeenCalledTimes(1);

    fetchSpy.mockResolvedValue(createMockStreamResponse([]));
    service.connect('http://localhost:3000', 'test-key', handler, { resetRetryState: false });

    await vi.runOnlyPendingTimersAsync();

    const reconnectUrl = fetchSpy.mock.calls[1][0] as string;
    expect(reconnectUrl).toContain('Last-Event-ID=42');
    service.disconnect();
  });

  it('triggers onAuthError on 401 response', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockResolvedValue(createMockStreamResponse([], { status: 401, statusText: 'Unauthorized' }));
    service.connect('http://localhost:3000', 'bad-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onAuthError).toHaveBeenCalledTimes(1);
    expect(service.getConnectionStatus()).toBe('degraded');
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

    expect(fetchSpy).toHaveBeenCalledTimes(3);
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
    const errorCalls = (handler.onError as ReturnType<typeof vi.fn>).mock.calls;
    const finalError = errorCalls[errorCalls.length - 1][0];
    expect(finalError).toBeInstanceOf(ErrorEvent);
    expect(finalError.message).toContain('5 attempts');
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

  it('dispatches usage:delta events with backend field name mapping', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const backendDeltaData = JSON.stringify({
      seq: 1,
      timestamp: 1000,
      requestCount: 5,
      successCount: 4,
      failureCount: 1,
      tokenDelta: { input_tokens: 100, output_tokens: 50, reasoning_tokens: 10, cached_tokens: 20, total_tokens: 150 },
      details: [
        {
          timestamp: '2024-01-01T00:00:00Z',
          provider: 'openai',
          model: 'gpt-4',
          source: 'api',
          auth_index: '0',
          auth_type: 'api_key',
          endpoint: '/v1/chat/completions',
          request_id: 'req-123',
          latency_ms: 500,
          failed: false,
          tokens: { input_tokens: 100, output_tokens: 50, reasoning_tokens: 10, cached_tokens: 20, total_tokens: 150 },
        },
      ],
    });

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:delta\ndata:${backendDeltaData}\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onDelta).toHaveBeenCalledTimes(1);
    const delta = (handler.onDelta as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(delta.seq).toBe(1);
    expect(delta.tokenDelta.promptTokens).toBe(100);
    expect(delta.tokenDelta.completionTokens).toBe(50);
    expect(delta.tokenDelta.totalTokens).toBe(150);
    expect(delta.details).toHaveLength(1);
    expect(delta.details[0].model).toBe('gpt-4');
    expect(delta.details[0].success).toBe(true);
    expect(delta.details[0].tokens.prompt).toBe(100);
    expect(delta.details[0].tokens.completion).toBe(50);
    expect(delta.details[0].tokens.total).toBe(150);
  });

  it('maps backend failed:true to success:false in delta details', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const backendDeltaData = JSON.stringify({
      seq: 2,
      timestamp: 2000,
      requestCount: 1,
      successCount: 0,
      failureCount: 1,
      tokenDelta: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      details: [{ model: 'm1', source: 's1', failed: true, tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }],
    });

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:delta\ndata:${backendDeltaData}\n\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    const delta = (handler.onDelta as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(delta.details[0].success).toBe(false);
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
    await Promise.resolve();

    const errorCalls = (handler.onError as ReturnType<typeof vi.fn>).mock.calls;
    const parseError = errorCalls.find(
      (call) => call[0] instanceof ErrorEvent && (call[0] as ErrorEvent).message.includes('SSE parse error')
    );
    expect(parseError).toBeDefined();
    service.disconnect();
  });

  it('reports parse error on buffer overflow without crashing', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const overflowChunk = 'x'.repeat(SSE_BUFFER_MAX_SIZE + 1);

    fetchSpy.mockResolvedValue(createMockStreamResponse([overflowChunk]));

    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(handler.onError).toHaveBeenCalled();
    const calls = (handler.onError as ReturnType<typeof vi.fn>).mock.calls;
    const bufferOverflowCall = calls.find(
      (call) => call[0] instanceof ErrorEvent && (call[0] as ErrorEvent).message.includes('buffer overflow')
    );
    expect(bufferOverflowCall).toBeDefined();

    service.disconnect();
  });

  it('reconnects when stream ends', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    let resolveStream: () => void = () => {};
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event:usage:heartbeat\ndata:{}\n\n`));
        resolveStream = () => controller.close();
      },
    });
    fetchSpy.mockResolvedValue(new Response(readable, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(handler.onHeartbeat).toHaveBeenCalledTimes(1);
    expect(service.getConnectionStatus()).toBe('connected');

    resolveStream();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getConnectionStatus()).toBe('connecting');

    fetchSpy.mockResolvedValue(createMockStreamResponse([]));
    await vi.runOnlyPendingTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    service.disconnect();
  });

  it('sets connectionStatus to connecting when stream ends', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    let resolveStream: () => void = () => {};
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event:usage:heartbeat\ndata:{}\n\n`));
        resolveStream = () => controller.close();
      },
    });
    fetchSpy.mockResolvedValue(new Response(readable, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getConnectionStatus()).toBe('connected');

    resolveStream();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getConnectionStatus()).toBe('connecting');
    service.disconnect();
  });

  it('resets retry state on successful reconnection', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event:usage:heartbeat\ndata:{}\n\n`));
      },
    });
    fetchSpy.mockResolvedValue(new Response(readable, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
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

  it('handles CRLF line endings in SSE stream', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const heartbeatData = '{}';

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:heartbeat\r\ndata:${heartbeatData}\r\n\r\n`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('handles CR line endings in SSE stream', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    const heartbeatData = '{}';

    fetchSpy.mockResolvedValue(createMockStreamResponse([
      `event:usage:heartbeat\rdata:${heartbeatData}\r\r`,
    ]));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(handler.onHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('clears credentials on disconnect', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockReturnValue(new Promise(() => {}));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    service.disconnect();

    fetchSpy.mockResolvedValue(createMockStreamResponse([]));
    service.connect('http://localhost:3000', 'new-key', handler);

    await vi.runOnlyPendingTimersAsync();

    const calledUrl = fetchSpy.mock.calls[1][0] as string;
    expect(calledUrl).toContain('token=new-key');
    expect(calledUrl).not.toContain('test-key');
    service.disconnect();
  });

  it('requestFullCorrection clears lastEventId and reconnects', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    let resolveStream: () => void = () => {};
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event:usage:delta\nid:42\ndata:${JSON.stringify({ seq: 42, timestamp: 1000, tokenDelta: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, details: [] })}\n\n`));
        resolveStream = () => controller.close();
      },
    });
    fetchSpy.mockResolvedValue(new Response(readable, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(handler.onDelta).toHaveBeenCalledTimes(1);

    resolveStream();
    await Promise.resolve();
    await Promise.resolve();

    fetchSpy.mockResolvedValue(createMockStreamResponse([]));
    service.requestFullCorrection();

    await vi.runOnlyPendingTimersAsync();

    const correctionUrl = fetchSpy.mock.calls[1][0] as string;
    expect(correctionUrl).not.toContain('Last-Event-ID');
    service.disconnect();
  });

  it('notifies handler with error info on fetch error', async () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    fetchSpy.mockRejectedValue(new Error('Network error'));
    service.connect('http://localhost:3000', 'test-key', handler);

    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    const errorCalls = (handler.onError as ReturnType<typeof vi.fn>).mock.calls;
    const connectionError = errorCalls.find(
      (call) => call[0] instanceof ErrorEvent && (call[0] as ErrorEvent).message.includes('SSE connection error')
    );
    expect(connectionError).toBeDefined();
    expect((connectionError![0] as ErrorEvent).message).toContain('Network error');
    service.disconnect();
  });
});
