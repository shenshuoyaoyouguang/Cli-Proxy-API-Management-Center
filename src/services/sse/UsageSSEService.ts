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

type ParsedSSEEvent = {
  eventType: string;
  id: string;
  data: string;
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

  connect(
    baseUrl: string,
    token: string,
    handler: UsageSSEHandler,
    options: UsageSSEConnectOptions = {}
  ): void {
    const { resetRetryState = true } = options;
    this.disconnect();
    this.handler = handler;
    this.baseUrl = baseUrl;
    this.token = token;
    if (resetRetryState) {
      this.resetRetryState();
    }

    this.connectionStatus = 'connecting';
    this.startFetchStream();
  }

  disconnect(): void {
    this.abortStream();
    this.handler = null;
    this.baseUrl = '';
    this.token = '';
    this.connectionStatus = 'disconnected';
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

  requestFullCorrection(): void {
    if (!this.handler || !this.baseUrl || !this.token) return;
    this.lastEventId = '';
    this.connect(this.baseUrl, this.token, this.handler);
  }

  private startFetchStream(): void {
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.sseBuffer = { value: '' };
    this.abortController = new AbortController();

    const url = new URL(`${this.baseUrl}${MANAGEMENT_API_PREFIX}/usage/stream`);
    url.searchParams.set('token', this.token);
    if (this.lastEventId) {
      url.searchParams.set('Last-Event-ID', this.lastEventId);
    }

    fetch(url.toString(), {
      headers: {
        Accept: 'text/event-stream',
      },
      signal: this.abortController.signal,
    })
      .then((response) => {
        this.isConnecting = false;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            this.handleAuthErrorEvent();
            return;
          }
          this.handleFetchError(new Error(`HTTP ${response.status}`));
          return;
        }

        this.resetRetryState();
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

  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    if (this.reconnectAttempts >= SSE_RECONNECT_MAX_ATTEMPTS) {
      this.connectionStatus = 'degraded';
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
