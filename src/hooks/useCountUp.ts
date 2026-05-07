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

  const easeOutCubic = useCallback((t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  }, []);

  useEffect(() => {
    if (!enabled) {
      prevTargetRef.current = targetValue;
      setDisplayValue(targetValue);
      return;
    }

    const startValue = prevTargetRef.current;
    const endValue = targetValue;

    if (startValue === endValue) return;

    startValueRef.current = startValue;
    startTimeRef.current = null;
    prevTargetRef.current = targetValue;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);

      const currentValue = startValue + (endValue - startValue) * easedProgress;
      setDisplayValue(currentValue);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [targetValue, duration, enabled, easeOutCubic]);

  const formattedValue = decimals > 0
    ? displayValue.toFixed(decimals)
    : Math.round(displayValue).toLocaleString();

  return { displayValue, formattedValue };
}
