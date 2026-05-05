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
export const SSE_DEGRADED_RECONNECT_INTERVAL_MS = 300000;
export const SSE_POLLING_INTERVAL_MS = 60000;
const SSE_AUTH_ERROR_EVENT = 'usage:auth-error';

type UsageSSEConnectOptions = {
  resetRetryState?: boolean;
};

export class UsageSSEServiceImpl {
  private source: EventSource | null = null;
  private handler: UsageSSEHandler | null = null;
  private reconnectAttempts = 0;
  private connectionStatus: UsageSSEConnectionStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrorCount = 0;
  private baseUrl = '';
  private token = '';

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

    const url = `${baseUrl}${MANAGEMENT_API_PREFIX}/usage/stream?token=${encodeURIComponent(token)}`;
    this.source = new EventSource(url);
    this.connectionStatus = 'connecting';
    this.setupEventListeners();
  }

  disconnect(): void {
    this.closeSource();
    this.handler = null;
    this.connectionStatus = 'disconnected';
  }

  private closeSource(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  getConnectionStatus(): UsageSSEConnectionStatus {
    return this.connectionStatus;
  }

  requestFullCorrection(): void {
    if (!this.handler || !this.baseUrl || !this.token) return;
    this.connect(this.baseUrl, this.token, this.handler);
  }

  private setupEventListeners(): void {
    if (!this.source || !this.handler) return;

    this.source.addEventListener('usage:delta', (e: MessageEvent) => {
      this.handleDeltaEvent(e);
    });

    this.source.addEventListener('usage:full', (e: MessageEvent) => {
      this.handleFullEvent(e);
    });

    this.source.addEventListener('usage:heartbeat', () => {
      this.handleHeartbeatEvent();
    });

    this.source.addEventListener(SSE_AUTH_ERROR_EVENT, () => {
      this.handleAuthErrorEvent();
    });

    this.source.onopen = () => {
      this.resetRetryState();
      this.connectionStatus = 'connected';
    };

    this.source.onerror = (e: Event) => {
      this.handleErrorEvent(e);
    };
  }

  private handleDeltaEvent(e: MessageEvent): void {
    try {
      const data = JSON.parse(e.data) as UsageDeltaEvent;
      this.resetRetryState();
      this.connectionStatus = 'connected';
      this.handler?.onDelta(data);
    } catch {
      this.handler?.onError(e);
    }
  }

  private handleFullEvent(e: MessageEvent): void {
    try {
      const data = JSON.parse(e.data) as UsageFullEvent;
      this.resetRetryState();
      this.connectionStatus = 'connected';
      this.handler?.onFull(data);
    } catch {
      this.handler?.onError(e);
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

  private handleErrorEvent(e: Event): void {
    if (!this.source) return;

    this.consecutiveErrorCount++;

    if (this.source.readyState === EventSource.CLOSED) {
      if (this.reconnectAttempts === 0 && this.connectionStatus === 'connecting') {
        // A first-connection close is often caused by an older backend or an unavailable
        // optional SSE endpoint. Treat it as a transport capability issue and fall back
        // to polling instead of forcing a global logout.
        this.closeSource();
        this.connectionStatus = 'degraded';
        this.handler?.onError(e);
        return;
      }
      this.scheduleReconnect(e);
      return;
    }

    if (this.source.readyState === EventSource.CONNECTING) {
      if (this.consecutiveErrorCount > SSE_RECONNECT_MAX_ATTEMPTS * 2) {
        this.connectionStatus = 'degraded';
        this.handler?.onError(e);
      }
    }
  }

  private scheduleReconnect(errorEvent: Event): void {
    this.reconnectAttempts++;

    if (this.reconnectAttempts > SSE_RECONNECT_MAX_ATTEMPTS) {
      this.connectionStatus = 'degraded';
      this.handler?.onError(errorEvent);
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
    this.consecutiveErrorCount = 0;
  }

  private computeReconnectDelay(): number {
    return Math.min(
      SSE_RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      SSE_RECONNECT_MAX_DELAY_MS
    );
  }
}

export const usageSSEService = new UsageSSEServiceImpl();
