import { describe, expect, it } from 'vitest';
import {
  isValidUrl,
  isValidApiBase,
  isValidApiKey,
  isValidApiKeyCharset,
  isValidJson,
  isValidEmail,
} from './validation';

describe('isValidUrl', () => {
  it('returns true for valid http URL', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  it('returns true for valid https URL', () => {
    expect(isValidUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('returns false for string without protocol', () => {
    expect(isValidUrl('example.com')).toBe(false);
  });

  it('returns false for javascript: protocol', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(true);
  });

  it('returns true for ftp URL', () => {
    expect(isValidUrl('ftp://files.example.com')).toBe(true);
  });
});

describe('isValidApiBase', () => {
  it('returns true for http://localhost:3000', () => {
    expect(isValidApiBase('http://localhost:3000')).toBe(true);
  });

  it('returns true for https://api.example.com', () => {
    expect(isValidApiBase('https://api.example.com')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidApiBase('')).toBe(false);
  });

  it('returns false for ftp:// protocol', () => {
    expect(isValidApiBase('ftp://example.com')).toBe(false);
  });

  it('returns false for string without protocol', () => {
    expect(isValidApiBase('example.com')).toBe(false);
  });

  it('is case insensitive for protocol', () => {
    expect(isValidApiBase('HTTP://localhost')).toBe(true);
  });
});

describe('isValidApiKey', () => {
  it('returns true for valid key with 8+ chars', () => {
    expect(isValidApiKey('sk-12345678')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidApiKey('')).toBe(false);
  });

  it('returns false for key shorter than 8 chars', () => {
    expect(isValidApiKey('short')).toBe(false);
  });

  it('returns false for key with spaces', () => {
    expect(isValidApiKey('key with space')).toBe(false);
  });

  it('returns false for exactly 7 chars', () => {
    expect(isValidApiKey('1234567')).toBe(false);
  });

  it('returns true for exactly 8 chars', () => {
    expect(isValidApiKey('12345678')).toBe(true);
  });
});

describe('isValidApiKeyCharset', () => {
  it('returns true for ASCII printable chars', () => {
    expect(isValidApiKeyCharset('sk-ABC123!')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidApiKeyCharset('')).toBe(false);
  });

  it('returns false for string with spaces', () => {
    expect(isValidApiKeyCharset('key with space')).toBe(false);
  });

  it('returns false for string with tab', () => {
    expect(isValidApiKeyCharset('key\twith\ttab')).toBe(false);
  });

  it('returns false for string with unicode', () => {
    expect(isValidApiKeyCharset('key-中文')).toBe(false);
  });

  it('returns true for all special chars', () => {
    expect(isValidApiKeyCharset('!@#$%^&*()')).toBe(true);
  });
});

describe('isValidJson', () => {
  it('returns true for valid JSON object', () => {
    expect(isValidJson('{"key": "value"}')).toBe(true);
  });

  it('returns true for valid JSON array', () => {
    expect(isValidJson('[1, 2, 3]')).toBe(true);
  });

  it('returns true for valid JSON string', () => {
    expect(isValidJson('"hello"')).toBe(true);
  });

  it('returns true for valid JSON number', () => {
    expect(isValidJson('42')).toBe(true);
  });

  it('returns false for invalid JSON', () => {
    expect(isValidJson('{invalid}')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidJson('')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('returns true for valid email', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('returns true for email with subdomain', () => {
    expect(isValidEmail('user@mail.example.com')).toBe(true);
  });

  it('returns false for email without @', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('returns false for email without domain', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('returns false for email without TLD', () => {
    expect(isValidEmail('user@example')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('returns false for email with spaces', () => {
    expect(isValidEmail('user @example.com')).toBe(false);
  });
});
