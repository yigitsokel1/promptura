'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';

export function AppHeader() {
  const { data: session, status } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'ADMIN';

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-6" aria-label="Main">
          <Link
            href="/"
            className="text-lg font-semibold text-zinc-900 dark:text-white hover:text-zinc-600 dark:hover:text-zinc-300 transition"
          >
            Promptura
          </Link>
          <div className="flex items-center gap-4">
            {session?.user && (
              <>
                <Link
                  href="/playground"
                  className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition"
                >
                  Playground
                </Link>
                <Link
                  href="/settings"
                  className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition"
                >
                  Settings
                </Link>
              </>
            )}
            {isAdmin && (
              <Link
                href="/admin/models"
                className="text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition"
              >
                Admin
              </Link>
            )}
          </div>
        </nav>

        <div className="flex items-center gap-3">
          {status === 'loading' ? (
            <span className="text-sm text-zinc-400">…</span>
          ) : session?.user ? (
            <>
              <span className="hidden text-sm text-zinc-500 sm:inline dark:text-zinc-400" title={session.user.email ?? undefined}>
                {session.user.email ?? 'Signed in'}
              </span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/' })}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 transition"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 transition"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
