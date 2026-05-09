/**
 * 统一刷新协调器
 * 支持优先级队列执行、并发保护、scope 隔离注册
 */

export type RefreshPriority = 'high' | 'normal' | 'low';

export interface RefreshRegistration {
  id: string;
  handler: () => void | Promise<void>;
  priority: RefreshPriority;
  scope?: string;
}

export interface RefreshFailure {
  id: string;
  scope?: string;
  errorMessage: string;
}

export interface RefreshAggregateResult {
  total: number;
  succeeded: number;
  failed: number;
  failures: RefreshFailure[];
}

type PendingRefreshGroup = {
  key: string;
  filter: (reg: RefreshRegistration) => boolean;
  resolves: Array<(result: RefreshAggregateResult) => void>;
  rejects: Array<(error: unknown) => void>;
};

// ---------------------------------------------------------------------------
// 优先级顺序
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<RefreshPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

// ---------------------------------------------------------------------------
// RefreshCoordinator 单例
// ---------------------------------------------------------------------------

class RefreshCoordinatorImpl {
  private registrations: Map<string, RefreshRegistration> = new Map();
  private isRunning = false;
  /** 等待中的队列：按调用类型排队，相同 key 在队列中去重 */
  private pendingQueue: PendingRefreshGroup[] = [];

  /**
   * 注册刷新处理器
   * @returns 取消注册函数
   */
  register(registration: RefreshRegistration): () => void {
    this.registrations.set(registration.id, registration);

    return () => {
      this.unregister(registration.id);
    };
  }

  /**
   * 取消注册
   */
  unregister(id: string): void {
    this.registrations.delete(id);
  }

  /**
   * 获取所有注册项（按优先级排序）
   */
  getRegistrations(): RefreshRegistration[] {
    return Array.from(this.registrations.values()).sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    );
  }

  /**
   * 触发所有注册的刷新（MainLayout 刷新按钮调用）
   *
   * 并发保护语义：若当前已有刷新正在执行，后续调用者会等待当前刷新完成后被放行，
   * 而非触发新一轮刷新。调用方不应假设返回时数据已重新加载。
   */
  async triggerAll(): Promise<RefreshAggregateResult> {
    return this.triggerByFilter('all', () => true);
  }

  /**
   * 按 scope 触发刷新
   */
  async triggerByScope(scope: string): Promise<RefreshAggregateResult> {
    return this.triggerByFilter(`scope:${scope}`, (reg) => reg.scope === scope);
  }

  /**
   * 内部触发器：按过滤器筛选注册项，支持并发保护
   */
  private async triggerByFilter(
    key: string,
    filter: (reg: RefreshRegistration) => boolean
  ): Promise<RefreshAggregateResult> {
    if (this.isRunning) {
      return new Promise<RefreshAggregateResult>((resolve, reject) => {
        const existing = this.pendingQueue.find((item) => item.key === key);
        if (existing) {
          existing.resolves.push(resolve);
          existing.rejects.push(reject);
          return;
        }
        this.pendingQueue.push({
          key,
          filter,
          resolves: [resolve],
          rejects: [reject],
        });
      });
    }

    this.isRunning = true;
    try {
      return await this.executeFilter(filter);
    } finally {
      this.isRunning = false;
      this.flushPendingQueue();
    }
  }

  private async executeFilter(
    filter: (reg: RefreshRegistration) => boolean
  ): Promise<RefreshAggregateResult> {
    const targets = this.getRegistrations().filter(filter);
    const failures: RefreshFailure[] = [];
    let succeeded = 0;

    for (const reg of targets) {
      try {
        await reg.handler();
        succeeded += 1;
      } catch (error: unknown) {
        failures.push({
          id: reg.id,
          scope: reg.scope,
          errorMessage:
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : 'Unknown refresh error',
        });
      }
    }

    return {
      total: targets.length,
      succeeded,
      failed: failures.length,
      failures,
    };
  }

  private flushPendingQueue() {
    if (this.isRunning || this.pendingQueue.length === 0) {
      return;
    }

    const next = this.pendingQueue.shift();
    if (!next) {
      return;
    }

    this.isRunning = true;
    void this.executeFilter(next.filter)
      .then((result) => {
        next.resolves.forEach((resolve) => resolve(result));
      })
      .catch((error) => {
        next.rejects.forEach((reject) => reject(error));
      })
      .finally(() => {
        this.isRunning = false;
        this.flushPendingQueue();
      });
  }
}

export const RefreshCoordinator = new RefreshCoordinatorImpl();
