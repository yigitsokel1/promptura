'use client';

import { useState } from 'react';
import type {
  Iteration,
  TaskSpec,
  ModelRef,
  FeedbackItem,
  CandidatePrompt,
  RunResult,
} from '@/src/core/types';
import { getCandidateResultPairs } from '@/src/core/iteration/iteration';

export default function Playground() {
  const [taskGoal, setTaskGoal] = useState('');
  const [provider, setProvider] = useState<'falai' | 'google' | 'openai'>('falai');
  const [modelId, setModelId] = useState('gemini-nano');
  const [currentIteration, setCurrentIteration] = useState<Iteration | null>(null);
  const [feedback, setFeedback] = useState<Map<string, FeedbackItem>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!taskGoal.trim()) {
      setError('Please enter a task goal');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const task: TaskSpec = {
        goal: taskGoal,
        modality: 'text-to-text',
      };

      const targetModel: ModelRef = {
        provider,
        modelId,
      };

      const response = await fetch('/api/iterations/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task, targetModel }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate');
      }

      const iteration: Iteration = await response.json();
      setCurrentIteration(iteration);

      // Initialize feedback map
      const newFeedback = new Map<string, FeedbackItem>();
      iteration.candidates.forEach((candidate) => {
        newFeedback.set(candidate.id, {
          candidateId: candidate.id,
          selected: false,
        });
      });
      setFeedback(newFeedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRefine = async () => {
    if (!currentIteration) {
      setError('No iteration to refine');
      return;
    }

    const selectedItems = Array.from(feedback.values()).filter((item) => item.selected);
    if (selectedItems.length === 0) {
      setError('Please select at least one candidate');
      return;
    }

    setIsRefining(true);
    setError(null);

    try {
      const refineRequest = {
        iterationId: currentIteration.id,
        feedback: Array.from(feedback.values()),
      };

      const response = await fetch('/api/iterations/refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refineRequest,
          targetModel: currentIteration.targetModel,
          task: currentIteration.task,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to refine');
      }

      const newIteration: Iteration = await response.json();
      setCurrentIteration(newIteration);

      // Initialize feedback map for new iteration
      const newFeedback = new Map<string, FeedbackItem>();
      newIteration.candidates.forEach((candidate) => {
        newFeedback.set(candidate.id, {
          candidateId: candidate.id,
          selected: false,
        });
      });
      setFeedback(newFeedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsRefining(false);
    }
  };

  const updateFeedback = (candidateId: string, updates: Partial<FeedbackItem>) => {
    const current = feedback.get(candidateId);
    if (current) {
      setFeedback(
        new Map(feedback.set(candidateId, { ...current, ...updates }))
      );
    }
  };

  const pairs = currentIteration
    ? getCandidateResultPairs(currentIteration)
    : [];

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">
            PromptAura
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Sprint 1: iteration loop
          </p>
        </div>

        {/* Input Section */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <div className="space-y-4">
            <div>
              <label
                htmlFor="task"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Task Goal
              </label>
              <textarea
                id="task"
                rows={3}
                value={taskGoal}
                onChange={(e) => setTaskGoal(e.target.value)}
                placeholder="e.g., Write a prompt for a cat wearing shorts and a t-shirt"
                className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="provider"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Provider
                </label>
                <select
                  id="provider"
                  value={provider}
                  onChange={(e) =>
                    setProvider(e.target.value as 'falai' | 'google' | 'openai')
                  }
                  className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                >
                  <option value="falai">Fal.ai</option>
                  <option value="google">Google</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="modelId"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Model ID
                </label>
                <input
                  id="modelId"
                  type="text"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder="e.g., gemini-nano"
                  className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating || !taskGoal.trim()}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              {isGenerating ? 'Generating...' : 'Generate (20 candidates)'}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Results Section */}
        {currentIteration && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
                Results ({pairs.length} candidates)
              </h2>
              <button
                onClick={handleRefine}
                disabled={
                  isRefining ||
                  Array.from(feedback.values()).filter((f) => f.selected).length === 0
                }
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                {isRefining ? 'Refining...' : 'Refine (10 candidates)'}
              </button>
            </div>

            <div className="space-y-4">
              {pairs.map(({ candidate, result }) => {
                const feedbackItem = feedback.get(candidate.id);
                const isSelected = feedbackItem?.selected || false;

                return (
                  <div
                    key={candidate.id}
                    className={`rounded-lg border p-4 ${
                      isSelected
                        ? 'border-zinc-500 bg-zinc-50 dark:bg-zinc-900'
                        : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
                    }`}
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          updateFeedback(candidate.id, { selected: e.target.checked })
                        }
                        className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-600 focus:ring-zinc-500"
                      />
                      <div className="flex-1">
                        <div className="mb-2">
                          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            Prompt
                          </label>
                          <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
                            {candidate.prompt}
                          </p>
                        </div>
                        {result && (
                          <div className="mb-2">
                            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              Output
                            </label>
                            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                              {result.outputText}
                            </p>
                          </div>
                        )}
                        <div>
                          <label
                            htmlFor={`note-${candidate.id}`}
                            className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                          >
                            Note (optional)
                          </label>
                          <textarea
                            id={`note-${candidate.id}`}
                            rows={2}
                            value={feedbackItem?.note || ''}
                            onChange={(e) =>
                              updateFeedback(candidate.id, { note: e.target.value })
                            }
                            placeholder="Add your feedback note..."
                            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                          />
                        </div>
                      </div>
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
