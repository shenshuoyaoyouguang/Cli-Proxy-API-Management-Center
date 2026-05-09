/**
 * 路由状态恢复 Hook
 * 支持在页面刷新后恢复用户之前的路由位置
 */

import { useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

const ROUTE_STATE_KEY = 'cli-proxy-last-route-v1';
const ROUTE_EXPIRY_MS = 30 * 60 * 1000; // 30分钟过期

export interface RouteState {
  pathname: string;
  search: string;
  hash: string;
  timestamp: number;
}

export function getStoredRouteState(): RouteState | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(ROUTE_STATE_KEY);
    if (!raw) return null;

    const state = JSON.parse(raw) as Partial<RouteState>;
    if (!state.pathname) return null;

    if (state.timestamp && Date.now() - state.timestamp > ROUTE_EXPIRY_MS) {
      localStorage.removeItem(ROUTE_STATE_KEY);
      return null;
    }

    return {
      pathname: state.pathname || '/',
      search: state.search || '',
      hash: state.hash || '',
      timestamp: state.timestamp || Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveRouteState(pathname: string, search = '', hash = ''): void {
  if (typeof localStorage === 'undefined') return;

  try {
    const state: RouteState = {
      pathname,
      search,
      hash,
      timestamp: Date.now(),
    };
    localStorage.setItem(ROUTE_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

export function clearRouteState(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(ROUTE_STATE_KEY);
}

export interface UseRouteRestoreOptions {
  enabled?: boolean;
  excludePaths?: string[];
  defaultPath?: string;
}

export function useRouteRestore(options: UseRouteRestoreOptions = {}) {
  const { enabled = true, excludePaths = [] } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const hasRestoredRef = useRef(false);
  const isInitialRenderRef = useRef(true);

  const restoreRoute = useCallback(() => {
    if (!enabled || hasRestoredRef.current) return;

    const stored = getStoredRouteState();
    if (!stored) return;

    const shouldExclude = excludePaths.some(
      (path) => stored.pathname === path || stored.pathname.startsWith(path + '/')
    );
    if (shouldExclude) return;

    const currentPath = location.pathname;
    if (currentPath !== stored.pathname) {
      hasRestoredRef.current = true;
      navigate(
        `${stored.pathname}${stored.search}${stored.hash}`,
        { replace: true }
      );
      return;
    }

    hasRestoredRef.current = true;
  }, [enabled, excludePaths, location.pathname, navigate]);

  useEffect(() => {
    if (isInitialRenderRef.current) {
      isInitialRenderRef.current = false;
      restoreRoute();
    }
  }, [restoreRoute]);

  useEffect(() => {
    if (!enabled) return;

    const currentPath = location.pathname;
    const shouldExclude = excludePaths.some(
      (path) => currentPath === path || currentPath.startsWith(path + '/')
    );

    if (!shouldExclude) {
      saveRouteState(currentPath, location.search, location.hash);
    }
  }, [enabled, excludePaths, location.pathname, location.search, location.hash]);

  return {
    restoreRoute,
    getStoredRoute: getStoredRouteState,
  };
}