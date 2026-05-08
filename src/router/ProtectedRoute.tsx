import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuthStore } from '@/stores';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const managementKey = useAuthStore((state) => state.managementKey);
  const apiBase = useAuthStore((state) => state.apiBase);
  const [checking, setChecking] = useState(true);
  const hasAttemptedRestore = useRef(false);

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

  if (checking) {
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
