import { describe, expect, it } from 'vitest';
import { generateId } from './helpers';

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
