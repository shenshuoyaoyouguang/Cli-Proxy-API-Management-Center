import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeArrayResponse,
  debounce,
  throttle,
  deepClone,
  generateId,
  sleep,
} from './helpers';

describe('normalizeArrayResponse', () => {
  it('returns empty array for null', () => {
    expect(normalizeArrayResponse(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(normalizeArrayResponse(undefined)).toEqual([]);
  });

  it('wraps single item into array', () => {
    expect(normalizeArrayResponse('hello')).toEqual(['hello']);
  });

  it('returns array as-is', () => {
    const arr = [1, 2, 3];
    expect(normalizeArrayResponse(arr)).toEqual([1, 2, 3]);
  });

  it('handles object input by wrapping', () => {
    const obj = { key: 'value' };
    expect(normalizeArrayResponse(obj)).toEqual([{ key: 'value' }]);
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays function execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments to the debounced function', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('arg1', 42);
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('arg1', 42);
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes function immediately on first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('prevents subsequent calls within the limit window', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('allows execution after the limit window expires', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('deepClone', () => {
  it('returns null for null input', () => {
    expect(deepClone(null)).toBeNull();
  });

  it('returns primitive values as-is', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(true)).toBe(true);
  });

  it('clones objects deeply', () => {
    const original = { a: 1, b: { c: 2 } };
    const cloned = deepClone(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.b).not.toBe(original.b);
  });

  it('clones arrays deeply', () => {
    const original = [1, [2, 3], { a: 4 }];
    const cloned = deepClone(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned[1]).not.toBe(original[1]);
  });

  it('clones Date objects', () => {
    const original = new Date('2025-01-01');
    const cloned = deepClone(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.getTime()).toBe(original.getTime());
  });
});

describe('generateId', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  it('returns unique values on successive calls', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('contains a dash separator', () => {
    expect(generateId()).toContain('-');
  });
});

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the specified delay', async () => {
    const spy = vi.fn();
    const promise = sleep(100).then(spy);

    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    await promise;
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
