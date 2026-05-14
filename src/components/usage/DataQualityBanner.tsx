import { memo, useCallback, useState } from 'react';
import styles from './DataQualityBanner.module.scss';

interface DataQualityBannerProps {
  message: string;
  zeroedCount: number;
}

function WarningIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export const DataQualityBanner = memo(function DataQualityBanner({
  message,
}: DataQualityBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={styles.banner}
      role="alert"
      aria-live="assertive"
    >
      <span className={styles.icon}>
        <WarningIcon />
      </span>
      <div className={styles.content}>
        <span className={styles.title}>
          数据质量警告
        </span>
        <span className={styles.message}>
          {message}
        </span>
      </div>
      <button
        type="button"
        className={styles.dismissBtn}
        onClick={handleDismiss}
        aria-label="关闭"
        title="关闭"
      >
        <CloseIcon />
      </button>
    </div>
  );
});