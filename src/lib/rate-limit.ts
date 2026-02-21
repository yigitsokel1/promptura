/**
 * Rate limit for expensive API routes (e.g. iteration/generate).
 * Persistent store (DB) so limits survive restart and work across instances.
 */

import { prisma } from '@/src/db/client';

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

function getBucketTs(now: number): Date {
  return new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
}

/**
 * Check if the identifier (e.g. userId) is over the limit.
 * If under limit, records this request and returns true. If over, returns false.
 */
export async function checkRateLimit(identifier: string): Promise<boolean> {
  const now = Date.now();
  const bucketTs = getBucketTs(now);
  const cutoff = new Date(now - WINDOW_MS);

  return prisma.$transaction(async (tx) => {
    await tx.rateLimitBucket.deleteMany({
      where: { bucketTs: { lt: cutoff } },
    });

    const bucket = await tx.rateLimitBucket.findUnique({
      where: {
        identifier_bucketTs: { identifier, bucketTs },
      },
    });

    if (bucket && bucket.count >= MAX_REQUESTS_PER_WINDOW) {
      return false;
    }

    if (bucket) {
      await tx.rateLimitBucket.update({
        where: { id: bucket.id },
        data: { count: bucket.count + 1 },
      });
    } else {
      await tx.rateLimitBucket.create({
        data: { identifier, bucketTs, count: 1 },
      });
    }
    return true;
  });
}

export function getRateLimitMax(): number {
  return MAX_REQUESTS_PER_WINDOW;
}

export function getRateLimitWindowMs(): number {
  return WINDOW_MS;
}
