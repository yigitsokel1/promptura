import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import { SettingsProviderKeys } from '@/app/components/SettingsProviderKeys';

/**
 * Unified Settings: Account + Provider API keys. Login required via middleware.
 */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login?callbackUrl=/settings');
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Manage your account and API keys for the Playground.
        </p>

        {/* Account */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Account
          </h2>
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Signed in as <span className="font-medium text-zinc-900 dark:text-white">{session.user.email ?? 'Unknown'}</span>.
            </p>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/' });
              }}
              className="mt-4"
            >
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </form>
          </div>
        </section>

        {/* Provider keys */}
        <section className="mt-10">
          <SettingsProviderKeys />
        </section>
      </main>
    </div>
  );
}
