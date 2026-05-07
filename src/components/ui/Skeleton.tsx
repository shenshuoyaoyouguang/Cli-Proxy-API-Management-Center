import { useMemo, type CSSProperties } from 'react';
import styles from './Skeleton.module.scss';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 4,
  className = '',
  style,
}: SkeletonProps) {
  const combinedStyle: CSSProperties = {
    width,
    height,
    borderRadius,
    ...style,
  };

  return (
    <div
      className={`${styles.skeleton} ${className}`}
      style={combinedStyle}
      aria-hidden="true"
    />
  );
}

interface SkeletonCardProps {
  rows?: number;
  className?: string;
}

export function SkeletonCard({ rows = 3, className = '' }: SkeletonCardProps) {
  const widths = useMemo(() => {
    return Array.from({ length: rows }, (_, i) => `${70 + ((i * 17) % 30)}%`);
  }, [rows]);

  return (
    <div className={`${styles.skeletonCard} ${className}`} aria-hidden="true">
      <div className={styles.skeletonHeader}>
        <Skeleton width="60%" height={14} borderRadius={4} />
        <Skeleton width={32} height={32} borderRadius={8} />
      </div>
      <Skeleton width="80%" height={36} borderRadius={6} />
      <div className={styles.skeletonMeta}>
        {widths.map((width, i) => (
          <Skeleton key={i} width={width} height={12} borderRadius={3} />
        ))}
      </div>
      <Skeleton width="100%" height={58} borderRadius={8} />
    </div>
  );
}
