/**
 * 加密工具函数
 * 从原项目 src/utils/secure-storage.js 迁移
 * v2: 使用 AES-256-GCM 替换 XOR 加密
 */

const ENC_PREFIX = 'enc::v1::';
const ENC_PREFIX_V2 = 'enc::v2::';
const SECRET_SALT = 'cli-proxy-api-webui::secure-storage';

// Fixed salt for PBKDF2 key derivation (32 bytes)
const PBKDF2_SALT = new Uint8Array([
  0x7a, 0x1f, 0x9c, 0x8b, 0x4d, 0x2e, 0x6a, 0x5f, 0x3c, 0x7d, 0x8e, 0x9f, 0x1a, 0x2b, 0x3c, 0x4d,
  0x5e, 0x6f, 0x7a, 0x8b, 0x9c, 0xad, 0xbe, 0xcf, 0xd0, 0xe1, 0xf2, 0x03, 0x14, 0x25, 0x36, 0x47,
]);

let cachedKeyBytes: Uint8Array | null = null;
let cachedCryptoKey: CryptoKey | null = null;

function encodeText(text: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

function decodeText(bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 获取用于 XOR 加密的密钥字节（v1 兼容）
 * @deprecated 保留用于 v1 解密向后兼容
 */
export function getKeyBytes(): Uint8Array {
  if (cachedKeyBytes) return cachedKeyBytes;

  try {
    const host = window.location.host;
    const ua = navigator.userAgent;
    cachedKeyBytes = encodeText(`${SECRET_SALT}|${host}|${ua}`);
  } catch (error) {
    console.warn('Encryption fallback to simple key:', error);
    cachedKeyBytes = encodeText(SECRET_SALT);
  }

  return cachedKeyBytes;
}

function xorBytes(data: Uint8Array, keyBytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return result;
}

/**
 * 使用 PBKDF2 从 SECRET_SALT 派生 AES-256 密钥
 */
async function deriveAesKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(encodeText(SECRET_SALT)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: PBKDF2_SALT,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  cachedCryptoKey = key;
  return key;
}

/**
 * 使用 AES-256-GCM 加密数据
 */
async function encryptAesGcm(plaintext: string): Promise<string> {
  const key = await deriveAesKey();

  // 生成随机 12 字节 IV
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array;

  const encoded = new Uint8Array(encodeText(plaintext));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(iv),
    },
    key,
    encoded
  );

  // 组合 IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return `${ENC_PREFIX_V2}${toBase64(combined)}`;
}

/**
 * 使用 AES-256-GCM 解密数据
 */
async function decryptAesGcm(encryptedPayload: string): Promise<string> {
  const key = await deriveAesKey();

  const combined = fromBase64(encryptedPayload);

  // 提取 IV (前 12 字节) 和密文
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    ciphertext
  );

  return decodeText(new Uint8Array(decrypted));
}

/**
 * 加密数据（使用 AES-256-GCM，v2）
 * @returns 返回加密后的字符串，格式为 enc::v2::{base64(iv+ciphertext)}
 */
export async function encryptData(value: string): Promise<string> {
  if (!value) return value;

  try {
    return await encryptAesGcm(value);
  } catch (error) {
    console.warn('AES-GCM encryption failed, fallback to plaintext:', error);
    return value;
  }
}

/**
 * 解密数据（支持 v1 XOR 和 v2 AES-GCM）
 * @param payload 加密的数据，支持 enc::v1:: 和 enc::v2:: 格式
 * @returns 解密后的字符串
 */
export async function decryptData(payload: string): Promise<string> {
  if (!payload) return payload;

  // v2 AES-GCM 解密
  if (payload.startsWith(ENC_PREFIX_V2)) {
    try {
      const encodedBody = payload.slice(ENC_PREFIX_V2.length);
      return await decryptAesGcm(encodedBody);
    } catch (error) {
      console.warn('V2 decryption failed, return as-is:', error);
      return payload;
    }
  }

  // v1 XOR 解密
  if (payload.startsWith(ENC_PREFIX)) {
    try {
      const encodedBody = payload.slice(ENC_PREFIX.length);
      const encrypted = fromBase64(encodedBody);
      const decrypted = xorBytes(encrypted, getKeyBytes());
      return decodeText(decrypted);
    } catch (error) {
      console.warn('V1 decryption failed, return as-is:', error);
      return payload;
    }
  }

  // 未加密的数据直接返回
  return payload;
}

/**
 * 检查是否已加密（支持 v1 和 v2）
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENC_PREFIX) || value?.startsWith(ENC_PREFIX_V2) || false;
}

/**
 * 同步解密数据（仅支持 v1 XOR，用于向后兼容）
 * @deprecated 请使用 decryptData() 获取完整 v1/v2 支持
 */
export function decryptDataSync(payload: string): string {
  if (!payload) return payload;

  // v1 XOR 解密
  if (payload.startsWith(ENC_PREFIX)) {
    try {
      const encodedBody = payload.slice(ENC_PREFIX.length);
      const encrypted = fromBase64(encodedBody);
      const decrypted = xorBytes(encrypted, getKeyBytes());
      return decodeText(decrypted);
    } catch (error) {
      console.warn('V1 decryption failed, return as-is:', error);
      return payload;
    }
  }

  // v2 数据无法同步解密，返回原值
  if (payload.startsWith(ENC_PREFIX_V2)) {
    console.warn('V2 encrypted data requires async decryptData()');
    return payload;
  }

  return payload;
}
