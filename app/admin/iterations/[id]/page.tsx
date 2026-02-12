'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface RunRow {
  id: string;
  candidateId: string;
  status: string;
  latencyMs: number | null;
  error: string | null;
  falRequestId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface IterationDetail {
  id: string;
  modelEndpointId: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export default function AdminIterationDetailPage() {
  const params = useParams();
  const iterationId = params.id as string;

  const [iteration, setIteration] = useState<IterationDetail | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!iterationId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/iterations/${iterationId}`);
      if (!response.ok) {
        if (response.status === 404) throw new Error('Iteration not found');
        throw new Error('Failed to fetch iteration');
      }
      const data = await response.json();
      setIteration(data.iteration);
      setRuns(data.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [iterationId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200';
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200';
      case 'running':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200';
      case 'queued':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200';
      default:
        return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-200';
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Link
              href="/admin/iterations"
              className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              ← Iterations
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">
              Iteration: {iterationId}
            </h1>
            {iteration && (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Started {new Date(iteration.startedAt).toLocaleString()}
                {iteration.finishedAt &&
                  ` · Finished ${new Date(iteration.finishedAt).toLocaleString()}`}
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-zinc-600 dark:text-zinc-400">
            Loading runs...
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Candidate ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Latency (ms)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    fal.ai Request ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Error message
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-zinc-900 dark:text-zinc-50">
                      {run.candidateId}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(
                          run.status
                        )}`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {run.latencyMs != null ? run.latencyMs : '—'}
                    </td>
                    <td className="max-w-[12rem] truncate px-6 py-4 text-sm font-mono text-zinc-600 dark:text-zinc-400" title={run.falRequestId ?? undefined}>
                      {run.falRequestId ?? '—'}
                    </td>
                    <td className="max-w-md px-6 py-4 text-sm text-zinc-600 dark:text-zinc-400">
                      {run.error ? (
                        <span className="break-words text-red-600 dark:text-red-400" title={run.error}>
                          {run.error}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
