import { useState, useEffect, useRef, useCallback } from 'react';

interface UseCountUpOptions {
  duration?: number;
  decimals?: number;
  enabled?: boolean;
}

export function useCountUp(
  targetValue: number,
  options: UseCountUpOptions = {}
) {
  const { duration = 600, decimals = 0, enabled = true } = options;
  const [displayValue, setDisplayValue] = useState(targetValue);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef(targetValue);
  const rafRef = useRef<number | null>(null);
  const prevTargetRef = useRef(targetValue);
  const isAnimatingRef = useRef(false);

  const easeOutCubic = useCallback((t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  }, []);

  useEffect(() => {
    if (!enabled) {
      isAnimatingRef.current = false;
      prevTargetRef.current = targetValue;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    isAnimatingRef.current = true;
    const startValue = prevTargetRef.current;
    const endValue = targetValue;

    if (startValue === endValue) return;

    startValueRef.current = startValue;
    startTimeRef.current = null;
    prevTargetRef.current = targetValue;

    const animate = (timestamp: number) => {
      if (!isAnimatingRef.current) return;

      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);

      const currentValue = startValue + (endValue - startValue) * easedProgress;
      setDisplayValue(currentValue);

      if (progress < 1 && isAnimatingRef.current) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      isAnimatingRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [targetValue, duration, enabled, easeOutCubic]);

  const effectiveDisplayValue = enabled ? displayValue : targetValue;

  const formattedValue = decimals > 0
    ? effectiveDisplayValue.toFixed(decimals)
    : Math.round(effectiveDisplayValue).toLocaleString();

  return { displayValue: effectiveDisplayValue, formattedValue };
}
