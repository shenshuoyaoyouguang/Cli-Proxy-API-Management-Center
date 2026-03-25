import { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

interface ErrorFallbackProps {
  error: Error | null;
  onReload: () => void;
}

function ErrorFallback({ error, onReload }: ErrorFallbackProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        textAlign: 'center',
        backgroundColor: 'var(--bg-color, #1a1a2e)',
        color: 'var(--text-color, #eee)',
      }}
    >
      <h1
        style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          marginBottom: '1rem',
          color: '#ef4444',
        }}
      >
        {t('common.error_boundary_title')}
      </h1>
      <p
        style={{
          fontSize: '0.875rem',
          marginBottom: '1.5rem',
          maxWidth: '400px',
          lineHeight: 1.6,
          color: 'var(--text-secondary, #aaa)',
        }}
      >
        {t('common.error_boundary_message')}
      </p>
      {error?.message && (
        <pre
          style={{
            fontSize: '0.75rem',
            padding: '1rem',
            backgroundColor: 'var(--card-bg, #16213e)',
            borderRadius: '0.5rem',
            marginBottom: '1.5rem',
            maxWidth: '600px',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: '#f87171',
            border: '1px solid var(--border-color, #333)',
          }}
        >
          {error.message}
        </pre>
      )}
      <button
        onClick={onReload}
        style={{
          padding: '0.75rem 1.5rem',
          fontSize: '0.875rem',
          fontWeight: 500,
          color: '#fff',
          backgroundColor: '#3b82f6',
          border: 'none',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
        }}
        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#3b82f6')}
      >
        {t('common.reload_page')}
      </button>
    </div>
  );
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onReload={this.handleReload} />;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
