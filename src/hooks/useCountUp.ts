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
  const pausedProgressRef = useRef(0);
  const skipAnimation = !enabled || targetValue > 1e15;

  const easeOutCubic = useCallback((t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  }, []);

  useEffect(() => {
    if (skipAnimation) {
      isAnimatingRef.current = false;
      prevTargetRef.current = targetValue;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    isAnimatingRef.current = true;
    const startValue = displayValue;
    const endValue = targetValue;

    if (startValue === endValue) return;

    startValueRef.current = startValue;
    startTimeRef.current = null;
    prevTargetRef.current = targetValue;

    const animate = (timestamp: number) => {
      if (!isAnimatingRef.current) return;

      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp - pausedProgressRef.current * duration;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);

      const currentValue = startValue + (endValue - startValue) * easedProgress;
      setDisplayValue(currentValue);

      if (progress < 1 && isAnimatingRef.current) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        pausedProgressRef.current = 0;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (startTimeRef.current !== null) {
          const elapsed = performance.now() - startTimeRef.current;
          pausedProgressRef.current = Math.min(elapsed / duration, 1);
        }
        isAnimatingRef.current = false;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      } else if (pausedProgressRef.current > 0 && pausedProgressRef.current < 1) {
        isAnimatingRef.current = true;
        startTimeRef.current = null;
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isAnimatingRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [targetValue, duration, enabled, easeOutCubic]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveDisplayValue = skipAnimation ? targetValue : displayValue;

  const formattedValue = decimals > 0
    ? effectiveDisplayValue.toFixed(decimals)
    : Math.round(effectiveDisplayValue).toLocaleString();

  return { displayValue: effectiveDisplayValue, formattedValue };
}
