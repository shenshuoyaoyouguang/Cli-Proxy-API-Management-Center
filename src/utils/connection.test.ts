import { describe, expect, it } from 'vitest';
import { normalizeApiBase, isLocalhost } from './connection';

describe('normalizeApiBase', () => {
  describe('localhost detection', () => {
    it('should use http:// for localhost', () => {
      expect(normalizeApiBase('localhost')).toBe('http://localhost');
    });

    it('should use http:// for 127.0.0.1', () => {
      expect(normalizeApiBase('127.0.0.1')).toBe('http://127.0.0.1');
    });

    it('should use http:// for [::1]', () => {
      expect(normalizeApiBase('[::1]')).toBe('http://[::1]');
    });

    it('should use http:// for localhost:8317', () => {
      expect(normalizeApiBase('localhost:8317')).toBe('http://localhost:8317');
    });

    it('should use http:// for 127.0.0.1:8317', () => {
      expect(normalizeApiBase('127.0.0.1:8317')).toBe('http://127.0.0.1:8317');
    });
  });

  describe('non-localhost defaults to https://', () => {
    it('should use https:// for example.com', () => {
      expect(normalizeApiBase('example.com')).toBe('https://example.com');
    });

    it('should use https:// for api.example.com', () => {
      expect(normalizeApiBase('api.example.com')).toBe('https://api.example.com');
    });

    it('should use https:// for example.com:8317', () => {
      expect(normalizeApiBase('example.com:8317')).toBe('https://example.com:8317');
    });

    it('should use https:// for remote.router-for.me', () => {
      expect(normalizeApiBase('remote.router-for.me')).toBe('https://remote.router-for.me');
    });
  });

  describe('preserve existing protocol', () => {
    it('should preserve http://', () => {
      expect(normalizeApiBase('http://example.com')).toBe('http://example.com');
    });

    it('should preserve https://', () => {
      expect(normalizeApiBase('https://example.com')).toBe('https://example.com');
    });

    it('should preserve http:// for localhost', () => {
      expect(normalizeApiBase('http://localhost')).toBe('http://localhost');
    });

    it('should preserve https:// for localhost', () => {
      expect(normalizeApiBase('https://localhost')).toBe('https://localhost');
    });

    it('should preserve http:// for non-localhost', () => {
      expect(normalizeApiBase('http://example.com')).toBe('http://example.com');
    });
  });

  describe('path handling', () => {
    it('should strip /v0/management suffix', () => {
      expect(normalizeApiBase('localhost:8317/v0/management')).toBe('http://localhost:8317');
    });

    it('should strip /v0/management trailing slash', () => {
      expect(normalizeApiBase('example.com/v0/management/')).toBe('https://example.com');
    });

    it('should strip trailing slashes', () => {
      expect(normalizeApiBase('example.com/')).toBe('https://example.com');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      expect(normalizeApiBase('')).toBe('');
    });

    it('should return empty string for whitespace only', () => {
      expect(normalizeApiBase('   ')).toBe('');
    });
  });
});

describe('isLocalhost', () => {
  it('should return true for localhost', () => {
    expect(isLocalhost('localhost')).toBe(true);
  });

  it('should return true for 127.0.0.1', () => {
    expect(isLocalhost('127.0.0.1')).toBe(true);
  });

  it('should return true for [::1]', () => {
    expect(isLocalhost('[::1]')).toBe(true);
  });

  it('should return true for case-insensitive localhost', () => {
    expect(isLocalhost('LOCALHOST')).toBe(true);
  });

  it('should return false for example.com', () => {
    expect(isLocalhost('example.com')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isLocalhost('')).toBe(false);
  });
});
