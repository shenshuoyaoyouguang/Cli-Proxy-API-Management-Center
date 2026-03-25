import { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ErrorBoundary.module.scss';

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
  const isDevelopment = process.env.NODE_ENV === 'development';

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>{t('common.error_boundary_title')}</h1>
      <p className={styles.message}>{t('common.error_boundary_message')}</p>
      {isDevelopment && error?.message && (
        <pre className={styles.errorDetails}>{error.message}</pre>
      )}
      <button onClick={onReload} className={styles.reloadButton}>
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
