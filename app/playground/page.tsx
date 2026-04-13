'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { TaskSpec, Modality, Iteration, OutputAsset, FeedbackItem } from '@/src/core/types';
import type { ModelEndpointWithRelations } from '@/src/db/types';
import { shouldApplyStatusUpdate } from '@/src/lib/iterationPolling';
import { compressImageToDataUrl } from '@/src/lib/image-compress';
import { isDeferredVideoModality } from '@/src/lib/video-rollout';
import { OutputPreview } from '@/app/components/OutputPreview';

interface IterationStatus {
  iterationId: string;
  status?: 'generating' | 'pending' | 'error';
  task?: { goal: string; modality: string; assets?: unknown[] };
  candidates?: Array<{ id: string; prompt: string }>;
  error?: string;
  runs: Array<{
    candidateId: string;
    status: 'queued' | 'running' | 'done' | 'error';
    assets?: OutputAsset[];
    latencyMs?: number;
    error?: string;
    queuePosition?: number;
  }>;
  allDone: boolean;
  hasErrors: boolean;
}

export default function Playground() {
  const [models, setModels] = useState<ModelEndpointWithRelations[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [taskGoal, setTaskGoal] = useState<string>('');
  const [aspectRatioChoice, setAspectRatioChoice] = useState<string>('auto');
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
  /** Required provider keys configured for playground flow (Gemini + at least one execution provider). */
  const [hasProviderKey, setHasProviderKey] = useState<boolean | null>(null);
  /** Task input assets for image-to-image, image-to-video, etc. (data URL or URL) */
  const [taskImageUrl, setTaskImageUrl] = useState<string>('');
  const [taskVideoUrl, setTaskVideoUrl] = useState<string>('');
  /** Optional video URL (avoids size limit: provider fetches from URL instead of inline base64) */
  const [taskVideoUrlLink, setTaskVideoUrlLink] = useState<string>('');
  /** Video file over size limit: show warning and block use (limit ~700 KB so request body stays under 1 MB) */
  const [videoFileOverLimit, setVideoFileOverLimit] = useState<boolean>(false);
  const modelsRef = useRef<ModelEndpointWithRelations[]>([]);
  const isInitialLoadRef = useRef(true);
  /** Tracks the iteration we're showing and polling for. Prevents late poll responses from overwriting a newer iteration. */
  const activeIterationIdRef = useRef<string | null>(null);

  // Helper function to map DB modality to TaskSpec Modality (param-free spec: use spec.modality)
  const mapModalityFromModel = (model: ModelEndpointWithRelations): Modality => {
    if (model.modelSpecs && model.modelSpecs.length > 0) {
      const spec = model.modelSpecs[0].specJson as { modality?: Modality } | undefined;
      if (spec?.modality) return spec.modality;
    }
    const dbModality = model.modality?.toLowerCase();
    if (dbModality === 'image') {
      console.warn(`Model ${model.endpointId} has no ModelSpec, defaulting to text-to-image.`);
      return 'text-to-image';
    }
    if (dbModality === 'video') {
      console.warn(`Model ${model.endpointId} has no ModelSpec, defaulting to text-to-video.`);
      return 'text-to-video';
    }
    return 'text-to-text';
  };

  /** Check if ModelSpec requires image input (param-free: required_assets) */
  const requiresImageInput = (model: ModelEndpointWithRelations): boolean => {
    const spec = model.modelSpecs?.[0]?.specJson as { required_assets?: string } | undefined;
    const r = spec?.required_assets ?? 'none';
    return r === 'image' || r === 'image+video';
  };

  /** Check if ModelSpec requires video input (param-free: required_assets) */
  const requiresVideoInput = (model: ModelEndpointWithRelations): boolean => {
    const spec = model.modelSpecs?.[0]?.specJson as { required_assets?: string } | undefined;
    const r = spec?.required_assets ?? 'none';
    return r === 'video' || r === 'image+video';
  };

  const aspectRatioOptionsFromModel = (model: ModelEndpointWithRelations): string[] => {
    const spec = model.modelSpecs?.[0]?.specJson as { aspect_ratio_options?: unknown } | undefined;
    const options = spec?.aspect_ratio_options;
    if (!Array.isArray(options)) return [];
    return options.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  };

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

  // Reset task assets when model changes
  useEffect(() => {
    setTaskImageUrl('');
    setTaskVideoUrl('');
    setTaskVideoUrlLink('');
    setVideoFileOverLimit(false);
    setAspectRatioChoice('auto');
  }, [selectedModelId]);

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

  // Check if user has required keys (Gemini + at least one execution provider)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/providers')
      .then((res) => (res.ok ? res.json() : { providers: {} }))
      .then((data) => {
        if (cancelled) return;
        const p = data.providers ?? {};
        setHasProviderKey(Boolean(p.gemini && (p.falai || p.eachlabs)));
      })
      .catch(() => {
        if (!cancelled) setHasProviderKey(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Poll for model updates when there are pending research models (optimized: 4s interval)
  const MODEL_POLL_INTERVAL_MS = 4000;
  const MODEL_POLL_INITIAL_DELAY_MS = 3000;
  useEffect(() => {
    const hasPending = models.some(
      (m) =>
        m.status === 'pending_research' ||
        ['queued', 'running'].includes(m.researchJobs?.[0]?.status ?? '')
    );
    if (!hasPending) return;

    const poll = () => fetchModels();
    const t1 = setTimeout(poll, MODEL_POLL_INITIAL_DELAY_MS);
    const t2 = setInterval(poll, MODEL_POLL_INTERVAL_MS);
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

      if (status.error) setError(status.error);

      // Merge candidates when they arrive from background (status.generating → status.pending)
      const incoming = status.candidates?.length ? status.candidates : null;

      setIteration((prev) => {
        if (!prev || prev.id !== status.iterationId) return prev;
        const candidates = incoming
          ? incoming.map((c) => ({ ...c, generator: 'gemini-fallback' as const }))
          : prev.candidates;
        const updatedIteration: Iteration = {
          ...prev,
          task: (status.task ?? prev.task) as TaskSpec,
          candidates,
          results: status.runs.map((run) => ({
            candidateId: run.candidateId,
            assets: run.assets?.length
              ? run.assets
              : [{ type: 'text' as const, content: run.error || 'No output' }],
            metadata: { latencyMs: run.latencyMs },
          })),
        };
        return updatedIteration;
      });

      // Initialize or extend feedback (from runs or candidates)
      setFeedback((prev) => {
        const candidateIds =
          status.candidates?.map((c) => c.id) ?? status.runs.map((r) => r.candidateId);
        if (prev.length === 0 || prev.length !== candidateIds.length) {
          return candidateIds.map((candidateId) => ({ candidateId, selected: false, note: '' }));
        }
        const existingIds = new Set(prev.map((f) => f.candidateId));
        const newIds = candidateIds.filter((id) => !existingIds.has(id));
        if (newIds.length === 0) return prev;
        return [...prev, ...newIds.map((candidateId) => ({ candidateId, selected: false, note: '' }))];
      });

      const isGenerating = status.status === 'generating';
      return !isGenerating && status.allDone;
    } catch (err) {
      console.error('Polling error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch iteration status');
      return true;
    }
  }, []);

  // Start/stop polling. Optimized: 3s interval to reduce load; stops when allDone or error.
  const ITERATION_POLL_INTERVAL_MS = 3000;
  const iterationId = iteration?.id ?? null;
  useEffect(() => {
    if (!iteration) return;

    if (iterationStatus?.allDone && iterationStatus?.status !== 'generating') return;
    if (iterationStatus?.status === 'error') return;
    if (error && error.includes('Failed to fetch status')) return;

    const id = iteration.id;

    const runPoll = () => {
      if (activeIterationIdRef.current !== id) return;
      pollIterationStatus(id).catch((err) => {
        console.error('Polling failed:', err);
        clearInterval(intervalId);
      });
    };

    runPoll();

    const intervalId = setInterval(runPoll, ITERATION_POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [iteration, iterationId, iterationStatus, pollIterationStatus, error]);

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
        if (
          data?.code === 'ModalityDeferred' &&
          (data?.modality === 'image-to-video' || data?.modality === 'video-to-video')
        ) {
          throw new Error('Unable to determine modality (model has no modality in catalog)');
        }
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
    if (!selectedModelId) {
      setError('Please select a model');
      return;
    }

    if (!taskModality) {
      setError('Modality could not be determined from selected model');
      return;
    }

    const selectedModel = models.find((m) => m.id === selectedModelId);
    const reqImage = selectedModel ? requiresImageInput(selectedModel) : false;
    const reqVideo = selectedModel ? requiresVideoInput(selectedModel) : false;

    if (reqImage && !taskImageUrl.trim()) {
      setError('This model requires an input image. Please upload an image.');
      return;
    }
    if (reqVideo && !taskVideoUrl.trim()) {
      setError('This model requires an input video. Please upload a video.');
      return;
    }
    if (!taskGoal.trim()) {
      setError('Please enter a task goal');
      return;
    }

    setLoading(true);
    setError(null);
    activeIterationIdRef.current = null;
    setIteration(null);
    setIterationStatus(null);
    setFeedback([]);

    try {
      const assets: TaskSpec['assets'] = [];
      const videoUrl = taskVideoUrlLink.trim() && /^https?:\/\//i.test(taskVideoUrlLink.trim())
        ? taskVideoUrlLink.trim()
        : taskVideoUrl.trim();
      if (videoUrl) assets.push({ type: 'video', url: videoUrl });

      const task: TaskSpec = {
        goal: taskGoal.trim(),
        modality: taskModality,
        ...(aspectRatioChoice !== 'auto' ? { aspectRatio: aspectRatioChoice } : {}),
        ...(assets.length > 0 && { assets }),
      };

      // Use FormData when image exists: avoids JSON body size limit (base64 images can be huge)
      let body: string | FormData;
      let headers: Record<string, string> = {};

      if (taskImageUrl.trim() && taskImageUrl.startsWith('data:')) {
        const formData = new FormData();
        formData.append('task', JSON.stringify({ ...task, assets: task.assets }));
        formData.append('modelEndpointId', selectedModelId);
        // Convert data URL to Blob and append as file
        const res = await fetch(taskImageUrl);
        const blob = await res.blob();
        formData.append('image', blob, 'image.jpg');
        body = formData;
        // Do NOT set Content-Type - fetch will set multipart boundary
      } else if (taskImageUrl.trim()) {
        assets.push({ type: 'image', url: taskImageUrl.trim() });
        task.assets = assets;
        body = JSON.stringify({ task, modelEndpointId: selectedModelId });
        headers = { 'Content-Type': 'application/json' };
      } else {
        body = JSON.stringify({ task, modelEndpointId: selectedModelId });
        headers = { 'Content-Type': 'application/json' };
      }

      const response = await fetch('/api/iterations/generate', {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to generate iteration');
      }

      const newIteration: Iteration = await response.json();
      activeIterationIdRef.current = newIteration.id;
      setIterationIndex(1);
      setIteration(newIteration);

      // Initialize feedback (empty until candidates arrive via poll)
      setFeedback(
        (newIteration.candidates ?? []).map((candidate) => ({
          candidateId: candidate.id,
          selected: false,
          note: '',
        }))
      );

      // Poll for candidates + run results (no client timeout; server runs in background)
      await pollIterationStatus(newIteration.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
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
    assets: OutputAsset[] | undefined,
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

    if (!assets?.length) return null;

    const images = assets.filter((a): a is OutputAsset & { type: 'image' } => a.type === 'image');
    const videos = assets.filter((a): a is OutputAsset & { type: 'video' } => a.type === 'video');
    const texts = assets.filter((a): a is OutputAsset & { type: 'text' } => a.type === 'text');

    if (images.length > 0) {
      const single = images.length === 1;
      return (
        <div className={`grid h-full w-full ${single ? 'grid-cols-1' : 'grid-cols-2'} gap-1.5`}>
          {images.slice(0, 4).map((asset, idx) => (
            <OutputPreview key={asset.url + idx} asset={asset} onImageClick={onImageClick} className="h-full" />
          ))}
        </div>
      );
    }

    if (videos.length > 0) {
      return (
        <div className="h-full w-full space-y-1">
          {videos.slice(0, 2).map((asset, idx) => (
            <OutputPreview key={asset.url + idx} asset={asset} className="h-full" />
          ))}
        </div>
      );
    }

    if (texts.length > 0) {
      const t = texts.map((x) => x.content).join(' ').trim();
      if (!t) return null;
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
      return <OutputPreview asset={{ type: 'text', content: t }} className="h-full w-full" />;
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
              Before using the Playground, add your Gemini API key and at least one execution provider key (fal.ai or EachLabs) in Settings.
              Generate/Refine and model runs will not work until keys are configured.
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
                    (m) =>
                      m.source === source &&
                      (m.status === 'active' || m.status === 'pending_research') &&
                      !isDeferredVideoModality(mapModalityFromModel(m))
                  );
                  if (sourceModels.length === 0) return null;
                  return (
                    <optgroup key={source} label={source === 'fal.ai' ? 'fal.ai' : 'EachLabs'}>
                      {sourceModels.map((model) => {
                        const latestJob = model.researchJobs?.[0];
                        const jobStatus = latestJob?.status;
                        const isResearching = model.status === 'pending_research' || ['queued', 'running'].includes(jobStatus ?? '');
                        const modalityLabel = isResearching
                          ? 'Researching…'
                          : model.modelSpecs?.length
                            ? (model.modelSpecs[0].specJson as { modality?: string })?.modality ?? '—'
                            : '[No spec]';
                        return (
                          <option key={model.id} value={model.id}>
                            {model.endpointId} — {modalityLabel}
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

            {/* Task: same flow for every model; image/video upload only when required_assets needs them (no param forms) */}
            {selectedModelId && (() => {
              const selectedModel = models.find((m) => m.id === selectedModelId);
              if (!selectedModel) return null;
              const reqImage = requiresImageInput(selectedModel);
              const reqVideo = requiresVideoInput(selectedModel);
              const aspectOptions = aspectRatioOptionsFromModel(selectedModel);
              const canChooseAspectRatio =
                taskModality === 'text-to-video' && aspectOptions.length > 0;
              const taskLabel = taskModality === 'image-to-video' ? 'Motion description' : 'Task goal';
              const taskPlaceholder = taskModality === 'image-to-video'
                ? 'e.g., smooth camera pan, character walking forward'
                : 'e.g., dress the cat in a skirt and make it dance';

              return (
                <>
                  {/* Task goal (or motion description for image-to-video) */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      {taskLabel}
                    </label>
                    <textarea
                      value={taskGoal}
                      onChange={(e) => setTaskGoal(e.target.value)}
                      rows={3}
                      placeholder={taskPlaceholder}
                      className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                    />
                  </div>

                  {canChooseAspectRatio && (
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Aspect ratio
                      </label>
                      <select
                        value={aspectRatioChoice}
                        onChange={(e) => setAspectRatioChoice(e.target.value)}
                        className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                      >
                        <option value="auto">Auto (model default)</option>
                        {aspectOptions.map((ratio) => (
                          <option key={ratio} value={ratio}>
                            {ratio}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Image upload: only when model requires image (required_assets) */}
                  {reqImage && (
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Input image <span className="ml-1 text-red-500">*</span>
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              try {
                                const dataUrl = await compressImageToDataUrl(f);
                                setTaskImageUrl(dataUrl);
                              } catch (err) {
                                console.error('Image compression failed:', err);
                                setError('Could not process image. Try a smaller file.');
                                setTaskImageUrl('');
                              }
                            } else {
                              setTaskImageUrl('');
                            }
                          }}
                          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-700 dark:file:text-zinc-300"
                        />
                        {taskImageUrl && (
                          <button
                            type="button"
                            onClick={() => setTaskImageUrl('')}
                            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {taskImageUrl && (
                        <div className="mt-2 relative h-24 w-24 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
                          <Image src={taskImageUrl} alt="Task image" fill className="object-cover" unoptimized />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Video: URL (no size limit) or file upload (max ~700 KB; provider rejects larger) */}
                  {reqVideo && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          Input video <span className="ml-1 text-red-500">*</span>
                        </label>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Paste a public video URL (recommended), or upload a file (max 700 KB — EachLabs queue limit).
                        </p>
                        <input
                          type="url"
                          value={taskVideoUrlLink}
                          onChange={(e) => {
                            setTaskVideoUrlLink(e.target.value);
                            setVideoFileOverLimit(false);
                          }}
                          placeholder="https://… (recommended for large videos)"
                          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-500 dark:text-zinc-400">
                          Or upload file (max 700 KB)
                        </label>
                        <input
                          type="file"
                          accept="video/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              const VIDEO_MAX_BYTES = 700 * 1024; // 700 KB — keeps request body under provider ~1 MB limit
                              if (f.size > VIDEO_MAX_BYTES) {
                                setVideoFileOverLimit(true);
                                setTaskVideoUrl('');
                                e.target.value = '';
                              } else {
                                setVideoFileOverLimit(false);
                                const r = new FileReader();
                                r.onload = () => setTaskVideoUrl(String(r.result));
                                r.readAsDataURL(f);
                              }
                            } else {
                              setTaskVideoUrl('');
                              setVideoFileOverLimit(false);
                            }
                          }}
                          className="mt-1 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-700 dark:file:text-zinc-300"
                        />
                        {videoFileOverLimit && (
                          <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                            File exceeds the 700 KB limit (EachLabs queue limit). Use a video URL above or a very short clip.
                          </p>
                        )}
                        {taskVideoUrl && !videoFileOverLimit && (
                          <button
                            type="button"
                            onClick={() => setTaskVideoUrl('')}
                            className="mt-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Modality Display (read-only; from ModelSpec) */}
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

              const spec = selectedModel?.modelSpecs?.[0]?.specJson as { required_assets?: string } | undefined;
              const r = spec?.required_assets ?? 'none';
              const requiredLabels: string[] = ['Prompt'];
              if (r === 'image' || r === 'image+video') requiredLabels.push('Image');
              if (r === 'video' || r === 'image+video') requiredLabels.push('Video');

              return (
                <div className="space-y-3">
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
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Required inputs
                    </label>
                    <div className="mt-1 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                      {requiredLabels.join(' + ')}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={Boolean(
                loading ||
                !selectedModelId ||
                !taskModality ||
                !taskGoal.trim() ||
                (selectedModelId && (() => {
                  const m = models.find((x) => x.id === selectedModelId);
                  if (!m) return false;
                  if (requiresImageInput(m) && !taskImageUrl.trim()) return true;
                  if (requiresVideoInput(m)) {
                    const hasLink = taskVideoUrlLink.trim() && /^https?:\/\//i.test(taskVideoUrlLink.trim());
                    if (!hasLink && !taskVideoUrl.trim()) return true;
                  }
                  return false;
                })())
              )}
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
                const iterResult = iteration.results?.find((r) => r.candidateId === candidate.id);
                const assets = result?.assets ?? iterResult?.assets;
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
                            assets,
                            status,
                            result ? { error: result.error, queuePosition: result.queuePosition } : undefined,
                            setLightboxImageUrl
                          )}
                        </div>
                      </div>
                    </figure>
                    {/* Caption: status, prompt, refine — görselin hemen altında */}
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
