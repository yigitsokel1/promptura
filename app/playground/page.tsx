'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { TaskSpec, Modality, Iteration, RunOutput, FeedbackItem } from '@/src/core/types';
import type { ModelEndpointWithRelations } from '@/src/db/types';
import { shouldApplyStatusUpdate } from '@/src/lib/iterationPolling';

interface IterationStatus {
  iterationId: string;
  runs: Array<{
    candidateId: string;
    status: 'queued' | 'running' | 'done' | 'error';
    output?: RunOutput;
    latencyMs?: number;
    error?: string;
    queuePosition?: number; // Position in fal.ai queue (if IN_QUEUE)
  }>;
  allDone: boolean;
  hasErrors: boolean;
}

export default function Playground() {
  const [models, setModels] = useState<ModelEndpointWithRelations[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [taskGoal, setTaskGoal] = useState<string>('');
  const [taskModality, setTaskModality] = useState<Modality | null>(null);
  const [iteration, setIteration] = useState<Iteration | null>(null);
  const [iterationStatus, setIterationStatus] = useState<IterationStatus | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customEndpointId, setCustomEndpointId] = useState<string>('');
  const [addModelSource, setAddModelSource] = useState<'fal.ai' | 'eachlabs'>('fal.ai');
  const [addingModel, setAddingModel] = useState(false);
  /** 1 = first iteration (after Generate), 2+ = after Refine (Blok D: "Iteration 1 / 2") */
  const [iterationIndex, setIterationIndex] = useState(1);
  /** Lightbox: show full-size image when user clicks a thumbnail */
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  /** At least one provider (fal.ai or EachLabs) has an API key configured. null = still loading. */
  const [hasProviderKey, setHasProviderKey] = useState<boolean | null>(null);
  const modelsRef = useRef<ModelEndpointWithRelations[]>([]);
  const isInitialLoadRef = useRef(true);
  /** Tracks the iteration we're showing and polling for. Prevents late poll responses from overwriting a newer iteration. */
  const activeIterationIdRef = useRef<string | null>(null);

  // Helper function to map DB modality to TaskSpec Modality
  const mapModalityFromModel = (model: ModelEndpointWithRelations): Modality => {
    // If model has a spec, try to determine from inputs and outputs
    if (model.modelSpecs && model.modelSpecs.length > 0) {
      const spec = model.modelSpecs[0].specJson as { 
        outputs?: { type?: string };
        inputs?: Array<{ type?: string; name?: string }>;
      };
      
      if (spec?.outputs?.type) {
        const outputType = spec.outputs.type.toLowerCase();
        const inputs = spec.inputs || [];
        
        // Check if input is image/video by TYPE first (most reliable)
        // Only check name if type is not explicitly set
        // IMPORTANT: Exclude parameter names like "num_images", "aspect_ratio", etc.
        const hasImageInput = inputs.some((inp) => {
          const type = inp.type?.toLowerCase() || '';
          // Type check is primary - if type is 'image', it's definitely image input
          if (type === 'image') return true;
          // Name check is secondary - only if type is not set or ambiguous
          if (!type || type === 'string') {
            const name = inp.name?.toLowerCase() || '';
            // Common image input names (but exclude parameters like "num_images", "aspect_ratio")
            return (name === 'image' ||
                   name === 'input_image' ||
                   name === 'source_image' ||
                   name === 'img' ||
                   name === 'image_url' ||
                   name === 'image_file') &&
                   !name.includes('num_') &&
                   !name.includes('aspect_');
          }
          return false;
        });
        
        const hasVideoInput = inputs.some((inp) => {
          const type = inp.type?.toLowerCase() || '';
          if (type === 'video') return true;
          if (!type || type === 'string') {
            const name = inp.name?.toLowerCase() || '';
            return name === 'video' || 
                   name === 'input_video' || 
                   name === 'source_video' ||
                   name === 'video_url' ||
                   name === 'video_file';
          }
          return false;
        });
        
        if (outputType === 'image') {
          return hasImageInput ? 'image-to-image' : 'text-to-image';
        }
        
        if (outputType === 'video') {
          if (hasVideoInput) return 'video-to-video';
          if (hasImageInput) return 'image-to-video';
          return 'text-to-video';
        }
        
        if (outputType === 'text') {
          return 'text-to-text';
        }
      }
    }
    
    // Fallback: DB modality field only tells us output type, not input
    // We can't determine input type from DB alone, so we default to text-to-X
    // But this is not ideal - ModelSpec should always be available for active models
    const dbModality = model.modality.toLowerCase();
    if (dbModality === 'image') {
      // For image output, we can't know if it's text-to-image or image-to-image
      // Default to text-to-image, but this should be fixed by having ModelSpec
      console.warn(`Model ${model.endpointId} has no ModelSpec, defaulting to text-to-image. Please ensure ModelSpec is available.`);
      return 'text-to-image';
    }
    if (dbModality === 'video') {
      console.warn(`Model ${model.endpointId} has no ModelSpec, defaulting to text-to-video. Please ensure ModelSpec is available.`);
      return 'text-to-video';
    }
    return 'text-to-text';
  };

  // Update modality when model is selected (always use mapModalityFromModel; it falls back to DB modality when no spec)
  useEffect(() => {
    if (selectedModelId) {
      const selectedModel = models.find((m) => m.id === selectedModelId);
      if (selectedModel) {
        setTaskModality(mapModalityFromModel(selectedModel));
      } else {
        setTaskModality(null);
      }
    } else {
      setTaskModality(null);
    }
  }, [selectedModelId, models]);

  // Fetch models (including pending_research for polling)
  const fetchModels = useCallback(async () => {
    const isInitialLoad = isInitialLoadRef.current;
    if (isInitialLoad) {
      isInitialLoadRef.current = false;
    }
    setError(null);
    try {
      const response = await fetch('/api/playground/models');
      if (!response.ok) throw new Error('Failed to fetch models');
      const data = await response.json();
      const newModels = data.models || [];
      modelsRef.current = newModels;
      // Show active models for selection, but keep pending_research for polling
      setModels(newModels);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  }, []);

  // Load models on mount
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Check if user has at least one provider API key (for Settings warning)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/providers')
      .then((res) => (res.ok ? res.json() : { providers: {} }))
      .then((data) => {
        if (cancelled) return;
        const p = data.providers ?? {};
        setHasProviderKey(Boolean(p.falai || p.eachlabs));
      })
      .catch(() => {
        if (!cancelled) setHasProviderKey(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Poll for model updates when there are pending research models (so list updates when research completes)
  useEffect(() => {
    const hasPending = models.some(
      (m) =>
        m.status === 'pending_research' ||
        ['queued', 'running'].includes(m.researchJobs?.[0]?.status ?? '')
    );
    if (!hasPending) return;

    const poll = () => fetchModels();
    // First refresh soon, then every 3s
    const t1 = setTimeout(poll, 2000);
    const t2 = setInterval(poll, 3000);
    return () => {
      clearTimeout(t1);
      clearInterval(t2);
    };
  }, [fetchModels, models]);

  // Poll for iteration status. Idempotent: only applies updates when status.iterationId matches active iteration (ref). Prevents late/duplicate responses from overwriting state.
  const pollIterationStatus = useCallback(async (iterationId: string) => {
    try {
      const response = await fetch(`/api/iterations/${iterationId}/status`);
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`Status fetch failed: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Failed to fetch status: ${response.status} ${response.statusText}`);
      }
      const status: IterationStatus = await response.json();

      if (!shouldApplyStatusUpdate(activeIterationIdRef.current, status)) {
        return status.allDone;
      }

      setIterationStatus(status);

      // Update iteration with results using functional update so we never overwrite based on stale closure
      setIteration((prev) => {
        if (!prev || prev.id !== status.iterationId) return prev;
        const updatedIteration: Iteration = {
          ...prev,
          results: status.runs.map((run) => ({
            candidateId: run.candidateId,
            output: run.output || { type: 'text', text: run.error || 'No output' },
            meta: {
              latencyMs: run.latencyMs,
            },
          })),
        };
        return updatedIteration;
      });

      // Initialize or extend feedback for this iteration (idempotent: only when still active)
      setFeedback((prev) => {
        const candidateIds = status.runs.map((r) => r.candidateId);
        if (prev.length === 0 || prev.length !== candidateIds.length) {
          return candidateIds.map((candidateId) => ({ candidateId, selected: false, note: '' }));
        }
        const existingIds = new Set(prev.map((f) => f.candidateId));
        const newIds = candidateIds.filter((id) => !existingIds.has(id));
        if (newIds.length === 0) return prev;
        return [...prev, ...newIds.map((candidateId) => ({ candidateId, selected: false, note: '' }))];
      });

      return status.allDone;
    } catch (err) {
      console.error('Polling error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch iteration status');
      return true;
    }
  }, []);

  // Start/stop polling. Tied to iteration.id so only one iteration is polled; cleanup clears interval when iteration changes.
  useEffect(() => {
    if (!iteration) return;

    if (iterationStatus?.allDone) return;
    if (error && error.includes('Failed to fetch status')) return;

    const iterationId = iteration.id;

    const runPoll = () => {
      if (activeIterationIdRef.current !== iterationId) return;
      pollIterationStatus(iterationId).catch((err) => {
        console.error('Polling failed:', err);
        clearInterval(intervalId);
      });
    };

    runPoll();

    const intervalId = setInterval(runPoll, 2000);

    return () => clearInterval(intervalId);
  }, [iteration, iteration?.id, iterationStatus?.allDone, pollIterationStatus, error]);

  const handleAddModel = async () => {
    const endpointId = customEndpointId.trim();
    if (!endpointId) {
      setError(addModelSource === 'fal.ai' ? 'Please enter an endpoint ID' : 'Please enter a model slug');
      return;
    }

    if (addingModel) {
      return;
    }

    setAddingModel(true);
    setError(null);

    try {
      const response = await fetch('/api/models/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpointId, source: addModelSource }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add model');
      }

      const modelId = data.modelEndpoint?.id;

      if (!modelId) {
        throw new Error('Model was created but ID is missing');
      }

      setCustomEndpointId('');
      await fetchModels();
      setSelectedModelId(modelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add model');
    } finally {
      setAddingModel(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedModelId || !taskGoal.trim()) {
      setError('Please select a model and enter a task goal');
      return;
    }

    if (!taskModality) {
      setError('Modality could not be determined from selected model');
      return;
    }

    setLoading(true);
    setError(null);
    activeIterationIdRef.current = null;
    setIteration(null);
    setIterationStatus(null);
    setFeedback([]);

    try {
      const task: TaskSpec = {
        goal: taskGoal.trim(),
        modality: taskModality,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90_000); // 90s timeout

      const response = await fetch('/api/iterations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          modelEndpointId: selectedModelId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to generate iteration');
      }

      const newIteration: Iteration = await response.json();
      activeIterationIdRef.current = newIteration.id;
      setIterationIndex(1);
      setIteration(newIteration);

      // Initialize feedback
      setFeedback(
        newIteration.candidates.map((candidate) => ({
          candidateId: candidate.id,
          selected: false,
          note: '',
        }))
      );

      // Start polling
      await pollIterationStatus(newIteration.id);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Request timed out (90s). Check network and GEMINI_API_KEY, then try again.');
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRefine = async () => {
    if (!iteration || !selectedModelId) {
      setError('No iteration to refine');
      return;
    }

    const selectedCount = feedback.filter((f) => f.selected).length;
    if (selectedCount === 0) {
      setError('Please select at least one candidate to refine');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const selectedModel = models.find((m) => m.id === selectedModelId);
      if (!selectedModel) {
        throw new Error('Selected model not found');
      }

      // Contract v2: send selected prompts' text so Gemini can evolve them
      const selectedPrompts = feedback
        .filter((f) => f.selected)
        .map((f) => {
          const candidate = iteration.candidates.find((c) => c.id === f.candidateId);
          return {
            candidateId: f.candidateId,
            prompt: candidate?.prompt ?? '',
            note: f.note,
          };
        });

      const response = await fetch('/api/iterations/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: iteration.task,
          modelEndpointId: selectedModelId,
          previousIterationId: iteration.id,
          feedback,
          selectedPrompts,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to refine iteration');
      }

      const newIteration: Iteration = await response.json();
      activeIterationIdRef.current = newIteration.id;
      setIterationIndex((prev) => prev + 1);
      setIteration(newIteration);
      setIterationStatus(null);

      // Initialize feedback
      setFeedback(
        newIteration.candidates.map((candidate) => ({
          candidateId: candidate.id,
          selected: false,
          note: '',
        }))
      );

      // Start polling
      await pollIterationStatus(newIteration.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleFeedbackChange = (candidateId: string, field: 'selected' | 'note', value: boolean | string) => {
    setFeedback((prev) =>
      prev.map((item) =>
        item.candidateId === candidateId
          ? { ...item, [field]: value }
          : item
      )
    );
  };

  const getCandidateResult = (candidateId: string) => {
    if (!iterationStatus) return null;
    return iterationStatus.runs.find((r) => r.candidateId === candidateId);
  };

  const renderOutputPreview = (
    output: RunOutput | undefined,
    status: string,
    result?: { error?: string; queuePosition?: number },
    onImageClick?: (url: string) => void
  ) => {
    if (status === 'queued' || status === 'running') {
      return (
        <div className="flex h-full min-h-[120px] w-full items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-600">
          <div className="text-center">
            <div className="mx-auto mb-1.5 h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {status === 'queued' ? 'Queued' : 'Running...'}
            </p>
            {result?.queuePosition !== undefined && result.queuePosition > 0 && (
              <p className="mt-0.5 text-[10px] text-zinc-400">#{result.queuePosition}</p>
            )}
          </div>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex h-full min-h-[120px] w-full items-center justify-center rounded-lg border border-red-300 bg-red-50/80 p-2 dark:border-red-800 dark:bg-red-900/20">
          <div className="text-center w-full">
            <p className="text-xs font-semibold text-red-600 dark:text-red-400">Error</p>
            {result?.error && (
              <p className="mt-1 wrap-break-word text-left text-[10px] text-red-600 dark:text-red-300 line-clamp-3">
                {result.error}
              </p>
            )}
          </div>
        </div>
      );
    }

    if (!output) return null;

    if (output.type === 'image' && output.images) {
      const single = output.images.length === 1;
      return (
        <div className={`grid h-full w-full ${single ? 'grid-cols-1' : 'grid-cols-2'} gap-1.5`}>
          {output.images.slice(0, 4).map((img, idx) => (
            <button
              key={img.url ?? idx}
              type="button"
              onClick={() => onImageClick?.(img.url)}
              className="relative aspect-square w-full min-h-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 shadow-sm transition hover:shadow focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <Image
                src={img.url}
                alt={`Output ${idx + 1}`}
                fill
                className="object-cover cursor-pointer"
                unoptimized
              />
            </button>
          ))}
        </div>
      );
    }

    if (output.type === 'video' && output.videos) {
      return (
        <div className="h-full w-full space-y-1">
          {output.videos.slice(0, 2).map((vid, idx) => (
            <video
              key={vid.url ?? idx}
              src={vid.url}
              controls
              className="h-full w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
            />
          ))}
        </div>
      );
    }

    if (output.type === 'text') {
      // Backward compatibility: if text is a single image URL (e.g. stored before fix), render as image
      const t = output.text?.trim() ?? '';
      if (t.startsWith('http') && !t.includes(' ')) {
        return (
          <div className="relative h-full w-full rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
            <Image
              src={t}
              alt="Output"
              fill
              className="object-contain cursor-pointer"
              unoptimized
              onClick={() => onImageClick?.(t)}
            />
          </div>
        );
      }
      return (
        <div className="h-full w-full overflow-auto rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {output.text}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">
            Promptura Playground
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Generate, test, and refine prompts iteratively
          </p>
        </div>

        {/* API keys required: show when no provider key is configured */}
        {hasProviderKey === false && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-5 py-4 dark:border-amber-500 dark:bg-amber-950/40"
          >
            <span className="text-amber-800 dark:text-amber-200">
              Before using the Playground, add at least one provider API key (fal.ai or EachLabs) in Settings.
              Generation and model runs will not work until a key is configured.
            </span>
            <Link
              href="/settings"
              className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
              Open Settings
            </Link>
          </div>
        )}

        {/* Task Input */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-black dark:text-zinc-50">
            Task Configuration
          </h2>

          <div className="space-y-4">
            {/* Model Selection (grouped by provider like Add model) */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Select Active Model
              </label>
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              >
                <option value="">-- Select a model --</option>
                {(['fal.ai', 'eachlabs'] as const).map((source) => {
                  const sourceModels = models.filter(
                    (m) => m.source === source && (m.status === 'active' || m.status === 'pending_research')
                  );
                  if (sourceModels.length === 0) return null;
                  return (
                    <optgroup key={source} label={source === 'fal.ai' ? 'fal.ai' : 'EachLabs'}>
                      {sourceModels.map((model) => {
                        const latestJob = model.researchJobs?.[0];
                        const jobStatus = latestJob?.status;
                        const isResearching = model.status === 'pending_research' || ['queued', 'running'].includes(jobStatus ?? '');
                        return (
                          <option key={model.id} value={model.id}>
                            {model.endpointId} ({model.modality})
                            {isResearching && ' [Researching...]'}
                            {model.status === 'active' && model.modelSpecs.length === 0 && ' [No Spec]'}
                          </option>
                        );
                      })}
                    </optgroup>
                  );
                })}
              </select>
              
              {/* Show research status for selected model */}
              {selectedModelId && (() => {
                const selectedModel = models.find((m) => m.id === selectedModelId);
                if (!selectedModel) return null;
                
                const latestJob = selectedModel.researchJobs?.[0];
                const isResearching = selectedModel.status === 'pending_research' || latestJob?.status === 'processing';
                
                if (isResearching) {
                  return (
                    <div className="mt-2 flex items-center gap-2 rounded-md bg-yellow-50 p-2 dark:bg-yellow-900/20">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500"></div>
                      <p className="text-xs text-yellow-800 dark:text-yellow-200">
                        Research in progress... This model will be available once research completes.
                      </p>
                    </div>
                  );
                }
                
                if (latestJob?.status === 'failed') {
                  return (
                    <div className="mt-2 flex items-center gap-2 rounded-md bg-red-50 p-2 dark:bg-red-900/20">
                      <p className="text-xs text-red-800 dark:text-red-200">
                        Research failed. Please try refreshing the research from Admin Panel.
                      </p>
                    </div>
                  );
                }
                
                return null;
              })()}
            </div>

            {/* Divider */}
            <div className="my-4 flex items-center">
              <div className="grow border-t border-zinc-300 dark:border-zinc-700"></div>
              <span className="mx-4 text-sm text-zinc-500 dark:text-zinc-400">or</span>
              <div className="grow border-t border-zinc-300 dark:border-zinc-700"></div>
            </div>

            {/* Add New Model */}
            <div>
              <label
                htmlFor="customEndpoint"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Add New Model
              </label>
              <p className="mt-1 mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                {addModelSource === 'fal.ai'
                  ? 'Enter a fal.ai endpoint ID (e.g., fal-ai/flux/dev) to add it to your catalog'
                  : 'Enter an EachLabs model slug (e.g., nano-banana-pro-edit) to add it to your catalog'}
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={addModelSource}
                  onChange={(e) => setAddModelSource(e.target.value as 'fal.ai' | 'eachlabs')}
                  disabled={addingModel}
                  className="rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                >
                  <option value="fal.ai">fal.ai</option>
                  <option value="eachlabs">EachLabs</option>
                </select>
                <input
                  id="customEndpoint"
                  type="text"
                  value={customEndpointId}
                  onChange={(e) => setCustomEndpointId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !addingModel) {
                      handleAddModel();
                    }
                  }}
                  placeholder={addModelSource === 'fal.ai' ? 'fal-ai/flux/dev' : 'nano-banana-pro-edit'}
                  disabled={addingModel}
                  className="flex-1 min-w-48 rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
                <button
                  onClick={handleAddModel}
                  disabled={addingModel || !customEndpointId.trim()}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-100"
                >
                  {addingModel ? 'Adding...' : 'Add Model'}
                </button>
              </div>
            </div>

            {/* Task Goal */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Task Goal
              </label>
              <textarea
                value={taskGoal}
                onChange={(e) => setTaskGoal(e.target.value)}
                rows={3}
                placeholder="e.g., dress the cat in a skirt and make it dance"
                className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              />
            </div>

            {/* Modality Display (read-only; from ModelSpec or DB fallback) */}
            {selectedModelId && (() => {
              const selectedModel = models.find((m) => m.id === selectedModelId);
              const hasSpec = selectedModel?.modelSpecs && selectedModel.modelSpecs.length > 0;
              const isPendingResearch = selectedModel?.status === 'pending_research';

              if (!taskModality) {
                return (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Modality
                    </label>
                    <div className="mt-1 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">
                      Unable to determine modality (model has no modality in catalog)
                    </div>
                  </div>
                );
              }

              return (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Modality
                  </label>
                  <div className="mt-1 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                    {taskModality.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {hasSpec
                      ? 'From model spec'
                      : isPendingResearch
                        ? 'From provider (research in progress; full spec when ready)'
                        : 'From provider catalog (ModelSpec not yet available)'}
                  </p>
                </div>
              );
            })()}

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={loading || !selectedModelId || !taskGoal.trim() || !taskModality}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              {loading ? 'Generating...' : 'Generate 20 Candidates'}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Results Grid */}
        {iteration && (
          <div className="mb-8">
            {/* Iteration header (Blok D: task, model, iteration label) */}
            <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium text-zinc-500 dark:text-zinc-400">
                  Iteration {iterationIndex}
                </span>
                <span className="text-zinc-400 dark:text-zinc-500">·</span>
                <span className="text-zinc-700 dark:text-zinc-300" title="Task goal">
                  {iteration.task.goal}
                </span>
                <span className="text-zinc-400 dark:text-zinc-500">·</span>
                <span className="text-zinc-600 dark:text-zinc-400" title="Model">
                  {models.find((m) => m.id === selectedModelId)?.endpointId ?? iteration.targetModel.modelId}
                </span>
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
                Results ({iteration.candidates.length} candidates)
              </h2>
              {iterationStatus?.allDone && (
                <div className="flex flex-col items-end gap-1">
                  <span
                    title={feedback.filter((f) => f.selected).length === 0 ? 'Select at least one result' : undefined}
                    className="inline-block"
                  >
                    <button
                      onClick={handleRefine}
                      disabled={loading || feedback.filter((f) => f.selected).length === 0}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Refine (10 candidates)
                    </button>
                  </span>
                  {feedback.filter((f) => f.selected).length === 0 && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400" role="status">
                      Select at least one result to refine
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Kart grid: her sonuç = görsel üstte (hero), prompt + aksiyonlar hemen altında */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {iteration.candidates.map((candidate) => {
                const result = getCandidateResult(candidate.id);
                const status = result?.status || 'queued';
                const feedbackItem = feedback.find((f) => f.candidateId === candidate.id);

                return (
                  <article
                    key={candidate.id}
                    className={`flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow dark:bg-zinc-900 ${
                      feedbackItem?.selected
                        ? 'border-blue-400 ring-2 ring-blue-400/30 dark:border-blue-500 dark:ring-blue-500/30'
                        : 'border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    {/* Görsel: kartın üstü, kare alan — prompt ile aynı birimde */}
                    <figure className="relative aspect-square w-full shrink-0 overflow-hidden bg-zinc-100 dark:bg-zinc-800/60">
                      <div className="absolute inset-0 flex items-center justify-center p-2">
                        <div className="h-full w-full min-h-0 min-w-0">
                          {renderOutputPreview(
                            result?.output,
                            status,
                            result ? { error: result.error, queuePosition: result.queuePosition } : undefined,
                            setLightboxImageUrl
                          )}
                        </div>
                      </div>
                    </figure>
                    {/* Caption: status, prompt, params, refine — görselin hemen altında */}
                    <div className="flex min-h-0 flex-col p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            status === 'queued'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                              : status === 'running'
                                ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200'
                                : status === 'error'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                          }`}
                        >
                          {status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : status === 'error' ? 'Error' : 'Done'}
                        </span>
                      </div>
                      {candidate.params && Object.keys(candidate.params).length > 0 && (
                        <div className="mb-2">
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Params
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(candidate.params).map(([key, value]) => (
                              <span
                                key={key}
                                className="inline-flex rounded-md bg-zinc-200/90 px-2 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                                title={`${key}: ${value}`}
                              >
                                {key}: {String(value)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="min-h-0 flex-1">
                        <div className="max-h-28 overflow-y-auto rounded border border-zinc-100 bg-zinc-50/80 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                          <p className="text-[13px] leading-snug text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                            {candidate.prompt}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={feedbackItem?.selected || false}
                            onChange={(e) =>
                              handleFeedbackChange(candidate.id, 'selected', e.target.checked)
                            }
                            disabled={!iterationStatus?.allDone}
                            className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-600 dark:border-zinc-600"
                          />
                          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Refine</span>
                        </label>
                        <input
                          type="text"
                          value={feedbackItem?.note || ''}
                          onChange={(e) =>
                            handleFeedbackChange(candidate.id, 'note', e.target.value)
                          }
                          placeholder="Note"
                          disabled={!iterationStatus?.allDone}
                          className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-zinc-50/80 px-2 py-1 text-xs placeholder-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/80 dark:placeholder-zinc-500"
                        />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Lightbox: tıklanınca görsel büyük açılır */}
            {lightboxImageUrl && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm"
                onClick={() => setLightboxImageUrl(null)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Escape' && setLightboxImageUrl(null)}
                aria-label="Close"
              >
                <button
                  type="button"
                  onClick={() => setLightboxImageUrl(null)}
                  className="absolute right-5 top-5 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/40"
                >
                  Close
                </button>
                <div className="relative h-[90vh] w-full max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
                  <Image
                    src={lightboxImageUrl}
                    alt="Enlarged output"
                    fill
                    className="rounded-lg object-contain shadow-2xl"
                    unoptimized
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
