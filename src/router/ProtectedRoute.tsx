import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuthStore } from '@/stores';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  getStoredRouteState,
  saveRouteState,
  clearRouteState,
  type RouteState,
} from '@/hooks/useRouteRestore';

const ROUTE_EXPIRY_MS = 30 * 60 * 1000;

interface RestoreState {
  routeState: RouteState | null;
  isRestored: boolean;
}

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const managementKey = useAuthStore((state) => state.managementKey);
  const apiBase = useAuthStore((state) => state.apiBase);
  const [checking, setChecking] = useState(true);
  const [restoreState, setRestoreState] = useState<RestoreState>({
    routeState: null,
    isRestored: false,
  });
  const hasAttemptedRestore = useRef(false);
  const isInitialRoute = location.pathname === '/' || location.pathname === '/dashboard';

  useEffect(() => {
    let active = true;

    const tryRestore = async () => {
      if (isAuthenticated) {
        if (active) {
          setChecking(false);
        }
        return;
      }

      try {
        if (managementKey && apiBase) {
          await useAuthStore.getState().checkAuth();
          if (!active) return;
          return;
        }

        if (!hasAttemptedRestore.current) {
          hasAttemptedRestore.current = true;
          await useAuthStore.getState().restoreSession();
        }
      } finally {
        if (active) {
          setChecking(false);
        }
      }
    };

    void tryRestore();
    return () => {
      active = false;
    };
  }, [apiBase, isAuthenticated, managementKey]);

  useEffect(() => {
    if (checking || !isAuthenticated || isInitialRoute) return;

    const stored = getStoredRouteState();
    if (stored && Date.now() - stored.timestamp < ROUTE_EXPIRY_MS) {
      setRestoreState({ routeState: stored, isRestored: true });
    }
  }, [checking, isAuthenticated, isInitialRoute]);

  useEffect(() => {
    if (!isAuthenticated || isInitialRoute || restoreState.isRestored) return;
    saveRouteState(location.pathname, location.search, location.hash);
  }, [isAuthenticated, isInitialRoute, location.pathname, location.search, location.hash, restoreState.isRestored]);

  useEffect(() => {
    if (!restoreState.isRestored || !restoreState.routeState) return;

    const currentPath = location.pathname;
    if (currentPath === restoreState.routeState.pathname) {
      setRestoreState((prev) => ({ ...prev, isRestored: false }));
      return;
    }

    const targetPath = `${restoreState.routeState.pathname}${restoreState.routeState.search}${restoreState.routeState.hash}`;
    navigate(targetPath, { replace: true });
    setRestoreState((prev) => ({ ...prev, isRestored: false }));
  }, [restoreState, location.pathname, navigate]);

  if (checking && !restoreState.isRestored) {
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    clearRouteState();
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}