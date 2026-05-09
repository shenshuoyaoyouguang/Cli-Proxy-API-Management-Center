import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshCoordinator } from './RefreshCoordinator';

const resetCoordinator = () => {
  const coordinator = RefreshCoordinator as unknown as {
    registrations: Map<string, unknown>;
    isRunning: boolean;
    pendingQueue: unknown[];
  };

  coordinator.registrations = new Map();
  coordinator.isRunning = false;
  coordinator.pendingQueue = [];
};

describe('RefreshCoordinator', () => {
  beforeEach(() => {
    resetCoordinator();
  });

  describe('concurrent triggerAll', () => {
    it('deduplicates waiting global refreshes into one follow-up run and resolves callers with their own result', async () => {
      let resolveFirst!: () => void;
      const firstHandler = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockResolvedValue(undefined);
      const secondHandler = vi.fn().mockResolvedValue(undefined);

      RefreshCoordinator.register({ id: 'h1', handler: firstHandler, priority: 'high' });
      RefreshCoordinator.register({ id: 'h2', handler: secondHandler, priority: 'normal' });

      const firstCall = RefreshCoordinator.triggerAll();
      const secondCall = RefreshCoordinator.triggerAll();
      const thirdCall = RefreshCoordinator.triggerAll();

      expect(firstHandler).toHaveBeenCalledTimes(1);

      resolveFirst();

      const firstResult = await firstCall;
      const secondResult = await secondCall;
      const thirdResult = await thirdCall;

      expect(firstHandler).toHaveBeenCalledTimes(2);
      expect(secondHandler).toHaveBeenCalledTimes(2);
      expect(firstResult).toEqual({
        total: 2,
        succeeded: 2,
        failed: 0,
        failures: [],
      });
      expect(secondResult).toEqual(firstResult);
      expect(thirdResult).toEqual(firstResult);
    });

    it('returns the queued run aggregate result instead of reusing the in-flight result', async () => {
      let resolveFirst!: () => void;
      const handler = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockImplementationOnce(() => {
          throw new Error('queued-fail');
        });

      RefreshCoordinator.register({ id: 'h1', handler, priority: 'normal' });

      const firstCall = RefreshCoordinator.triggerAll();
      const secondCall = RefreshCoordinator.triggerAll();

      resolveFirst();

      const firstResult = await firstCall;
      const secondResult = await secondCall;

      expect(handler).toHaveBeenCalledTimes(2);
      expect(firstResult).toEqual({
        total: 1,
        succeeded: 1,
        failed: 0,
        failures: [],
      });
      expect(secondResult).toEqual({
        total: 1,
        succeeded: 0,
        failed: 1,
        failures: [
          {
            id: 'h1',
            scope: undefined,
            errorMessage: 'queued-fail',
          },
        ],
      });
    });
  });

  describe('scope isolation', () => {
    it('returns scope-specific results when different scope refreshes queue behind each other', async () => {
      let resolveScopeA!: () => void;
      const scopeAHandler = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveScopeA = resolve;
            })
        )
        .mockResolvedValue(undefined);
      const scopeBHandler = vi.fn().mockResolvedValue(undefined);

      RefreshCoordinator.register({
        id: 'scope-a',
        handler: scopeAHandler,
        priority: 'normal',
        scope: 'scope-a',
      });
      RefreshCoordinator.register({
        id: 'scope-b',
        handler: scopeBHandler,
        priority: 'normal',
        scope: 'scope-b',
      });

      const firstCall = RefreshCoordinator.triggerByScope('scope-a');
      const secondCall = RefreshCoordinator.triggerByScope('scope-b');

      resolveScopeA();

      const firstResult = await firstCall;
      const secondResult = await secondCall;

      expect(scopeAHandler).toHaveBeenCalledTimes(1);
      expect(scopeBHandler).toHaveBeenCalledTimes(1);
      expect(firstResult).toEqual({
        total: 1,
        succeeded: 1,
        failed: 0,
        failures: [],
      });
      expect(secondResult).toEqual({
        total: 1,
        succeeded: 1,
        failed: 0,
        failures: [],
      });
    });
  });

  describe('priority ordering', () => {
    it('executes handlers in priority order', async () => {
      const order: string[] = [];

      RefreshCoordinator.register({ id: 'low', handler: () => { order.push('low'); }, priority: 'low' });
      RefreshCoordinator.register({ id: 'high', handler: () => { order.push('high'); }, priority: 'high' });
      RefreshCoordinator.register({ id: 'normal', handler: () => { order.push('normal'); }, priority: 'normal' });

      const result = await RefreshCoordinator.triggerAll();

      expect(order).toEqual(['high', 'normal', 'low']);
      expect(result).toEqual({
        total: 3,
        succeeded: 3,
        failed: 0,
        failures: [],
      });
    });
  });

  describe('error isolation', () => {
    it('continues executing other handlers when one fails and reports the failure in the aggregate result', async () => {
      const order: string[] = [];

      RefreshCoordinator.register({ id: 'err', handler: () => { order.push('first'); throw new Error('fail'); }, priority: 'high' });
      RefreshCoordinator.register({ id: 'ok', handler: () => { order.push('second'); }, priority: 'normal' });

      const result = await RefreshCoordinator.triggerAll();

      expect(order).toEqual(['first', 'second']);
      expect(result).toEqual({
        total: 2,
        succeeded: 1,
        failed: 1,
        failures: [
          {
            id: 'err',
            scope: undefined,
            errorMessage: 'fail',
          },
        ],
      });
    });
  });

  describe('unregister', () => {
    it('removes handler from future executions', async () => {
      const handler = vi.fn();

      RefreshCoordinator.register({ id: 'unreg', handler, priority: 'normal' });
      RefreshCoordinator.unregister('unreg');

      const result = await RefreshCoordinator.triggerAll();

      expect(handler).not.toHaveBeenCalled();
      expect(result.total).toBe(0);
    });
  });
});
