/**
 * Blok B: User provider keys (encrypted). Never return plaintext to client.
 */

import { prisma } from '@/src/db/client';
import { encryptProviderKey, decryptProviderKey } from './encryption';

// Prisma client with UserProviderKey (generated after migration)
const db = prisma as typeof prisma & {
  userProviderKey: {
    findUnique: (args: { where: { userId_provider: { userId: string; provider: string } } }) => Promise<{ encryptedKey: string } | null>;
    findMany: (args: { where: { userId: string }; select: { provider: true } }) => Promise<{ provider: string }[]>;
    upsert: (args: {
      where: { userId_provider: { userId: string; provider: string } };
      create: { userId: string; provider: string; encryptedKey: string };
      update: { encryptedKey: string };
    }) => Promise<unknown>;
    deleteMany: (args: { where: { userId: string; provider: string } }) => Promise<unknown>;
  };
};

export type ProviderSlug = 'falai' | 'eachlabs';

const PROVIDERS: ProviderSlug[] = ['falai', 'eachlabs'];

export function getSupportedProviders(): ProviderSlug[] {
  return [...PROVIDERS];
}

/**
 * Get decrypted API key for user + provider. Returns null if not set.
 * Throws if decryption fails (e.g. wrong PROVIDER_KEY_ENCRYPTION_SECRET).
 */
export async function getUserProviderKey(
  userId: string,
  provider: ProviderSlug
): Promise<string | null> {
  const row = await db.userProviderKey.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!row?.encryptedKey) return null;
  try {
    return decryptProviderKey(row.encryptedKey);
  } catch {
    return null;
  }
}

/**
 * Require key for user + provider. Throws with clear message if missing.
 */
export async function requireUserProviderKey(
  userId: string,
  provider: ProviderSlug
): Promise<string> {
  const key = await getUserProviderKey(userId, provider);
  if (!key) {
    const name = provider === 'falai' ? 'fal.ai' : 'eachlabs';
    throw new Error(
      `No API key configured for ${name}. Add your key in Settings → Provider keys.`
    );
  }
  return key;
}

/**
 * Save or update encrypted key. Plaintext never stored.
 */
export async function setUserProviderKey(
  userId: string,
  provider: ProviderSlug,
  plaintextKey: string
): Promise<void> {
  const trimmed = plaintextKey.trim();
  if (!trimmed) {
    await db.userProviderKey.deleteMany({
      where: { userId, provider },
    });
    return;
  }
  const encrypted = encryptProviderKey(trimmed);
  await db.userProviderKey.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, encryptedKey: encrypted },
    update: { encryptedKey: encrypted },
  });
}

/**
 * List which providers have a key (no values). For UI "configured" badges.
 */
export async function listUserProviderKeys(
  userId: string
): Promise<Record<ProviderSlug, boolean>> {
  const rows = await db.userProviderKey.findMany({
    where: { userId },
    select: { provider: true },
  });
  const set = new Set(rows.map((r) => r.provider as ProviderSlug));
  return {
    falai: set.has('falai'),
    eachlabs: set.has('eachlabs'),
  };
}
