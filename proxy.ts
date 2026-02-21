/**
 * Blok A: Route protection (Next.js proxy convention, formerly middleware)
 * - /admin/* → ADMIN only (from DB)
 * - /settings/*, /playground → login required
 */
import { auth } from '@/auth';

const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const isLoggedIn = !!session?.user;

  // Auth routes: allow through (NextAuth handles them)
  if (pathname.startsWith('/api/auth') || pathname === '/login') {
    return;
  }

  // Admin: require ADMIN role from DB
  if (pathname.startsWith('/admin')) {
    if (!isLoggedIn) {
      const login = new URL('/login', req.nextUrl.origin);
      login.searchParams.set('callbackUrl', pathname);
      return Response.redirect(login);
    }
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (role !== 'ADMIN') {
      return Response.redirect(new URL('/', req.nextUrl.origin));
    }
    return;
  }

  // Settings and Playground: login required
  if (pathname.startsWith('/settings') || pathname === '/playground') {
    if (!isLoggedIn) {
      const login = new URL('/login', req.nextUrl.origin);
      login.searchParams.set('callbackUrl', pathname);
      return Response.redirect(login);
    }
  }

  return;
});

export default proxy;

export const config = {
  matcher: [
    /*
     * Match all paths except static files and API routes that are not auth.
     * NextAuth handles /api/auth/*
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
