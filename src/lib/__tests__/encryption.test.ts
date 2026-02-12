/**
 * Blok E: Unit tests for provider key encryption/decryption
 */
import { encryptProviderKey, decryptProviderKey } from '../encryption';

const MIN_SECRET = 'a'.repeat(16);

describe('encryption', () => {
  const origSecret = process.env.PROVIDER_KEY_ENCRYPTION_SECRET;

  afterEach(() => {
    process.env.PROVIDER_KEY_ENCRYPTION_SECRET = origSecret;
  });

  describe('encryptProviderKey / decryptProviderKey', () => {
    beforeEach(() => {
      process.env.PROVIDER_KEY_ENCRYPTION_SECRET = MIN_SECRET;
    });

    it('round-trips plaintext', () => {
      const plain = 'sk-secret-key-12345';
      const encrypted = encryptProviderKey(plain);
      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(plain);
      expect(decryptProviderKey(encrypted)).toBe(plain);
    });

    it('produces different ciphertext each time (IV is random)', () => {
      const plain = 'same-input';
      const a = encryptProviderKey(plain);
      const b = encryptProviderKey(plain);
      expect(a).not.toBe(b);
      expect(decryptProviderKey(a)).toBe(plain);
      expect(decryptProviderKey(b)).toBe(plain);
    });

    it('handles empty string', () => {
      const encrypted = encryptProviderKey('');
      expect(decryptProviderKey(encrypted)).toBe('');
    });

    it('handles long and special characters', () => {
      const plain = 'key-with-special_chars.123\u0000\u00ff';
      expect(decryptProviderKey(encryptProviderKey(plain))).toBe(plain);
    });
  });

  describe('decryptProviderKey', () => {
    beforeEach(() => {
      process.env.PROVIDER_KEY_ENCRYPTION_SECRET = MIN_SECRET;
    });

    it('throws on invalid payload (too short)', () => {
      expect(() => decryptProviderKey('')).toThrow('Invalid encrypted payload');
      expect(() => decryptProviderKey(Buffer.alloc(10).toString('base64'))).toThrow(
        'Invalid encrypted payload'
      );
    });

    it('throws on tampered payload', () => {
      const encrypted = encryptProviderKey('secret');
      const buf = Buffer.from(encrypted, 'base64');
      buf[buf.length - 1] ^= 0xff;
      expect(() => decryptProviderKey(buf.toString('base64'))).toThrow();
    });
  });

  describe('encryptProviderKey', () => {
    it('throws when PROVIDER_KEY_ENCRYPTION_SECRET is missing', () => {
      delete process.env.PROVIDER_KEY_ENCRYPTION_SECRET;
      expect(() => encryptProviderKey('x')).toThrow('PROVIDER_KEY_ENCRYPTION_SECRET');
    });

    it('throws when secret is too short', () => {
      process.env.PROVIDER_KEY_ENCRYPTION_SECRET = 'short';
      expect(() => encryptProviderKey('x')).toThrow('at least 16 characters');
    });
  });

  describe('decryptProviderKey with wrong secret', () => {
    it('throws when decrypted with different secret', () => {
      process.env.PROVIDER_KEY_ENCRYPTION_SECRET = MIN_SECRET;
      const encrypted = encryptProviderKey('secret');
      process.env.PROVIDER_KEY_ENCRYPTION_SECRET = 'b'.repeat(16);
      expect(() => decryptProviderKey(encrypted)).toThrow();
    });
  });
});
