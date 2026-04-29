/**
 * 安全存储服务
 * 基于原项目 src/utils/secure-storage.js
 * 注意：由于部分调用方仍依赖同步读取，v2 AES-GCM 数据无法同步解密。
 * 因此该服务不再保留任何明文镜像，敏感值不应再放入 Web Storage。
 */

import { encryptData, isEncrypted } from '@/utils/encryption';

interface StorageOptions {
  encrypt?: boolean;
}

class SecureStorageService {
  private migrateLegacyValue(key: string, value: unknown): void {
    try {
      this.setItem(key, value);
    } catch {
      // 读取旧值成功时优先保证兼容返回，迁移失败不影响本次恢复流程。
    }
  }

  private decodeStoredValue(
    raw: string,
    encrypt: boolean
  ): { serialized: string; legacyEncrypted: boolean } | null {
    if (!encrypt) {
      return { serialized: raw, legacyEncrypted: false };
    }

    // 注意：decryptData 是异步的，但 Zustand persist 需要同步接口。
    // 对于 v2 数据，无法同步解密，因此直接返回 null。
    if (raw.startsWith('enc::v2::')) {
      console.warn('V2 encrypted data cannot be decoded synchronously');
      return null;
    }

    // 回退到 plain:: 前缀的明文（异步加密前的原始值）
    if (raw.startsWith('plain::')) {
      return { serialized: raw.slice('plain::'.length), legacyEncrypted: false };
    }

    if (raw.startsWith('enc::v1::')) {
      try {
        // v1 可以同步解密
        const encodedBody = raw.slice('enc::v1::'.length);
        const binary = atob(encodedBody);
        const encrypted = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          encrypted[i] = binary.charCodeAt(i);
        }
        // 获取 v1 密钥
        const keyBytes = this.getV1KeyBytes();
        const decrypted = new Uint8Array(encrypted.length);
        for (let i = 0; i < encrypted.length; i++) {
          decrypted[i] = encrypted[i] ^ keyBytes[i % keyBytes.length];
        }
        const decoder = new TextDecoder();
        const serialized = decoder.decode(decrypted);
        return { serialized, legacyEncrypted: true };
      } catch {
        return null;
      }
    }

    return { serialized: raw, legacyEncrypted: false };
  }

  private getV1KeyBytes(): Uint8Array {
    try {
      const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
      const encoder = new TextEncoder();
      return encoder.encode(`cli-proxy-api-webui::secure-storage|${host}|${ua}`);
    } catch {
      const encoder = new TextEncoder();
      return encoder.encode('cli-proxy-api-webui::secure-storage');
    }
  }

  /**
   * 存储数据
   * 注意：由于 Zustand persist 需要同步接口，加密过程异步执行。
   * 该方法不会保留任何明文镜像，敏感值不应依赖同步恢复。
   */
  setItem(key: string, value: unknown, options: StorageOptions = {}): void {
    const { encrypt = true } = options;

    if (value === null || value === undefined) {
      this.removeItem(key);
      return;
    }

    const stringValue = JSON.stringify(value);

    if (encrypt) {
      localStorage.removeItem(key);
      void encryptData(stringValue)
        .then((encrypted) => {
          localStorage.setItem(key, encrypted);
        })
        .catch((error) => {
          console.error('Encryption failed, encrypted data was not persisted:', error);
        });
    } else {
      localStorage.setItem(key, stringValue);
    }
  }

  /**
   * 获取数据
   */
  getItem<T = unknown>(key: string, options: StorageOptions = {}): T | null {
    const { encrypt = true } = options;

    const raw = localStorage.getItem(key);
    if (raw === null) return null;

    const decoded = this.decodeStoredValue(raw, encrypt);
    if (!decoded) {
      return null;
    }

    try {
      const parsed = JSON.parse(decoded.serialized) as T;

      if (encrypt && decoded.legacyEncrypted) {
        this.migrateLegacyValue(key, parsed);
      }

      return parsed;
    } catch {
      if (encrypt && decoded.legacyEncrypted) {
        this.migrateLegacyValue(key, decoded.serialized);
      }

      return decoded.serialized as T;
    }
  }

  /**
   * 删除数据
   */
  removeItem(key: string): void {
    localStorage.removeItem(key);
    localStorage.removeItem(`__plain__::${key}`);
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    localStorage.clear();
  }

  /**
   * 迁移旧的明文缓存为加密格式
   */
  migratePlaintextKeys(keys: string[]): void {
    keys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;

      // 如果已经是加密格式，跳过
      if (isEncrypted(raw)) {
        return;
      }

      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 原值不是 JSON，直接使用字符串
        parsed = raw;
      }

      try {
        this.setItem(key, parsed);
      } catch (error) {
        console.warn(`Failed to migrate key "${key}":`, error);
      }
    });
  }

  /**
   * 检查键是否存在
   */
  hasItem(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }
}

export const secureStorage = new SecureStorageService();
