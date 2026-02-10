import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 font-sans dark:from-zinc-950 dark:to-black">
      <main className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        {/* Hero */}
        <div className="text-center">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-6xl">
            Promptura
          </h1>
          <p className="mt-4 text-xl text-zinc-600 dark:text-zinc-300">
            Iteratively discover the best prompt for your task
          </p>
        </div>

        {/* What it does */}
        <div className="mt-16 rounded-2xl border border-zinc-200/80 bg-white/80 p-8 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            What it does
          </h2>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Promptura takes a task description and a fal.ai model: it generates diverse
            candidate prompts, runs them on the model, and shows results side by side.
            You pick the outputs you like and add notes; the next round produces 10
            refined prompts based on your feedback. Instead of trial and error, you get
            a structured loop to find the right prompt.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-500 dark:text-amber-400">•</span>
              <span><strong className="text-zinc-800 dark:text-zinc-200">Enter a task:</strong> e.g. “A woman sifting flour on a horse” — describe your goal for text or image generation.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-500 dark:text-amber-400">•</span>
              <span><strong className="text-zinc-800 dark:text-zinc-200">Generate 20 candidates:</strong> Gemini produces 20 different prompts tailored to your chosen model’s spec.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-500 dark:text-amber-400">•</span>
              <span><strong className="text-zinc-800 dark:text-zinc-200">Review results:</strong> Each prompt is run on fal.ai; image or text outputs appear as cards.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-500 dark:text-amber-400">•</span>
              <span><strong className="text-zinc-800 dark:text-zinc-200">Select and refine:</strong> Choose the ones you like and add notes; the next round generates 10 improved prompts.</span>
            </li>
          </ul>
        </div>

        {/* CTA */}
        <div className="mt-12 text-center">
          <Link
            href="/playground"
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-8 py-4 text-lg font-semibold text-white shadow-lg transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            Go to Playground
            <span className="text-xl" aria-hidden>→</span>
          </Link>
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            Define a task and pick a model to get started.
          </p>
        </div>

        {/* Secondary: Admin */}
        <div className="mt-16 flex justify-center">
          <Link
            href="/admin/models"
            className="text-sm font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:decoration-zinc-600 dark:hover:text-zinc-300"
          >
            Model management (Admin)
          </Link>
        </div>
      </main>
    </div>
  );
}
