import type {
  UsageSSEConnectionStatus,
  UsageSSEHandler,
  UsageDeltaEvent,
  UsageFullEvent,
  UsageModelBreakdownItem,
  UsageTokenDelta,
} from '@/types/sse';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';

export const SSE_RECONNECT_MAX_ATTEMPTS = 5;
export const SSE_RECONNECT_BASE_DELAY_MS = 1000;
export const SSE_RECONNECT_MAX_DELAY_MS = 30000;
export const SSE_BUFFER_MAX_SIZE = 1_048_576;

type UsageSSEConnectOptions = {
  resetRetryState?: boolean;
};

type UsageSSEAuthMode = 'header' | 'query';

type UsageFullSnapshotOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

type ParsedSSEEvent = {
  eventType: string;
  id: string;
  data: string;
};

type PendingFullSnapshotWaiter = {
  resolve: (data: UsageFullEvent) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  signal?: AbortSignal;
  abortListener?: (() => void) | null;
};

function parseSSELines(chunk: string, buffer: { value: string }): ParsedSSEEvent[] {
  try {
    buffer.value += chunk;

    if (buffer.value.length > SSE_BUFFER_MAX_SIZE) {
      buffer.value = '';
      throw new Error('SSE buffer overflow: max size exceeded');
    }

    const events: ParsedSSEEvent[] = [];
    let eventType = 'message';
    let id = '';
    let data = '';

    const lines = buffer.value.split(/\r\n|\n|\r/);
    const lastLine = lines.pop()!;
    buffer.value = lastLine;

    for (const line of lines) {
      if (line === '') {
        if (data !== '') {
          events.push({ eventType, id, data });
          eventType = 'message';
          id = '';
          data = '';
        }
        continue;
      }
      if (line.startsWith(':')) {
        continue;
      }
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) {
        continue;
      }
      const field = line.slice(0, colonIndex);
      const value = line.slice(colonIndex + 1).replace(/^ /, '');
      if (field === 'event') {
        eventType = value;
      } else if (field === 'id') {
        id = value;
      } else if (field === 'data') {
        if (data !== '') {
          data += '\n';
        }
        data += value;
      }
    }

    return events;
  } catch (err) {
    buffer.value = '';
    throw err;
  }
}

type RawTokenDelta = {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
};

type RawDeltaDetail = {
  timestamp?: string | number;
  provider?: string;
  model?: string;
  source?: string;
  auth_index?: string;
  auth_type?: string;
  endpoint?: string;
  request_id?: string;
  latency_ms?: number;
  failed?: boolean;
  tokens?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cached_tokens?: number;
    total_tokens?: number;
  };
};

type RawDeltaPayload = {
  seq?: number;
  timestamp?: number;
  requestCount?: number;
  successCount?: number;
  failureCount?: number;
  tokenDelta?: RawTokenDelta;
  details?: RawDeltaDetail[];
  modelBreakdown?: RawModelBreakdown[];
};

type RawModelBreakdown = {
  endpoint?: string;
  model?: string;
  requestCount?: number;
  request_count?: number;
  successCount?: number;
  success_count?: number;
  failureCount?: number;
  failure_count?: number;
  tokenDelta?: RawTokenDelta;
  token_delta?: RawTokenDelta;
};

function normalizeStringValue(value: unknown, fallback = ''): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

function mapTokenDelta(raw?: RawTokenDelta): UsageTokenDelta {
  return {
    promptTokens: raw?.input_tokens ?? 0,
    completionTokens: raw?.output_tokens ?? 0,
    reasoningTokens: raw?.reasoning_tokens ?? 0,
    cachedTokens: raw?.cached_tokens ?? 0,
    totalTokens: raw?.total_tokens ?? 0,
  };
}

function mapModelBreakdownItem(raw: RawModelBreakdown): UsageModelBreakdownItem {
  return {
    endpoint: normalizeStringValue(raw.endpoint, 'unknown'),
    model: normalizeStringValue(raw.model, 'unknown'),
    requestCount: raw.requestCount ?? raw.request_count ?? 0,
    successCount: raw.successCount ?? raw.success_count ?? 0,
    failureCount: raw.failureCount ?? raw.failure_count ?? 0,
    tokenDelta: mapTokenDelta(raw.tokenDelta ?? raw.token_delta),
  };
}

function mapDeltaEvent(raw: RawDeltaPayload): UsageDeltaEvent {
  const modelBreakdown = Array.isArray(raw.modelBreakdown)
    ? raw.modelBreakdown.map(mapModelBreakdownItem)
    : undefined;

  return {
    seq: raw.seq ?? 0,
    timestamp: raw.timestamp ?? 0,
    requestCount: raw.requestCount ?? 0,
    successCount: raw.successCount ?? 0,
    failureCount: raw.failureCount ?? 0,
    tokenDelta: mapTokenDelta(raw.tokenDelta),
    details: (raw.details ?? []).map((d) => {
      const tk = d.tokens ?? {};
      return {
        model: normalizeStringValue(d.model, 'unknown'),
        source: d.source ?? '',
        timestamp: typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp ?? 0).getTime(),
        success: !d.failed,
        tokens: {
          prompt: tk.input_tokens ?? 0,
          completion: tk.output_tokens ?? 0,
          reasoning: tk.reasoning_tokens ?? 0,
          cached: tk.cached_tokens ?? 0,
          total: tk.total_tokens ?? 0,
        },
      };
    }),
    modelBreakdown,
  };
}

function buildConnectionKey(baseUrl: string, token: string): string {
  return `${baseUrl}::${token}`;
}

export class UsageSSEServiceImpl {
  private handler: UsageSSEHandler | null = null;
  private reconnectAttempts = 0;
  private connectionStatus: UsageSSEConnectionStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private baseUrl = '';
  private token = '';
  private abortController: AbortController | null = null;
  private sseBuffer = { value: '' };
  private isConnecting = false;
  private lastEventId = '';
  private authMode: UsageSSEAuthMode = 'header';
  private hasTriedQueryFallback = false;
  private pendingFullSnapshotWaiters: PendingFullSnapshotWaiter[] = [];

  connect(
    baseUrl: string,
    token: string,
    handler: UsageSSEHandler,
    options: UsageSSEConnectOptions = {}
  ): void {
    const { resetRetryState = true } = options;
    const nextConnectionKey = buildConnectionKey(baseUrl, token);
    if (nextConnectionKey !== this.getCurrentConnectionKey()) {
      this.rejectPendingFullSnapshotWaiters(new Error('Usage SSE connection target changed'));
    }
    this.abortStream();
    this.handler = handler;
    this.baseUrl = baseUrl;
    this.token = token;
    if (resetRetryState) {
      this.resetRetryState();
      this.authMode = 'header';
      this.hasTriedQueryFallback = false;
    }

    this.connectionStatus = 'connecting';
    this.startFetchStream();
  }

  disconnect(): void {
    this.abortStream();
    this.rejectPendingFullSnapshotWaiters(new Error('Usage SSE disconnected'));
    this.handler = null;
    this.baseUrl = '';
    this.token = '';
    this.connectionStatus = 'disconnected';
    this.authMode = 'header';
    this.hasTriedQueryFallback = false;
  }

  private abortStream(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isConnecting = false;
  }

  getConnectionStatus(): UsageSSEConnectionStatus {
    return this.connectionStatus;
  }

  async awaitFullSnapshot(
    baseUrl: string,
    token: string,
    options: UsageFullSnapshotOptions = {}
  ): Promise<UsageFullEvent> {
    if (this.hasActiveConnection(baseUrl, token)) {
      return this.waitForLiveFullSnapshot(options);
    }

    return this.fetchFullSnapshotOnce(baseUrl, token, options);
  }

  requestFullCorrection(): void {
    if (!this.handler || !this.baseUrl || !this.token) return;
    this.lastEventId = '';
    this.connect(this.baseUrl, this.token, this.handler);
  }

  private getCurrentConnectionKey(): string {
    if (!this.baseUrl || !this.token) {
      return '';
    }
    return buildConnectionKey(this.baseUrl, this.token);
  }

  private hasActiveConnection(baseUrl: string, token: string): boolean {
    if (!this.handler) {
      return false;
    }

    const currentConnectionKey = this.getCurrentConnectionKey();
    if (!currentConnectionKey || currentConnectionKey !== buildConnectionKey(baseUrl, token)) {
      return false;
    }

    return this.connectionStatus === 'connecting' || this.connectionStatus === 'connected';
  }

  private waitForLiveFullSnapshot(options: UsageFullSnapshotOptions): Promise<UsageFullEvent> {
    const { signal, timeoutMs = 5000 } = options;

    if (signal?.aborted) {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    return new Promise<UsageFullEvent>((resolve, reject) => {
      const waiter: PendingFullSnapshotWaiter = {
        resolve,
        reject,
        timeoutId: null,
        signal,
        abortListener: null,
      };

      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        waiter.timeoutId = setTimeout(() => {
          this.removePendingFullSnapshotWaiter(waiter);
          reject(new Error(`Timed out waiting for usage:full after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      if (signal) {
        waiter.abortListener = () => {
          this.removePendingFullSnapshotWaiter(waiter);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.abortListener, { once: true });
      }

      this.pendingFullSnapshotWaiters.push(waiter);
    });
  }

  private removePendingFullSnapshotWaiter(waiter: PendingFullSnapshotWaiter): void {
    const index = this.pendingFullSnapshotWaiters.indexOf(waiter);
    if (index >= 0) {
      this.pendingFullSnapshotWaiters.splice(index, 1);
    }
    if (waiter.timeoutId !== null) {
      clearTimeout(waiter.timeoutId);
      waiter.timeoutId = null;
    }
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
      waiter.abortListener = null;
    }
  }

  private resolvePendingFullSnapshotWaiters(snapshot: UsageFullEvent): void {
    if (this.pendingFullSnapshotWaiters.length === 0) {
      return;
    }

    const waiters = [...this.pendingFullSnapshotWaiters];
    this.pendingFullSnapshotWaiters = [];
    waiters.forEach((waiter) => {
      if (waiter.timeoutId !== null) {
        clearTimeout(waiter.timeoutId);
      }
      if (waiter.signal && waiter.abortListener) {
        waiter.signal.removeEventListener('abort', waiter.abortListener);
      }
      waiter.resolve(snapshot);
    });
  }

  private rejectPendingFullSnapshotWaiters(error: Error): void {
    if (this.pendingFullSnapshotWaiters.length === 0) {
      return;
    }

    const waiters = [...this.pendingFullSnapshotWaiters];
    this.pendingFullSnapshotWaiters = [];
    waiters.forEach((waiter) => {
      if (waiter.timeoutId !== null) {
        clearTimeout(waiter.timeoutId);
      }
      if (waiter.signal && waiter.abortListener) {
        waiter.signal.removeEventListener('abort', waiter.abortListener);
      }
      waiter.reject(error);
    });
  }

  private async fetchFullSnapshotOnce(
    baseUrl: string,
    token: string,
    options: UsageFullSnapshotOptions
  ): Promise<UsageFullEvent> {
    const { signal, timeoutMs = 5000 } = options;
    const response = await this.fetchSnapshotStreamResponse(baseUrl, token, signal);
    const deadline =
      typeof timeoutMs === 'number' && timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No readable stream');
      }

      const decoder = new TextDecoder();
      const buffer = { value: '' };

      try {
        while (true) {
          const remainingMs = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0;
          const { done, value } = await this.readChunkWithDeadline(reader, signal, remainingMs);
          if (done) {
            break;
          }

          const events = parseSSELines(decoder.decode(value, { stream: true }), buffer);
          for (const event of events) {
            if (event.eventType !== 'usage:full') {
              continue;
            }
            const snapshot = JSON.parse(event.data) as UsageFullEvent;
            await reader.cancel();
            return snapshot;
          }
        }
      } finally {
        reader.releaseLock();
      }

      throw new Error('Usage stream ended before usage:full');
  }

  private async readChunkWithDeadline(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal | undefined,
    remainingMs: number
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    if (remainingMs <= 0) {
      void reader.cancel();
      throw new Error('Timed out waiting for usage:full after 0ms');
    }

    return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let abortListener: (() => void) | null = null;

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (signal && abortListener) {
          signal.removeEventListener('abort', abortListener);
          abortListener = null;
        }
      };

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };

      timeoutId = setTimeout(() => {
        void reader.cancel();
        finish(() => reject(new Error(`Timed out waiting for usage:full after ${remainingMs}ms`)));
      }, remainingMs);

      if (signal) {
        abortListener = () => {
          void reader.cancel();
          finish(() => reject(new DOMException('The operation was aborted.', 'AbortError')));
        };
        signal.addEventListener('abort', abortListener, { once: true });
      }

      reader.read().then(
        (result) => {
          finish(() => resolve(result));
        },
        (error) => {
          finish(() => reject(error));
        }
      );
    });
  }

  private async fetchSnapshotStreamResponse(
    baseUrl: string,
    token: string,
    signal?: AbortSignal
  ): Promise<Response> {
    const attempt = async (authMode: UsageSSEAuthMode): Promise<Response> => {
      const url = new URL(`${baseUrl}${MANAGEMENT_API_PREFIX}/usage/stream`);
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
      };

      if (authMode === 'query') {
        url.searchParams.set('token', token);
      } else {
        headers.Authorization = `Bearer ${token}`;
      }

      return fetch(url.toString(), {
        headers,
        signal,
      });
    };

    const headerResponse = await attempt('header');
    if (headerResponse.ok) {
      return headerResponse;
    }

    if (headerResponse.status === 401 || headerResponse.status === 403) {
      const queryResponse = await attempt('query');
      if (queryResponse.ok) {
        return queryResponse;
      }
      throw new Error(`HTTP ${queryResponse.status}`);
    }

    throw new Error(`HTTP ${headerResponse.status}`);
  }

  private startFetchStream(): void {
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.sseBuffer = { value: '' };
    this.abortController = new AbortController();

    const url = new URL(`${this.baseUrl}${MANAGEMENT_API_PREFIX}/usage/stream`);
    if (this.authMode === 'query') {
      url.searchParams.set('token', this.token);
    }
    if (this.lastEventId) {
      url.searchParams.set('Last-Event-ID', this.lastEventId);
    }

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    };
    if (this.authMode === 'header') {
      headers.Authorization = `Bearer ${this.token}`;
    }

    fetch(url.toString(), {
      headers,
      signal: this.abortController.signal,
    })
      .then((response) => {
        this.isConnecting = false;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (this.shouldRetryWithLegacyQueryAuth()) {
              this.connectionStatus = 'connecting';
              this.startFetchStream();
              return;
            }
            this.handleAuthErrorEvent();
            return;
          }
          this.handleFetchError(new Error(`HTTP ${response.status}`));
          return;
        }

        this.resetRetryState();
        this.hasTriedQueryFallback = false;
        this.connectionStatus = 'connected';

        const reader = response.body?.getReader();
        if (!reader) {
          this.handleFetchError(new Error('No readable stream'));
          return;
        }

        this.readStream(reader);
      })
      .catch((error: unknown) => {
        this.isConnecting = false;
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        this.handleFetchError(error);
      });
  }

  private async readStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.handleStreamEnd();
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        try {
          const events = parseSSELines(chunk, this.sseBuffer);
          for (const event of events) {
            if (event.id) {
              this.lastEventId = event.id;
            }
            this.dispatchSSEEvent(event);
          }
        } catch (parseErr) {
          this.handler?.onError(new ErrorEvent('error', { message: `SSE parse error: ${(parseErr as Error).message}` }));
          this.scheduleReconnect();
          return;
        }
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.handleFetchError(error);
    }
  }

  private dispatchSSEEvent(event: ParsedSSEEvent): void {
    switch (event.eventType) {
      case 'usage:delta':
        this.handleDeltaEvent(event.data);
        break;
      case 'usage:full':
        this.handleFullEvent(event.data);
        break;
      case 'usage:heartbeat':
        this.handleHeartbeatEvent();
        break;
      default:
        break;
    }
  }

  private handleDeltaEvent(rawData: string): void {
    try {
      const raw = JSON.parse(rawData) as RawDeltaPayload;
      const data = mapDeltaEvent(raw);
      this.resetRetryState();
      this.connectionStatus = 'connected';
      this.handler?.onDelta(data);
    } catch (err) {
      this.handler?.onError(new ErrorEvent('error', { message: `SSE parse error: ${(err as Error).message}` }));
    }
  }

  private handleFullEvent(rawData: string): void {
    try {
      const data = JSON.parse(rawData) as UsageFullEvent;
      this.resetRetryState();
      this.connectionStatus = 'connected';
      this.resolvePendingFullSnapshotWaiters(data);
      this.handler?.onFull(data);
    } catch (err) {
      this.handler?.onError(new ErrorEvent('error', { message: `SSE parse error: ${(err as Error).message}` }));
    }
  }

  private handleHeartbeatEvent(): void {
    this.resetRetryState();
    this.connectionStatus = 'connected';
    this.handler?.onHeartbeat();
  }

  private handleAuthErrorEvent(): void {
    this.abortStream();
    this.connectionStatus = 'degraded';
    this.rejectPendingFullSnapshotWaiters(new Error('Usage SSE authentication failed'));
    this.handler?.onAuthError();
  }

  private handleFetchError(error: unknown): void {
    this.connectionStatus = 'connecting';
    this.handler?.onError(new ErrorEvent('error', {
      message: `SSE connection error (attempt ${this.reconnectAttempts + 1}/${SSE_RECONNECT_MAX_ATTEMPTS}): ${error instanceof Error ? error.message : String(error)}`,
    }));
    this.scheduleReconnect();
  }

  private handleStreamEnd(): void {
    if (this.connectionStatus === 'disconnected') return;
    this.connectionStatus = 'connecting';
    this.scheduleReconnect();
  }

  private shouldRetryWithLegacyQueryAuth(): boolean {
    if (this.authMode !== 'header' || this.hasTriedQueryFallback) {
      return false;
    }

    this.hasTriedQueryFallback = true;
    this.authMode = 'query';
    return true;
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    if (this.reconnectAttempts >= SSE_RECONNECT_MAX_ATTEMPTS) {
      this.connectionStatus = 'degraded';
      this.rejectPendingFullSnapshotWaiters(
        new Error(`SSE reconnect failed after ${SSE_RECONNECT_MAX_ATTEMPTS} attempts`)
      );
      this.handler?.onError(new ErrorEvent('error', { message: `SSE reconnect failed after ${SSE_RECONNECT_MAX_ATTEMPTS} attempts` }));
      return;
    }

    const delay = this.computeReconnectDelay();
    this.reconnectTimer = setTimeout(() => {
      if (this.handler && this.baseUrl && this.token) {
        this.connect(this.baseUrl, this.token, this.handler, { resetRetryState: false });
      }
    }, delay);
  }

  private resetRetryState(): void {
    this.reconnectAttempts = 0;
  }

  private computeReconnectDelay(): number {
    const base = SSE_RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = base * (0.5 + Math.random() * 0.5);
    return Math.min(jitter, SSE_RECONNECT_MAX_DELAY_MS);
  }
}

export const usageSSEService = new UsageSSEServiceImpl();
