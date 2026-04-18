import { useEffect } from 'react';
import { RefreshCoordinator } from '@/services/refresh';

export type HeaderRefreshHandler = () => void | Promise<void>;

export const triggerHeaderRefresh = () => RefreshCoordinator.triggerAll();

export const useHeaderRefresh = (handler?: HeaderRefreshHandler | null, enabled = true) => {
  const lastHandlerRef = useRef<HeaderRefreshHandler | null>(null);

  useEffect(() => {
    if (!handler) return;
    const id = `header-${Date.now()}`;
    const cleanup = RefreshCoordinator.register({
      id,
      handler,
      priority: 'normal',
    });
    return cleanup;
  }, [handler]);
};
