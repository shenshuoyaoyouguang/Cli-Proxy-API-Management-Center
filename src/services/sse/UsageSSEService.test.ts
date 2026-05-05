import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSSEHandler } from '@/types/sse';
import { SSE_RECONNECT_MAX_ATTEMPTS, UsageSSEServiceImpl } from './UsageSSEService';

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  readyState = MockEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(): void {
    // These tests only exercise reconnect behavior through onopen/onerror.
  }

  emitOpen(): void {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  emitError(): void {
    this.onerror?.(new Event('error'));
  }

  static latest(): MockEventSource {
    const instance = MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!instance) {
      throw new Error('Expected an EventSource instance to exist');
    }
    return instance;
  }

  static reset(): void {
    MockEventSource.instances = [];
  }
}

const createHandler = (): UsageSSEHandler => ({
  onDelta: vi.fn(),
  onFull: vi.fn(),
  onHeartbeat: vi.fn(),
  onError: vi.fn(),
  onAuthError: vi.fn(),
});

describe('UsageSSEService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps retry counters across scheduled reconnects until the service degrades', () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    service.connect('http://localhost:3000', 'management-key', handler);
    MockEventSource.latest().emitOpen();

    for (let attempt = 0; attempt < SSE_RECONNECT_MAX_ATTEMPTS; attempt += 1) {
      const current = MockEventSource.latest();
      current.readyState = MockEventSource.CLOSED;
      current.emitError();
      vi.runOnlyPendingTimers();
    }

    const finalAttempt = MockEventSource.latest();
    finalAttempt.readyState = MockEventSource.CLOSED;
    finalAttempt.emitError();

    expect(service.getConnectionStatus()).toBe('degraded');
    expect(handler.onError).toHaveBeenCalledTimes(1);
    expect(handler.onAuthError).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(SSE_RECONNECT_MAX_ATTEMPTS + 1);
  });

  it('resets retry state after a successful reopen', () => {
    const service = new UsageSSEServiceImpl();
    const handler = createHandler();

    service.connect('http://localhost:3000', 'management-key', handler);
    MockEventSource.latest().emitOpen();

    const firstClosedStream = MockEventSource.latest();
    firstClosedStream.readyState = MockEventSource.CLOSED;
    firstClosedStream.emitError();
    vi.runOnlyPendingTimers();

    const reopenedStream = MockEventSource.latest();
    reopenedStream.emitOpen();
    reopenedStream.readyState = MockEventSource.CLOSED;
    reopenedStream.emitError();
    vi.runOnlyPendingTimers();

    expect(service.getConnectionStatus()).toBe('connecting');
    expect(handler.onError).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(3);
  });
});
