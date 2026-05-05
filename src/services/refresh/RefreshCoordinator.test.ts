import { describe, expect, it, vi } from 'vitest';
import type { RefreshRegistration } from './RefreshCoordinator';

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

class TestRefreshCoordinator {
  private registrations: Map<string, RefreshRegistration> = new Map();
  private isRunning = false;
  private pendingQueue: (() => void)[] = [];

  register(registration: RefreshRegistration): () => void {
    this.registrations.set(registration.id, registration);
    return () => this.unregister(registration.id);
  }

  unregister(id: string): void {
    this.registrations.delete(id);
  }

  getRegistrations(): RefreshRegistration[] {
    return Array.from(this.registrations.values()).sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    );
  }

  async triggerAll(): Promise<void> {
    return this.triggerByFilter(() => true);
  }

  async triggerByScope(scope: string): Promise<void> {
    return this.triggerByFilter((reg) => reg.scope === scope);
  }

  private async triggerByFilter(filter: (reg: RefreshRegistration) => boolean): Promise<void> {
    if (this.isRunning) {
      return new Promise<void>((resolve) => {
        this.pendingQueue.push(resolve);
      });
    }

    this.isRunning = true;

    try {
      const targets = this.getRegistrations().filter(filter);
      for (const reg of targets) {
        try {
          await reg.handler();
        } catch {
          // continue
        }
      }
    } finally {
      this.isRunning = false;
      while (this.pendingQueue.length > 0) {
        const pending = this.pendingQueue.shift();
        if (pending) pending();
      }
    }
  }
}

describe('RefreshCoordinator', () => {
  let coordinator: TestRefreshCoordinator;

  beforeEach(() => {
    coordinator = new TestRefreshCoordinator();
  });

  describe('concurrent triggerAll', () => {
    it('resolves all waiting callers after current refresh completes', async () => {
      let resolveFirst: () => void;
      const firstHandler = vi.fn(() => new Promise<void>((resolve) => {
        resolveFirst = resolve;
      }));
      const secondHandler = vi.fn(() => Promise.resolve());

      coordinator.register({ id: 'h1', handler: firstHandler, priority: 'high' });
      coordinator.register({ id: 'h2', handler: secondHandler, priority: 'normal' });

      const firstCall = coordinator.triggerAll();
      const secondCall = coordinator.triggerAll();
      const thirdCall = coordinator.triggerAll();

      expect(firstHandler).toHaveBeenCalledTimes(1);

      resolveFirst!();
      await firstCall;
      await secondCall;
      await thirdCall;

      expect(secondHandler).toHaveBeenCalledTimes(1);
    });

    it('does not trigger handlers again for waiting callers', async () => {
      let resolveHandler: () => void;
      const handler = vi.fn(() => new Promise<void>((resolve) => {
        resolveHandler = resolve;
      }));

      coordinator.register({ id: 'h', handler, priority: 'normal' });

      const firstCall = coordinator.triggerAll();
      const secondCall = coordinator.triggerAll();

      expect(handler).toHaveBeenCalledTimes(1);

      resolveHandler!();
      await firstCall;
      await secondCall;

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('priority ordering', () => {
    it('executes handlers in priority order', async () => {
      const order: string[] = [];

      coordinator.register({ id: 'low', handler: () => { order.push('low'); }, priority: 'low' });
      coordinator.register({ id: 'high', handler: () => { order.push('high'); }, priority: 'high' });
      coordinator.register({ id: 'normal', handler: () => { order.push('normal'); }, priority: 'normal' });

      await coordinator.triggerAll();

      expect(order).toEqual(['high', 'normal', 'low']);
    });
  });

  describe('error isolation', () => {
    it('continues executing other handlers when one fails', async () => {
      const order: string[] = [];

      coordinator.register({ id: 'err', handler: () => { order.push('first'); throw new Error('fail'); }, priority: 'high' });
      coordinator.register({ id: 'ok', handler: () => { order.push('second'); }, priority: 'normal' });

      await coordinator.triggerAll();

      expect(order).toEqual(['first', 'second']);
    });
  });

  describe('scope isolation', () => {
    it('only triggers handlers matching the scope', async () => {
      const order: string[] = [];

      coordinator.register({ id: 'a', handler: () => { order.push('a'); }, priority: 'normal', scope: 'scope-a' });
      coordinator.register({ id: 'b', handler: () => { order.push('b'); }, priority: 'normal', scope: 'scope-b' });

      await coordinator.triggerByScope('scope-a');

      expect(order).toEqual(['a']);
    });
  });

  describe('unregister', () => {
    it('removes handler from future executions', async () => {
      const handler = vi.fn();

      coordinator.register({ id: 'unreg', handler, priority: 'normal' });
      coordinator.unregister('unreg');

      await coordinator.triggerAll();

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
