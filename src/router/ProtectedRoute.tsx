import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuthStore } from '@/stores';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const managementKey = useAuthStore((state) => state.managementKey);
  const apiBase = useAuthStore((state) => state.apiBase);
  const [checking, setChecking] = useState(false);
  const hasAttemptedRestore = useRef(false);

  useEffect(() => {
    const tryRestore = async () => {
      if (isAuthenticated) {
        return;
      }

      // 情况1：内存中已有凭证，直接验证
      if (managementKey && apiBase) {
        setChecking(true);
        try {
          await useAuthStore.getState().checkAuth();
        } finally {
          setChecking(false);
        }
        return;
      }

      // 情况2：内存中没有凭证，但可能存储在 localStorage 中
      // 仅在首次渲染时尝试恢复，避免无限循环
      if (!hasAttemptedRestore.current) {
        hasAttemptedRestore.current = true;
        setChecking(true);
        try {
          await useAuthStore.getState().restoreSession();
        } finally {
          setChecking(false);
        }
      }
    };

    tryRestore();
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
