import { Navigate, useRoutes, type Location } from 'react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const AiProvidersPage = lazy(() => import('@/pages/AiProvidersPage').then(m => ({ default: m.AiProvidersPage })));
const AiProvidersAmpcodeEditPage = lazy(() => import('@/pages/AiProvidersAmpcodeEditPage').then(m => ({ default: m.AiProvidersAmpcodeEditPage })));
const AiProvidersClaudeEditLayout = lazy(() => import('@/pages/AiProvidersClaudeEditLayout').then(m => ({ default: m.AiProvidersClaudeEditLayout })));
const AiProvidersClaudeEditPage = lazy(() => import('@/pages/AiProvidersClaudeEditPage').then(m => ({ default: m.AiProvidersClaudeEditPage })));
const AiProvidersClaudeModelsPage = lazy(() => import('@/pages/AiProvidersClaudeModelsPage').then(m => ({ default: m.AiProvidersClaudeModelsPage })));
const AiProvidersCodexEditPage = lazy(() => import('@/pages/AiProvidersCodexEditPage').then(m => ({ default: m.AiProvidersCodexEditPage })));
const AiProvidersGeminiEditPage = lazy(() => import('@/pages/AiProvidersGeminiEditPage').then(m => ({ default: m.AiProvidersGeminiEditPage })));
const AiProvidersOpenAIEditLayout = lazy(() => import('@/pages/AiProvidersOpenAIEditLayout').then(m => ({ default: m.AiProvidersOpenAIEditLayout })));
const AiProvidersOpenAIEditPage = lazy(() => import('@/pages/AiProvidersOpenAIEditPage').then(m => ({ default: m.AiProvidersOpenAIEditPage })));
const AiProvidersOpenAIModelsPage = lazy(() => import('@/pages/AiProvidersOpenAIModelsPage').then(m => ({ default: m.AiProvidersOpenAIModelsPage })));
const AiProvidersVertexEditPage = lazy(() => import('@/pages/AiProvidersVertexEditPage').then(m => ({ default: m.AiProvidersVertexEditPage })));
const AuthFilesPage = lazy(() => import('@/pages/AuthFilesPage').then(m => ({ default: m.AuthFilesPage })));
const AuthFilesOAuthExcludedEditPage = lazy(() => import('@/pages/AuthFilesOAuthExcludedEditPage').then(m => ({ default: m.AuthFilesOAuthExcludedEditPage })));
const AuthFilesOAuthModelAliasEditPage = lazy(() => import('@/pages/AuthFilesOAuthModelAliasEditPage').then(m => ({ default: m.AuthFilesOAuthModelAliasEditPage })));
const OAuthPage = lazy(() => import('@/pages/OAuthPage').then(m => ({ default: m.OAuthPage })));
const QuotaPage = lazy(() => import('@/pages/QuotaPage').then(m => ({ default: m.QuotaPage })));
const UsagePage = lazy(() => import('@/pages/UsagePage').then(m => ({ default: m.UsagePage })));
const ConfigPage = lazy(() => import('@/pages/ConfigPage').then(m => ({ default: m.ConfigPage })));
const LogsPage = lazy(() => import('@/pages/LogsPage').then(m => ({ default: m.LogsPage })));
const SystemPage = lazy(() => import('@/pages/SystemPage').then(m => ({ default: m.SystemPage })));

const mainRoutes = [
  { path: '/', element: <DashboardPage /> },
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/settings', element: <Navigate to="/config" replace /> },
  { path: '/api-keys', element: <Navigate to="/config" replace /> },
  { path: '/ai-providers/gemini/new', element: <AiProvidersGeminiEditPage /> },
  { path: '/ai-providers/gemini/:index', element: <AiProvidersGeminiEditPage /> },
  { path: '/ai-providers/codex/new', element: <AiProvidersCodexEditPage /> },
  { path: '/ai-providers/codex/:index', element: <AiProvidersCodexEditPage /> },
  {
    path: '/ai-providers/claude/new',
    element: <AiProvidersClaudeEditLayout />,
    children: [
      { index: true, element: <AiProvidersClaudeEditPage /> },
      { path: 'models', element: <AiProvidersClaudeModelsPage /> },
    ],
  },
  {
    path: '/ai-providers/claude/:index',
    element: <AiProvidersClaudeEditLayout />,
    children: [
      { index: true, element: <AiProvidersClaudeEditPage /> },
      { path: 'models', element: <AiProvidersClaudeModelsPage /> },
    ],
  },
  { path: '/ai-providers/vertex/new', element: <AiProvidersVertexEditPage /> },
  { path: '/ai-providers/vertex/:index', element: <AiProvidersVertexEditPage /> },
  {
    path: '/ai-providers/openai/new',
    element: <AiProvidersOpenAIEditLayout />,
    children: [
      { index: true, element: <AiProvidersOpenAIEditPage /> },
      { path: 'models', element: <AiProvidersOpenAIModelsPage /> },
    ],
  },
  {
    path: '/ai-providers/openai/:index',
    element: <AiProvidersOpenAIEditLayout />,
    children: [
      { index: true, element: <AiProvidersOpenAIEditPage /> },
      { path: 'models', element: <AiProvidersOpenAIModelsPage /> },
    ],
  },
  { path: '/ai-providers/ampcode', element: <AiProvidersAmpcodeEditPage /> },
  { path: '/ai-providers', element: <AiProvidersPage /> },
  { path: '/ai-providers/*', element: <AiProvidersPage /> },
  { path: '/auth-files', element: <AuthFilesPage /> },
  { path: '/auth-files/oauth-excluded', element: <AuthFilesOAuthExcludedEditPage /> },
  { path: '/auth-files/oauth-model-alias', element: <AuthFilesOAuthModelAliasEditPage /> },
  { path: '/oauth', element: <OAuthPage /> },
  { path: '/quota', element: <QuotaPage /> },
  { path: '/usage', element: <UsagePage /> },
  { path: '/config', element: <ConfigPage /> },
  { path: '/logs', element: <LogsPage /> },
  { path: '/system', element: <SystemPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function MainRoutes({ location }: { location?: Location }) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div className="flex-center" style={{ minHeight: '100vh' }}>
          <LoadingSpinner size={32} />
        </div>
      }
    >
      <ErrorBoundary fallback={<div>{t('common.error_boundary_message')}</div>}>
        {useRoutes(mainRoutes, location)}
      </ErrorBoundary>
    </Suspense>
  );
}
