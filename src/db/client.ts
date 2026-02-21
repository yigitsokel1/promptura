/**
 * Prisma Client singleton
 * Use this to access the database throughout the application.
 * In Edge runtime (middleware) we export null so the module loads without Prisma (no Node-only APIs).
 */

import type { PrismaClient } from '@prisma/client';

// Suppress Prisma engine warning: "In production, we recommend using prisma generate --no-engine"
if (typeof process !== 'undefined' && !process.env.PRISMA_DISABLE_WARNINGS) {
  process.env.PRISMA_DISABLE_WARNINGS = '1';
}

const isEdge =
  typeof (globalThis as unknown as { EdgeRuntime?: unknown }).EdgeRuntime !== 'undefined' ||
  process.env.NEXT_RUNTIME === 'edge';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function isP6009(msg: string): boolean {
  return msg.includes('P6009') || msg.includes('response size') || msg.includes('exceeded the the maximum of 5MB');
}

function createPrisma(): PrismaClient | null {
  if (isEdge) return null;
  // Dynamic import to avoid loading Prisma in Edge; eslint no-require-imports waived for conditional Node-only path
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient: PC } = require('@prisma/client');
  const existing = globalForPrisma.prisma;
  if (existing) return existing;
  const p = new PC({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            // Omit 'warn' to avoid "prisma generate --no-engine" spam in terminal
          ]
        : [{ emit: 'event', level: 'error' as const }],
  });
  if (process.env.NODE_ENV === 'development') {
    (p as unknown as { $on: (c: string, fn: (e: unknown) => void) => void }).$on(
      'query',
      (e: unknown) => console.log('[prisma:query]', (e as { query: string }).query)
    );
  }
  (p as unknown as { $on: (c: string, fn: (e: unknown) => void) => void }).$on('error', (e: unknown) => {
    const msg = String((e as { message?: string }).message ?? e);
    if (isP6009(msg)) return;
    console.error('[prisma:error]', msg);
  });
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = p;
  }
  return p;
}

const prismaInstance = createPrisma();

/** Prisma client. Null in Edge runtime (middleware); use only in Node (API routes, server). */
export const prisma = prismaInstance as PrismaClient;
