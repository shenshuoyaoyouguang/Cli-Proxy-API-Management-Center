import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { logger } from '@/utils/logger';

/**
 * ErrorBoundary 组件 Props 类型定义
 */
interface ErrorBoundaryProps {
  /** 子组件 */
  children: ReactNode;
  /** 错误发生时展示的 fallback UI */
  fallback: ReactNode;
}

/**
 * ErrorBoundary 组件 State 类型定义
 */
interface ErrorBoundaryState {
  /** 是否发生错误 */
  hasError: boolean;
}

/**
 * ErrorBoundary 错误边界组件
 *
 * 用于捕获子组件树中的 JavaScript 错误，防止整个应用崩溃。
 * 必须使用 Class Component 实现，因为 ErrorBoundary 需要生命周期方法。
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={<ErrorPage />}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * 静态方法：从错误中派生状态
   * 当子组件抛出错误时，此方法会被调用，返回新的 state 使组件重新渲染
   */
  static getDerivedStateFromError(_error: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  /**
   * 生命周期方法：捕获错误信息
   * 用于记录错误日志等副作用操作
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('ErrorBoundary caught an error', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
export type { ErrorBoundaryProps, ErrorBoundaryState };
