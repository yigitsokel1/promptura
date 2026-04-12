'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ModelEndpointWithRelations } from '@/src/db/types';

export default function AdminModelDetailPage() {
  const params = useParams();
  const router = useRouter();
  const modelId = params.id as string;

  const [model, setModel] = useState<ModelEndpointWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchModel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/models/${modelId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch model');
      }
      const data = await response.json();
      setModel(data.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  const handleRefreshResearch = async () => {
    if (!confirm('This will overwrite the existing spec. Continue?')) {
      return;
    }

    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/models/${modelId}/refresh`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to refresh research');
      }

      // Refresh model data
      await fetchModel();
      alert('Research refreshed successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setRefreshing(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setUpdatingStatus(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/models/${modelId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update status');
      }

      const data = await response.json();
      setModel(data.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDeleteModel = async () => {
    if (!model) return;
    if (
      !confirm(
        `Delete model "${model.endpointId}"? This removes the endpoint, its specs, research jobs, and runs. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/models/${modelId}`, { method: 'DELETE' });
      if (response.status === 404) {
        throw new Error('Model not found');
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          typeof errorData.error === 'string' ? errorData.error : 'Failed to delete model'
        );
      }
      router.push('/admin/models');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setDeleting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200';
      case 'disabled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200';
      case 'pending_research':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200';
      default:
        return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-200';
    }
  };

  const getJobStatusColor = (status: string) => {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-zinc-600 dark:text-zinc-400">Loading...</p>
        </main>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">
              {error || 'Model not found'}
            </p>
          </div>
          <Link
            href="/admin/models"
            className="mt-4 inline-block text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            ← Back to Models
          </Link>
        </main>
      </div>
    );
  }

  const latestSpec = model.modelSpecs?.[0];
  const latestJob = model.researchJobs?.[0];

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link
            href="/admin/models"
            className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            ← Back to Models
          </Link>
          <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">
            Model Details
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {model.endpointId}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Model Metadata */}
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Metadata
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Endpoint ID
              </label>
              <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                {model.endpointId}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Kind
              </label>
              <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                {model.kind}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Modality
              </label>
              <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                {model.modality}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Status
              </label>
              <div className="mt-1">
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(
                    model.status
                  )}`}
                >
                  {model.status}
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Source
              </label>
              <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                {model.source}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Created At
              </label>
              <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                {new Date(model.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Status Update */}
          <div className="mt-6">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Update Status
            </label>
            <div className="flex gap-2">
              <select
                value={model.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                disabled={updatingStatus}
                className="rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="pending_research">Pending Research</option>
              </select>
            </div>
          </div>

          <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Remove this endpoint from the catalog. Related specs, research jobs, and runs are deleted.
              </p>
              <button
                type="button"
                onClick={handleDeleteModel}
                disabled={deleting}
                className="shrink-0 self-start rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30 sm:self-auto"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>

        {/* Latest Research Job */}
        {latestJob && model.researchJobs && (
          <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Latest Research Job
            </h2>
            <div className="space-y-2">
              <div>
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Status
                </label>
                <div className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getJobStatusColor(
                      latestJob.status
                    )}`}
                  >
                    {latestJob.status}
                  </span>
                </div>
              </div>
              {latestJob.startedAt && (
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Started At
                  </label>
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                    {new Date(latestJob.startedAt).toLocaleString()}
                  </p>
                </div>
              )}
              {latestJob.finishedAt && (
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Finished At
                  </label>
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                    {new Date(latestJob.finishedAt).toLocaleString()}
                  </p>
                </div>
              )}
              {latestJob.error && (
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Root cause (error)
                  </label>
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-words">
                    {latestJob.error}
                  </p>
                </div>
              )}
              {(latestJob.retryCount != null && latestJob.retryCount > 0) && (
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Retry count
                  </label>
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                    {latestJob.retryCount}
                  </p>
                </div>
              )}
              {latestJob.runAt && (
                <div>
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Next run (backoff)
                  </label>
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                    {new Date(latestJob.runAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modality debug panel — why did modality come out like this? */}
        {Boolean(
          latestSpec?.specJson &&
            typeof latestSpec.specJson === 'object' &&
            'modality_debug' in (latestSpec.specJson as object)
        ) && (
          <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Modality debug
            </h2>
            <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              How modality and required_assets were derived (schema-asset-analyzer).
            </p>
            <pre className="max-h-80 overflow-auto rounded-md border border-zinc-300 bg-zinc-50 p-4 text-xs dark:border-zinc-700 dark:bg-zinc-800">
              {JSON.stringify(
                (latestSpec.specJson as { modality_debug?: unknown }).modality_debug,
                null,
                2
              )}
            </pre>
          </div>
        )}

        {/* Model Spec */}
        {latestSpec ? (
          <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
                Model Spec (Latest)
              </h2>
              <button
                onClick={handleRefreshResearch}
                disabled={refreshing}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                {refreshing ? 'Refreshing...' : 'Refresh Research'}
              </button>
            </div>
            <div className="space-y-2 mb-4">
              <div>
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Researched At
                </label>
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                  {new Date(latestSpec.researchedAt).toLocaleString()}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Researched By
                </label>
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                  {latestSpec.researchedBy}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Schema Version
                </label>
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                  {latestSpec.schemaVersion}
                </p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                Spec JSON
              </label>
              <pre className="max-h-96 overflow-auto rounded-md border border-zinc-300 bg-zinc-50 p-4 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                {JSON.stringify(latestSpec.specJson, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
                Model Spec
              </h2>
              <button
                onClick={handleRefreshResearch}
                disabled={refreshing}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                {refreshing ? 'Refreshing...' : 'Start Research'}
              </button>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No spec available. Click &quot;Start Research&quot; to generate one.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
