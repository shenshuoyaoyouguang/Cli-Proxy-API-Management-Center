import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, RouterProvider, createHashRouter } from 'react-router';
import { LoginPage } from '@/pages/LoginPage';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { MainLayout } from '@/components/layout/MainLayout';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { useLanguageStore, useThemeStore } from '@/stores';

/**
 * 全局错误 fallback 组件
 */
function GlobalErrorFallback() {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '20px',
        textAlign: 'center',
      }}
    >
      <h1>{t('common.error_boundary_title', '出错了')}</h1>
      <p>{t('common.error_boundary_message', '应用发生错误，请刷新页面重试')}</p>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: '16px',
          padding: '8px 16px',
          cursor: 'pointer',
        }}
      >
        {t('common.reload_page', '刷新页面')}
      </button>
    </div>
  );
}

function RootShell() {
  return (
    <>
      <NotificationContainer />
      <ConfirmationModal />
      <Outlet />
    </>
  );
}

const router = createHashRouter([
  {
    element: <RootShell />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/*',
        element: (
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  useEffect(() => {
    const cleanupTheme = initializeTheme();
    return cleanupTheme;
  }, [initializeTheme]);

  useEffect(() => {
    setLanguage(language);
  }, [language, setLanguage]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <ErrorBoundary fallback={<GlobalErrorFallback />}>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}

export default App;
