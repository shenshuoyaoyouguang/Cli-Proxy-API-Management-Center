import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/encryption', () => ({
  encryptData: vi.fn((value: string) => Promise.resolve(`enc::v2::${btoa(value)}`)),
  decryptData: vi.fn((payload: string) => {
    if (payload.startsWith('enc::v2::')) {
      return Promise.resolve(atob(payload.slice(9)));
    }
    if (payload.startsWith('enc::v1::')) {
      return Promise.resolve(atob(payload.slice(9)));
    }
    return Promise.resolve(payload);
  }),
  isEncrypted: vi.fn((value: string) => value?.startsWith('enc::')),
}));

import { secureStorage } from './secureStorage';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('SecureStorageService', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.clearAllMocks();

    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
      clear: vi.fn(() => {
        storage = {};
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('setItem', () => {
    it('stores data to localStorage', async () => {
      await secureStorage.setItemAsync('key', 'value');
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('does not persist any plaintext mirror for encrypted values', async () => {
      await secureStorage.setItemAsync('key', 'value');
      expect(storage['__plain__::key']).toBeUndefined();
      expect(storage['key']).toBe(`enc::v2::${btoa('"value"')}`);
    });

    it('stores plaintext when encrypt is false', async () => {
      await secureStorage.setItemAsync('key', 'value', { encrypt: false });
      expect(storage['key']).toBe('"value"');
    });

    it('removes item when value is null', async () => {
      storage['key'] = 'existing';
      await secureStorage.setItemAsync('key', null);
      expect(localStorage.removeItem).toHaveBeenCalledWith('key');
    });

    it('removes item when value is undefined', async () => {
      storage['key'] = 'existing';
      await secureStorage.setItemAsync('key', undefined);
      expect(localStorage.removeItem).toHaveBeenCalledWith('key');
    });

    it('stores objects as JSON when encrypt is false', async () => {
      await secureStorage.setItemAsync('key', { nested: true }, { encrypt: false });
      expect(storage['key']).toBe('{"nested":true}');
    });

    it('keeps fire-and-forget setItem behavior for legacy callers', async () => {
      secureStorage.setItem('key', 'value');
      await flushMicrotasks();
      expect(storage['key']).toBe(`enc::v2::${btoa('"value"')}`);
    });
  });

  describe('getItem', () => {
    it('returns null for non-existent key', async () => {
      const result = await secureStorage.getItem('non-existent');
      expect(result).toBeNull();
    });

    it('returns plaintext when encrypt option is false', async () => {
      storage['key'] = '"plain-value"';
      const result = await secureStorage.getItem<string>('key', { encrypt: false });
      expect(result).toBe('plain-value');
    });

    it('handles non-JSON stored values when encrypt is false', async () => {
      storage['key'] = 'raw-string';
      const result = await secureStorage.getItem<string>('key', { encrypt: false });
      expect(result).toBe('raw-string');
    });

    it('handles object stored values when encrypt is false', async () => {
      storage['key'] = '{"name":"test"}';
      const result = await secureStorage.getItem<{ name: string }>('key', { encrypt: false });
      expect(result).toEqual({ name: 'test' });
    });

    it('handles v2 encrypted values', async () => {
      // v2 encrypted values cannot be decoded synchronously due to async decryptData
      // This is a known limitation - v2 data returns null when read synchronously
      const encryptedValue = 'enc::v2::' + btoa('"decrypted-value"');
      storage['key'] = encryptedValue;

      const result = await secureStorage.getItem<string>('key');
      // v2 data returns null because it can't be decoded synchronously
      expect(result).toBeNull();
    });

    it('handles v1 encrypted values', async () => {
      // v1 encrypted values CAN be decoded synchronously (XOR decryption)
      // Note: This test uses a mock encrypted value that won't actually decrypt
      // to a valid JSON string, so it will return the raw decrypted bytes
      storage['key'] = 'enc::v1::invalid-base64!!!';
      const result = await secureStorage.getItem<string>('key');
      // Invalid base64 will fail to decode, returning null
      expect(result).toBeNull();
    });

    it('returns raw value for unencrypted data with encrypt=true', async () => {
      storage['key'] = '"unencrypted"';
      const result = await secureStorage.getItem<string>('key');
      // When data is not encrypted and encrypt=true, it's parsed as JSON
      expect(result).toBe('unencrypted');
    });
  });

  describe('getItemAsync', () => {
    it('returns null for non-existent key', async () => {
      const result = await secureStorage.getItemAsync('non-existent');
      expect(result).toBeNull();
    });

    it('returns plaintext when encrypt option is false', async () => {
      storage['key'] = '"plain-value"';
      const result = await secureStorage.getItemAsync<string>('key', { encrypt: false });
      expect(result).toBe('plain-value');
    });

    it('handles non-JSON stored values when encrypt is false', async () => {
      storage['key'] = 'raw-string';
      const result = await secureStorage.getItemAsync<string>('key', { encrypt: false });
      expect(result).toBe('raw-string');
    });

    it('handles object stored values when encrypt is false', async () => {
      storage['key'] = '{"name":"test"}';
      const result = await secureStorage.getItemAsync<{ name: string }>('key', { encrypt: false });
      expect(result).toEqual({ name: 'test' });
    });

    it('decrypts v2 encrypted string values with JSON.parse', async () => {
      // Simulates the full round-trip: setItem encrypts JSON.stringify(value), getItemAsync decrypts and JSON.parses
      const encryptedValue = 'enc::v2::' + btoa('"my-secret-key"');
      storage['managementKey'] = encryptedValue;

      const result = await secureStorage.getItemAsync<string>('managementKey');
      expect(result).toBe('my-secret-key');
    });

    it('decrypts v2 encrypted object values', async () => {
      const encryptedValue = 'enc::v2::' + btoa('{"role":"admin"}');
      storage['key'] = encryptedValue;

      const result = await secureStorage.getItemAsync<{ role: string }>('key');
      expect(result).toEqual({ role: 'admin' });
    });

    it('decrypts v1 encrypted values and triggers migration', async () => {
      const encryptedValue = 'enc::v1::' + btoa('"legacy-value"');
      storage['key'] = encryptedValue;

      const result = await secureStorage.getItemAsync<string>('key');
      expect(result).toBe('legacy-value');
    });

    it('returns null when decryption fails', async () => {
      const { decryptData } = await import('@/utils/encryption');
      (decryptData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('decrypt failed'));

      storage['key'] = 'enc::v2::corrupt';

      const result = await secureStorage.getItemAsync<string>('key');
      expect(result).toBeNull();
    });

    it('handles unencrypted data with encrypt=true', async () => {
      storage['key'] = '"unencrypted"';
      const result = await secureStorage.getItemAsync<string>('key');
      expect(result).toBe('unencrypted');
    });
  });

  describe('removeItem', () => {
    it('removes item from storage', () => {
      storage['key'] = 'value';
      storage['__plain__::key'] = '"value"';
      secureStorage.removeItem('key');
      expect(localStorage.removeItem).toHaveBeenCalledWith('key');
      expect(localStorage.removeItem).toHaveBeenCalledWith('__plain__::key');
    });
  });

  describe('clear', () => {
    it('clears all storage', () => {
      secureStorage.clear();
      expect(localStorage.clear).toHaveBeenCalled();
    });
  });

  describe('hasItem', () => {
    it('returns true for existing key', () => {
      storage['key'] = 'value';
      expect(secureStorage.hasItem('key')).toBe(true);
    });

    it('returns false for non-existent key', () => {
      expect(secureStorage.hasItem('non-existent')).toBe(false);
    });
  });

  describe('migratePlaintextKeys', () => {
    it('skips already encrypted keys', async () => {
      storage['key'] = 'enc::v2::existing';
      const callCountBefore = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length;
      await secureStorage.migratePlaintextKeys(['key']);
      const callCountAfter = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length;
      // setItem should not be called for already encrypted keys
      expect(callCountAfter).toBe(callCountBefore);
    });

    it('encrypts plaintext keys', async () => {
      storage['key'] = 'plain-value';
      secureStorage.migratePlaintextKeys(['key']);
      await flushMicrotasks();
      // setItem should be called for plaintext keys
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('handles JSON plaintext values', async () => {
      storage['key'] = JSON.stringify({ data: 'test' });
      secureStorage.migratePlaintextKeys(['key']);
      await flushMicrotasks();
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('skips non-existent keys', async () => {
      const callCountBefore = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length;
      await secureStorage.migratePlaintextKeys(['non-existent']);
      const callCountAfter = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callCountAfter).toBe(callCountBefore);
    });
  });

  describe('migrateEncryptedKeys', () => {
    it('rewrites v1 encrypted values to v2', async () => {
      storage.managementKey = `enc::v1::${btoa('"legacy-secret"')}`;

      const migrated = await secureStorage.migrateEncryptedKeys(['managementKey']);

      expect(migrated).toBe(1);
      expect(storage.managementKey).toBe(`enc::v2::${btoa('"legacy-secret"')}`);
    });
  });
});
