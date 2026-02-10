'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import type { TaskSpec, Modality, Iteration, RunOutput, FeedbackItem } from '@/src/core/types';
import type { ModelEndpointWithRelations } from '@/src/db/types';

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
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const [customEndpointId, setCustomEndpointId] = useState<string>('');
  const [addingModel, setAddingModel] = useState(false);
  const modelsRef = useRef<ModelEndpointWithRelations[]>([]);
  const isInitialLoadRef = useRef(true);

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

  // Update modality when model is selected
  useEffect(() => {
    if (selectedModelId) {
      const selectedModel = models.find((m) => m.id === selectedModelId);
      if (selectedModel) {
        // Only set modality if model has a spec (for accurate determination)
        // If no spec, modality will be null and user will see a warning
        if (selectedModel.modelSpecs && selectedModel.modelSpecs.length > 0) {
          setTaskModality(mapModalityFromModel(selectedModel));
        } else if (selectedModel.status === 'active') {
          // Active model should have spec, but if not, use fallback
          console.warn(`Active model ${selectedModel.endpointId} has no ModelSpec, using fallback modality`);
          setTaskModality(mapModalityFromModel(selectedModel));
        } else {
          // Model is pending research, modality not yet available
          setTaskModality(null);
        }
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

  // Poll for model updates if there are pending research models
  useEffect(() => {
    const checkPendingResearch = () => {
      return modelsRef.current.some(
        (model) => 
          model.status === 'pending_research' || 
          (model.researchJobs?.[0]?.status && 
           ['queued', 'running', 'processing'].includes(model.researchJobs[0].status))
      );
    };

    if (!checkPendingResearch()) {
      return;
    }

    const interval = setInterval(() => {
      if (checkPendingResearch()) {
        fetchModels();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchModels]);

  // Poll for iteration status
  const pollIterationStatus = useCallback(async (iterationId: string) => {
    try {
      const response = await fetch(`/api/iterations/${iterationId}/status`);
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`Status fetch failed: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Failed to fetch status: ${response.status} ${response.statusText}`);
      }
      const status: IterationStatus = await response.json();
      setIterationStatus(status);

      // Update iteration with results
      if (iteration) {
        const updatedIteration: Iteration = {
          ...iteration,
          results: status.runs.map((run) => ({
            candidateId: run.candidateId,
            output: run.output || { type: 'text', text: run.error || 'No output' },
            meta: {
              latencyMs: run.latencyMs,
            },
          })),
        };
        setIteration(updatedIteration);

        // Initialize feedback if not already initialized or if candidates changed
        setFeedback((prev) => {
          if (prev.length === 0 || prev.length !== updatedIteration.candidates.length) {
            return updatedIteration.candidates.map((candidate) => ({
              candidateId: candidate.id,
              selected: false,
              note: '',
            }));
          }
          // Preserve existing feedback, add new candidates if any
          const existingIds = new Set(prev.map((f) => f.candidateId));
          const newCandidates = updatedIteration.candidates.filter(
            (c) => !existingIds.has(c.id)
          );
          return [
            ...prev,
            ...newCandidates.map((candidate) => ({
              candidateId: candidate.id,
              selected: false,
              note: '',
            })),
          ];
        });
      }

      return status.allDone;
    } catch (err) {
      console.error('Polling error:', err);
      // Don't return false on error - stop polling to prevent infinite loop
      // Error will be shown in UI, user can retry manually
      setError(err instanceof Error ? err.message : 'Failed to fetch iteration status');
      return true; // Stop polling on error
    }
  }, [iteration]);

  // Start/stop polling
  useEffect(() => {
    if (!iteration) return;

    // If already done, don't poll
    if (iterationStatus?.allDone) {
      return;
    }

    // If there's an error, don't poll (user can retry manually)
    if (error && error.includes('Failed to fetch status')) {
      return;
    }

    // Initial poll
    pollIterationStatus(iteration.id).catch((err) => {
      console.error('Initial poll failed:', err);
    });

    // Set up polling interval
    const interval = setInterval(() => {
      pollIterationStatus(iteration.id).catch((err) => {
        console.error('Polling failed:', err);
        // Stop polling on error
        clearInterval(interval);
      });
    }, 2000); // Poll every 2 seconds

    return () => {
      clearInterval(interval);
    };
  }, [iteration, iteration?.id, iterationStatus?.allDone, pollIterationStatus, error]); // Re-run when iteration changes or when done

  const handleAddModel = async () => {
    const endpointId = customEndpointId.trim();
    if (!endpointId) {
      setError('Please enter an endpoint ID');
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
        body: JSON.stringify({ endpointId }),
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

      const response = await fetch('/api/iterations/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: iteration.task,
          modelEndpointId: selectedModelId,
          previousIterationId: iteration.id,
          feedback,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to refine iteration');
      }

      const newIteration: Iteration = await response.json();
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

  const renderOutputPreview = (output: RunOutput | undefined, status: string, result?: { error?: string; queuePosition?: number }) => {
    if (status === 'queued' || status === 'running') {
      return (
        <div className="flex h-32 items-center justify-center rounded-md border-2 border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="text-center">
            <div className="mb-2 h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent mx-auto"></div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {status === 'queued' ? 'Queued' : 'Running...'}
            </p>
            {result?.queuePosition !== undefined && result.queuePosition > 0 && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Queue: #{result.queuePosition}
              </p>
            )}
          </div>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex min-h-32 items-center justify-center rounded-md border border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-900/20">
          <div className="text-center w-full">
            <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-2">Error</p>
            {result?.error && (
              <div className="mt-1 text-xs text-red-500 dark:text-red-300">
                <p className="font-semibold mb-1">Validation Error:</p>
                <p className="break-words whitespace-pre-wrap">{result.error}</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (!output) return null;

    if (output.type === 'image' && output.images) {
      return (
        <div className="space-y-2">
          {output.images.map((img, idx) => (
            <div key={idx} className="relative h-32 w-full overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
              <Image
                src={img.url}
                alt={`Output ${idx + 1}`}
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          ))}
        </div>
      );
    }

    if (output.type === 'video' && output.videos) {
      return (
        <div className="space-y-2">
          {output.videos.map((vid, idx) => (
            <video
              key={idx}
              src={vid.url}
              controls
              className="h-32 w-full rounded-md border border-zinc-300 dark:border-zinc-700"
            />
          ))}
        </div>
      );
    }

    if (output.type === 'text') {
      return (
        <div className="max-h-32 overflow-auto rounded-md border border-zinc-300 bg-zinc-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
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

        {/* Task Input */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-black dark:text-zinc-50">
            Task Configuration
          </h2>

          <div className="space-y-4">
            {/* Model Selection */}
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
                {models
                  .filter((m) => m.status === 'active')
                  .map((model) => {
                    const latestJob = model.researchJobs?.[0];
                    const jobStatus = latestJob?.status;
                    const isResearching = model.status === 'pending_research' || jobStatus === 'processing';
                    
                    return (
                      <option key={model.id} value={model.id}>
                        {model.endpointId} ({model.modality})
                        {isResearching && ' [Researching...]'}
                        {model.status === 'active' && model.modelSpecs.length === 0 && ' [No Spec]'}
                      </option>
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
              <div className="flex-grow border-t border-zinc-300 dark:border-zinc-700"></div>
              <span className="mx-4 text-sm text-zinc-500 dark:text-zinc-400">or</span>
              <div className="flex-grow border-t border-zinc-300 dark:border-zinc-700"></div>
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
                Enter a fal.ai endpoint ID (e.g., fal-ai/flux/dev) to add it to your catalog
              </p>
              <div className="flex gap-2">
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
                  placeholder="fal-ai/flux/dev"
                  disabled={addingModel}
                  className="flex-1 rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
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

            {/* Modality Display (read-only, auto-determined) */}
            {selectedModelId && (() => {
              const selectedModel = models.find((m) => m.id === selectedModelId);
              const hasSpec = selectedModel?.modelSpecs && selectedModel.modelSpecs.length > 0;
              
              if (!taskModality) {
                if (selectedModel?.status === 'pending_research') {
                  return (
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Modality
                      </label>
                      <div className="mt-1 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-600 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
                        Waiting for model research to complete...
                      </div>
                    </div>
                  );
                }
                return (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Modality
                    </label>
                    <div className="mt-1 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">
                      Unable to determine modality (ModelSpec not available)
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
                      ? 'Automatically determined from selected model'
                      : 'Using fallback (ModelSpec not available - may be inaccurate)'}
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
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
                Results ({iteration.candidates.length} candidates)
              </h2>
              {iterationStatus?.allDone && (
                <button
                  onClick={handleRefine}
                  disabled={loading || feedback.filter((f) => f.selected).length === 0}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Refine (10 candidates)
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {iteration.candidates.map((candidate) => {
                const result = getCandidateResult(candidate.id);
                const status = result?.status || 'queued';
                const feedbackItem = feedback.find((f) => f.candidateId === candidate.id);

                return (
                  <div
                    key={candidate.id}
                    className={`rounded-lg border p-4 shadow-sm ${
                      feedbackItem?.selected
                        ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                        : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
                    }`}
                  >
                    {/* Status Badge */}
                    {(status === 'queued' || status === 'running' || status === 'error') && (
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                            status === 'queued'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200'
                              : status === 'running'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200'
                          }`}
                        >
                          {status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : 'Error'}
                        </span>
                      </div>
                    )}

                    {/* Prompt */}
                    <div className="mb-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          Prompt
                        </p>
                        {candidate.prompt.length > 100 && (
                          <button
                            onClick={() => {
                              setExpandedPrompts((prev) => {
                                const next = new Set(prev);
                                if (next.has(candidate.id)) {
                                  next.delete(candidate.id);
                                } else {
                                  next.add(candidate.id);
                                }
                                return next;
                              });
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {expandedPrompts.has(candidate.id) ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </div>
                      <p
                        className={`mt-1 text-xs text-zinc-600 dark:text-zinc-400 ${
                          expandedPrompts.has(candidate.id) ? '' : 'line-clamp-2'
                        }`}
                      >
                        {candidate.prompt}
                      </p>
                    </div>

                    {/* Params */}
                    {candidate.params && Object.keys(candidate.params).length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          Params
                        </p>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {Object.entries(candidate.params)
                            .slice(0, 3)
                            .map(([key, value]) => (
                              <div key={key}>
                                {key}: {String(value)}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Output Preview */}
                    <div className="mb-2">
                      {renderOutputPreview(result?.output, status, result ? { error: result.error, queuePosition: result.queuePosition } : undefined)}
                    </div>

                    {/* Select + Note */}
                    <div className="space-y-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={feedbackItem?.selected || false}
                          onChange={(e) =>
                            handleFeedbackChange(candidate.id, 'selected', e.target.checked)
                          }
                          disabled={!iterationStatus?.allDone}
                          className="h-4 w-4 rounded border-zinc-300 text-zinc-600 focus:ring-zinc-500"
                        />
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          Select
                        </span>
                      </label>
                      <textarea
                        value={feedbackItem?.note || ''}
                        onChange={(e) =>
                          handleFeedbackChange(candidate.id, 'note', e.target.value)
                        }
                        placeholder="Add note..."
                        rows={2}
                        disabled={!iterationStatus?.allDone}
                        className="w-full rounded-md border border-zinc-300 px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
