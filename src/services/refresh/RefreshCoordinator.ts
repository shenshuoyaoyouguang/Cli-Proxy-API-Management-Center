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
  /** 等待中的队列：触发请求在刷新期间入队，刷新完成后执行 */
  private pendingQueue: (() => void)[] = [];

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
   */
  async triggerAll(): Promise<void> {
    return this.triggerByFilter(() => true);
  }

  /**
   * 按 scope 触发刷新
   */
  async triggerByScope(scope: string): Promise<void> {
    return this.triggerByFilter((reg) => reg.scope === scope);
  }

  /**
   * 内部触发器：按过滤器筛选注册项，支持并发保护
   */
  private async triggerByFilter(filter: (reg: RefreshRegistration) => boolean): Promise<void> {
    // 正在刷新时，后续触发进入队列
    if (this.isRunning) {
      // 队列式：所有等待请求都会在当前刷新完成后执行
      return new Promise<void>((resolve) => {
        this.pendingQueue.push(resolve);
      });
    }

    this.isRunning = true;

    try {
      const targets = this.getRegistrations().filter(filter);

      // 优先级队列顺序执行
      for (const reg of targets) {
        try {
          await reg.handler();
        } catch {
          // 单个 handler 失败不影响其他 handler
        }
      }
    } finally {
      this.isRunning = false;

      // 消费队列中所有等待请求（而非只消费一个）
      while (this.pendingQueue.length > 0) {
        const pending = this.pendingQueue.shift();
        if (pending) {
          pending();
        }
      }
    }
  }
}

export const RefreshCoordinator = new RefreshCoordinatorImpl();
