import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/src/lib/auth';

/**
 * Admin layout: enforce ADMIN role from DB (server-side).
 * Middleware may not have session on Edge; this guarantees only admins see admin UI.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();
  if (!admin) {
    redirect('/');
  }
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href="/playground"
            className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            ← Back to Playground
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}
