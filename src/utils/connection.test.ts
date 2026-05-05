import { describe, expect, it } from 'vitest';
import { normalizeApiBase, isLocalhost } from './connection';

describe('normalizeApiBase - boundary tests', () => {
  describe('IPv6 addresses', () => {
    it('handles [::1] without port', () => {
      expect(normalizeApiBase('[::1]')).toBe('http://[::1]');
    });

    it('handles [::1] with port', () => {
      expect(normalizeApiBase('[::1]:8317')).toBe('http://[::1]:8317');
    });

    it('handles full IPv6 address', () => {
      expect(normalizeApiBase('[2001:db8::1]')).toBe('https://[2001:db8::1]');
    });

    it('handles full IPv6 address with port', () => {
      expect(normalizeApiBase('[2001:db8::1]:8317')).toBe('https://[2001:db8::1]:8317');
    });

    it('preserves http:// for IPv6 localhost', () => {
      expect(normalizeApiBase('http://[::1]:8317')).toBe('http://[::1]:8317');
    });

    it('preserves https:// for IPv6 non-localhost', () => {
      expect(normalizeApiBase('https://[2001:db8::1]')).toBe('https://[2001:db8::1]');
    });
  });

  describe('special ports', () => {
    it('handles port 80', () => {
      expect(normalizeApiBase('localhost:80')).toBe('http://localhost:80');
    });

    it('handles port 443', () => {
      expect(normalizeApiBase('example.com:443')).toBe('https://example.com:443');
    });

    it('handles port 8080', () => {
      expect(normalizeApiBase('localhost:8080')).toBe('http://localhost:8080');
    });

    it('handles high port numbers', () => {
      expect(normalizeApiBase('localhost:65535')).toBe('http://localhost:65535');
    });
  });

  describe('protocol handling', () => {
    it('preserves explicit http:// for non-localhost', () => {
      expect(normalizeApiBase('http://example.com')).toBe('http://example.com');
    });

    it('preserves explicit https:// for localhost', () => {
      expect(normalizeApiBase('https://localhost')).toBe('https://localhost');
    });

    it('handles HTTP protocol case-insensitively', () => {
      expect(normalizeApiBase('HTTP://example.com')).toBe('HTTP://example.com');
    });
  });

  describe('path stripping', () => {
    it('strips /v0/management from URL with port', () => {
      expect(normalizeApiBase('localhost:8317/v0/management')).toBe('http://localhost:8317');
    });

    it('strips /v0/management/ with trailing slash', () => {
      expect(normalizeApiBase('example.com/v0/management/')).toBe('https://example.com');
    });

    it('strips multiple trailing slashes', () => {
      expect(normalizeApiBase('example.com///')).toBe('https://example.com');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for null-like input', () => {
      expect(normalizeApiBase('')).toBe('');
    });

    it('returns empty string for whitespace', () => {
      expect(normalizeApiBase('   ')).toBe('');
    });

    it('handles URL with existing protocol and port', () => {
      expect(normalizeApiBase('http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('handles URL with existing protocol, port and path', () => {
      expect(normalizeApiBase('http://localhost:3000/v0/management')).toBe('http://localhost:3000');
    });
  });
});

describe('isLocalhost - boundary tests', () => {
  it('returns true for [::1]', () => {
    expect(isLocalhost('[::1]')).toBe(true);
  });

  it('returns false for [::2]', () => {
    expect(isLocalhost('[::2]')).toBe(false);
  });

  it('returns false for 127.0.0.2', () => {
    expect(isLocalhost('127.0.0.2')).toBe(false);
  });

  it('returns false for 0.0.0.0', () => {
    expect(isLocalhost('0.0.0.0')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isLocalhost('LocalHost')).toBe(true);
    expect(isLocalhost('LOCALHOST')).toBe(true);
  });
});
