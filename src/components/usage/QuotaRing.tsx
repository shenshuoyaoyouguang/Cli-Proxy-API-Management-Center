import { memo } from 'react';
import type { QuotaAlertLevel } from './types';
import styles from './QuotaRing.module.scss';

export type { QuotaAlertLevel } from './types';

interface QuotaRingProps {
  percentage: number; // 0-100+, used percentage
  size?: number; // ring diameter in px, default 64
  strokeWidth?: number; // ring stroke width, default 5
  showLabel?: boolean; // show percentage text, default true
  alertLevel?: QuotaAlertLevel;
}

const COLOR_MAP: Record<QuotaAlertLevel, { stroke: string; track: string }> = {
  normal: { stroke: '#22c55e', track: 'rgba(34, 197, 94, 0.15)' },
  warning: { stroke: '#eab308', track: 'rgba(234, 179, 8, 0.15)' },
  critical: { stroke: '#ef4444', track: 'rgba(239, 68, 68, 0.15)' },
};

export const QuotaRing = memo(function QuotaRing({
  percentage,
  size = 64,
  strokeWidth = 5,
  showLabel = true,
  alertLevel = 'normal',
}: QuotaRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Cap display at 100% but allow overflow indication
  const displayPercent = Math.min(percentage, 100);
  const strokeDashoffset = circumference - (displayPercent / 100) * circumference;

  const colors = COLOR_MAP[alertLevel];

  return (
    <div className={styles.container} style={{ width: size, height: size }}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${size} ${size}`}
        aria-label={`${percentage.toFixed(0)}% used`}
      >
        {/* Track */}
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.track}
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          className={`${styles.progress} ${alertLevel === 'critical' ? styles.pulse : ''}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {showLabel && (
        <div className={styles.label}>
          <span className={styles.value} style={{ color: colors.stroke }}>
            {percentage >= 100 ? '!' : Math.round(percentage)}
          </span>
          <span className={styles.unit}>%</span>
        </div>
      )}
    </div>
  );
});
