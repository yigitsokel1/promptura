/**
 * Blok B: AES-256-GCM encryption for user provider keys.
 * Plaintext never stored in DB. Secret from env.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.PROVIDER_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'PROVIDER_KEY_ENCRYPTION_SECRET must be set and at least 16 characters (use 32+ for production)'
    );
  }
  return scryptSync(secret, 'promptura-provider-keys', KEY_LEN);
}

/**
 * Encrypt plaintext. Returns base64(iv:authTag:ciphertext). Not reversible without env secret.
 */
export function encryptProviderKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

/**
 * Decrypt value from DB. Throws if secret wrong or payload tampered.
 */
export function decryptProviderKey(encrypted: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(encrypted, 'base64');
  if (buf.length < IV_LEN + AUTH_TAG_LEN) {
    throw new Error('Invalid encrypted payload');
  }
  let offset = 0;
  const iv = buf.subarray(offset, (offset += IV_LEN));
  const authTag = buf.subarray(offset, (offset += AUTH_TAG_LEN));
  const ciphertext = buf.subarray(offset);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
