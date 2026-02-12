/**
 * Server-side auth helpers (Blok A).
 * Use in API routes and server components to enforce role from DB.
 */
import { auth } from '@/auth';
import { prisma } from '@/src/db/client';

export type AppRole = 'ADMIN' | 'USER';

/**
 * Get current session (from NextAuth).
 * Session user includes role from DB when using database strategy.
 */
export async function getSession() {
  return auth();
}

/**
 * Require authenticated user. Returns session or null if not logged in.
 */
export async function requireAuth() {
  const session = await getSession();
  if (!session?.user) return null;
  return session;
}

/**
 * Require ADMIN role. Fetches role from DB (single source of truth).
 * Returns { session, user } or null if not admin.
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session?.user?.email) return null;

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, role: true },
  });

  if (!user || user.role !== 'ADMIN') return null;
  return { session, user };
}

/**
 * Check if current user has ADMIN role (from DB).
 */
export async function isAdmin(): Promise<boolean> {
  const admin = await requireAdmin();
  return !!admin;
}

/** Use in API routes: return this when requireAdmin() is null */
export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
