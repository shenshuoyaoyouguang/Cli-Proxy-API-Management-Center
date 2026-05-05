import type {
  UsageSSEConnectionStatus,
  UsageSSEHandler,
  UsageDeltaEvent,
  UsageFullEvent,
} from '@/types/sse';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';

export const SSE_RECONNECT_MAX_ATTEMPTS = 5;
export const SSE_RECONNECT_BASE_DELAY_MS = 1000;
export const SSE_RECONNECT_MAX_DELAY_MS = 30000;
const SSE_AUTH_ERROR_EVENT = 'usage:auth-error';

type UsageSSEConnectOptions = {
  resetRetryState?: boolean;
};

type ParsedSSEEvent = {
  eventType: string;
  data: string;
};

function parseSSELines(chunk: string, buffer: { value: string }): ParsedSSEEvent[] {
  buffer.value += chunk;
  const events: ParsedSSEEvent[] = [];
  let eventType = 'message';
  let data = '';

  const lines = buffer.value.split('\n');
  const lastLine = lines.pop()!;
  buffer.value = lastLine;

  for (const line of lines) {
    if (line === '') {
      if (data !== '') {
        events.push({ eventType, data });
        eventType = 'message';
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
    } else if (field === 'data') {
      if (data !== '') {
        data += '\n';
      }
      data += value;
    }
  }

  return events;
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
    this.connect(this.baseUrl, this.token, this.handler);
  }

  private startFetchStream(): void {
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.sseBuffer = { value: '' };
    this.abortController = new AbortController();

    const url = `${this.baseUrl}${MANAGEMENT_API_PREFIX}/usage/stream`;

    fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
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
        const events = parseSSELines(chunk, this.sseBuffer);
        for (const event of events) {
          this.dispatchSSEEvent(event);
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
      case SSE_AUTH_ERROR_EVENT:
        this.handleAuthErrorEvent();
        break;
      default:
        break;
    }
  }

  private handleDeltaEvent(rawData: string): void {
    try {
      const data = JSON.parse(rawData) as UsageDeltaEvent;
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
    const handler = this.handler;
    this.disconnect();
    handler?.onAuthError();
  }

  private handleFetchError(_error: unknown): void {
    this.scheduleReconnect();
  }

  private handleStreamEnd(): void {
    if (this.connectionStatus === 'disconnected') return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    if (this.reconnectAttempts > SSE_RECONNECT_MAX_ATTEMPTS) {
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
