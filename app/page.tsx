import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-black dark:text-zinc-50 sm:text-6xl">
            PromptAura
          </h1>
          <p className="mt-6 text-xl leading-8 text-zinc-600 dark:text-zinc-400">
            Iteratively discover the best prompt for your task
          </p>
          <p className="mt-4 text-lg text-zinc-500 dark:text-zinc-500">
            Generate, test, refine, and optimize prompts with AI-powered iteration
          </p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-3">
          <Link
            href="/iterations"
            className="group rounded-lg border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
              Prompt Iteration
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Generate 20 candidate prompts, test them, select the best ones, and refine
              iteratively to find the perfect prompt.
            </p>
            <div className="mt-4 text-sm font-medium text-zinc-900 group-hover:text-zinc-600 dark:text-zinc-50 dark:group-hover:text-zinc-400">
              Start iterating →
            </div>
          </Link>

          <Link
            href="/playground"
            className="group rounded-lg border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
              Playground
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Generate 20 candidate prompts, test them, select the best ones, and refine
              iteratively to find the perfect prompt.
            </p>
            <div className="mt-4 text-sm font-medium text-zinc-900 group-hover:text-zinc-600 dark:text-zinc-50 dark:group-hover:text-zinc-400">
              Start iterating →
            </div>
          </Link>

          <Link
            href="/admin/models"
            className="group rounded-lg border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
              Admin Panel
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Manage models, view specs, and trigger research jobs. Monitor model
              status and refresh specifications.
            </p>
            <div className="mt-4 text-sm font-medium text-zinc-900 group-hover:text-zinc-600 dark:text-zinc-50 dark:group-hover:text-zinc-400">
              Manage models →
            </div>
          </Link>
        </div>

        <div className="mt-16 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
            How it works
          </h2>
          <ol className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                1
              </span>
              <span>
                <strong className="text-zinc-900 dark:text-zinc-50">Discover:</strong>{' '}
                Models are validated and researched using Gemini to generate normalized
                specifications
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                2
              </span>
              <span>
                <strong className="text-zinc-900 dark:text-zinc-50">Iterate:</strong> Use
                the Playground to generate 20 candidate prompts, test them, and refine
                based on feedback
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                3
              </span>
              <span>
                <strong className="text-zinc-900 dark:text-zinc-50">Refine:</strong>{' '}
                Select the best candidates and generate 10 refined prompts based on your
                feedback
              </span>
            </li>
          </ol>
        </div>
      </main>
    </div>
  );
}
