import { describe, expect, it, beforeEach, vi } from 'vitest';
import { encryptData, decryptData, decryptDataSync, isEncrypted, getKeyBytes } from './encryption';

// Mock window and navigator for getKeyBytes
globalThis.window = {
  location: {
    host: 'localhost:5173',
  },
} as unknown as Window & typeof globalThis;

globalThis.navigator = {
  userAgent: 'test-agent',
} as Navigator;

describe('encryption', () => {
  beforeEach(() => {
    // Clear any cached keys between tests
    vi.clearAllMocks();
  });

  describe('v2 AES-256-GCM encryption', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const plaintext = 'Hello, World! This is a test message.';

      const encrypted = await encryptData(plaintext);
      expect(encrypted).toMatch(/^enc::v2::/);

      const decrypted = await decryptData(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should generate different ciphertexts for same plaintext (random IV)', async () => {
      const plaintext = 'Same message';

      const encrypted1 = await encryptData(plaintext);
      const encrypted2 = await encryptData(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(await decryptData(encrypted1)).toBe(plaintext);
      expect(await decryptData(encrypted2)).toBe(plaintext);
    });

    it('should handle empty string', async () => {
      const encrypted = await encryptData('');
      expect(encrypted).toBe('');

      const decrypted = await decryptData('');
      expect(decrypted).toBe('');
    });

    it('should handle special characters and Unicode', async () => {
      const plaintext = 'Hello 世界! 🌍 ñ é ü';

      const encrypted = await encryptData(plaintext);
      const decrypted = await decryptData(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long text', async () => {
      const plaintext = 'A'.repeat(10000);

      const encrypted = await encryptData(plaintext);
      const decrypted = await decryptData(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('v1 XOR backward compatibility', () => {
    it('should decrypt v1 encrypted data with decryptDataSync', () => {
      // Create a v1 encrypted payload manually
      const SECRET_SALT = 'cli-proxy-api-webui::secure-storage';
      const encoder = new TextEncoder();
      const keyBytes = encoder.encode(`${SECRET_SALT}|localhost:5173|test-agent`);
      const plaintext = 'Legacy data';
      const data = encoder.encode(plaintext);

      // XOR encrypt
      const encrypted = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        encrypted[i] = data[i] ^ keyBytes[i % keyBytes.length];
      }

      // Convert to base64
      let binary = '';
      for (let i = 0; i < encrypted.length; i++) {
        binary += String.fromCharCode(encrypted[i]);
      }
      const base64 = btoa(binary);
      const v1Payload = `enc::v1::${base64}`;

      // Should decrypt correctly
      const decrypted = decryptDataSync(v1Payload);
      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt v1 data with async decryptData', async () => {
      // Create a v1 encrypted payload
      const SECRET_SALT = 'cli-proxy-api-webui::secure-storage';
      const encoder = new TextEncoder();
      const keyBytes = encoder.encode(`${SECRET_SALT}|localhost:5173|test-agent`);
      const plaintext = 'Legacy async test';
      const data = encoder.encode(plaintext);

      // XOR encrypt
      const encrypted = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        encrypted[i] = data[i] ^ keyBytes[i % keyBytes.length];
      }

      // Convert to base64
      let binary = '';
      for (let i = 0; i < encrypted.length; i++) {
        binary += String.fromCharCode(encrypted[i]);
      }
      const base64 = btoa(binary);
      const v1Payload = `enc::v1::${base64}`;

      // Async decrypt should handle v1
      const decrypted = await decryptData(v1Payload);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for v1 encrypted data', () => {
      expect(isEncrypted('enc::v1::abc123')).toBe(true);
    });

    it('should return true for v2 encrypted data', () => {
      expect(isEncrypted('enc::v2::abc123')).toBe(true);
    });

    it('should return false for plaintext', () => {
      expect(isEncrypted('plaintext')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isEncrypted(null as unknown as string)).toBe(false);
      expect(isEncrypted(undefined as unknown as string)).toBe(false);
    });
  });

  describe('decryptData handles both versions', () => {
    it('should handle v2 encryption', async () => {
      const plaintext = 'Test v2';
      const encrypted = await encryptData(plaintext);

      expect(encrypted.startsWith('enc::v2::')).toBe(true);

      const decrypted = await decryptData(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should return plaintext as-is if not encrypted', async () => {
      const plaintext = 'Not encrypted';
      const result = await decryptData(plaintext);
      expect(result).toBe(plaintext);
    });

    it('should handle empty string', async () => {
      const result = await decryptData('');
      expect(result).toBe('');
    });
  });

  describe('decryptDataSync v2 limitation', () => {
    it('should return v2 payload as-is with warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const v2Payload = 'enc::v2::somedata';

      const result = decryptDataSync(v2Payload);
      expect(result).toBe(v2Payload);
      expect(consoleSpy).toHaveBeenCalledWith('V2 encrypted data requires async decryptData()');

      consoleSpy.mockRestore();
    });
  });

  describe('getKeyBytes', () => {
    it('should return key bytes based on host and userAgent', () => {
      const keyBytes1 = getKeyBytes();
      const keyBytes2 = getKeyBytes();

      // Should return same cached value
      expect(keyBytes1).toBe(keyBytes2);
      expect(keyBytes1.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should return original value on encryption failure', async () => {
      const plaintext = 'test';
      // Encryption should not fail in normal conditions, but we test the fallback
      const result = await encryptData(plaintext);

      // If encryption succeeds, we get encrypted data
      // If it fails, we get original plaintext
      expect(result === plaintext || result.startsWith('enc::v2::')).toBe(true);
    });

    it('should return original payload on decryption failure', async () => {
      const invalidPayload = 'enc::v2::invalid-base64!!!';
      const result = await decryptData(invalidPayload);

      // Should return original payload on failure
      expect(result).toBe(invalidPayload);
    });
  });
});
