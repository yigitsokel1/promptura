/**
 * Mock provider adapter
 * Used when USE_MOCK_PROVIDERS=true
 */

import type {
  ProviderAdapter,
  PromptGenerationContext,
  PromptGenerationResult,
  RunCandidatesResult,
} from './types';
import type { TaskSpec, ModelRef, CandidatePrompt, RunResult, RunOutput } from '@/src/core/types';

/**
 * Generate mock prompt variations
 */
function generateMockPromptVariations(goal: string, count: number): string[] {
  const variations = [
    `${goal}`,
    `Create a prompt that: ${goal}`,
    `Write a detailed prompt for: ${goal}`,
    `Generate a prompt describing: ${goal}`,
    `Craft a prompt that achieves: ${goal}`,
    `Design a prompt for the following task: ${goal}`,
    `Develop a prompt that will: ${goal}`,
    `Formulate a prompt to accomplish: ${goal}`,
    `Construct a prompt that focuses on: ${goal}`,
    `Build a prompt that emphasizes: ${goal}`,
    `Produce a prompt that highlights: ${goal}`,
    `Create an effective prompt for: ${goal}`,
    `Write a clear and concise prompt: ${goal}`,
    `Generate a comprehensive prompt: ${goal}`,
    `Craft a well-structured prompt: ${goal}`,
    `Design a prompt with specific details: ${goal}`,
    `Develop a prompt that includes: ${goal}`,
    `Formulate a prompt that ensures: ${goal}`,
    `Construct a prompt that captures: ${goal}`,
    `Build a prompt that represents: ${goal}`,
  ];

  // Return the requested count, cycling through variations if needed
  return Array.from({ length: count }, (_, i) => variations[i % variations.length]);
}

/**
 * Generate refined mock prompts based on feedback
 */
function generateRefinedMockPrompts(
  goal: string,
  context?: PromptGenerationContext
): string[] {
  const baseVariations = [
    `Refined version: ${goal}`,
    `Improved prompt for: ${goal}`,
    `Enhanced version focusing on: ${goal}`,
    `Optimized prompt that: ${goal}`,
    `Better structured prompt: ${goal}`,
    `Refined approach to: ${goal}`,
    `Enhanced prompt emphasizing: ${goal}`,
    `Improved version that addresses: ${goal}`,
    `Optimized prompt based on feedback: ${goal}`,
    `Refined prompt incorporating: ${goal}`,
  ];

  // If we have feedback, incorporate it
  if (context?.feedback && context.feedback.length > 0) {
    const selectedCount = context.feedback.filter((f) => f.selected).length;
    return baseVariations.map(
      (variation) =>
        `${variation} (refined based on ${selectedCount} selected items)`
    );
  }

  return baseVariations;
}

export class MockProviderAdapter implements ProviderAdapter {
  /**
   * Generate mock candidate prompts
   */
  async generateCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    count: number,
    context?: PromptGenerationContext
  ): Promise<PromptGenerationResult> {
    const isRefinement = context?.feedback && context.feedback.length > 0;
    const promptStrings = isRefinement
      ? generateRefinedMockPrompts(task.goal, context)
      : generateMockPromptVariations(task.goal, count);

    const candidates: CandidatePrompt[] = promptStrings.slice(0, count).map((prompt, index) => ({
      id: `mock_candidate_${Date.now()}_${index}`,
      prompt,
      generator: 'self',
    }));

    return { candidates };
  }

  /**
   * Generate mock results
   * @deprecated Sprint 3: Mock provider should not be used for production
   * This is only for development/testing. Set USE_MOCK_PROVIDERS=false to use real fal.ai
   */
  async runCandidates(
    task: TaskSpec,
    _targetModel: ModelRef,
    candidates: CandidatePrompt[],
    context?: { modelSpec?: unknown; iterationId?: string; modelEndpointId?: string; submitOnly?: boolean }
  ): Promise<RunCandidatesResult> {
    // For submitOnly mode, create Run records and immediately update to "done" with mock results
    // This simulates async behavior without actually calling fal.ai
    if (context?.submitOnly && context?.iterationId && context?.modelEndpointId) {
      const { createRun, updateRun } = await import('@/src/db/queries');
      
      // Create and immediately complete Run records with mock results
      for (const candidate of candidates) {
        // Create Run record
        await createRun({
          iterationId: context.iterationId!,
          modelEndpointId: context.modelEndpointId!,
          candidateId: candidate.id,
          status: 'queued',
        });
        
        // Immediately update to "done" with mock result (simulates instant completion)
        const latencyMs = Math.floor(Math.random() * 500) + 200; // 200-700ms
        
        // Determine output type based on task modality
        let output: RunOutput;
        if (task.modality === 'text-to-text') {
          output = {
            type: 'text',
            text: `Mock text output for prompt: "${candidate.prompt.substring(0, 50)}${candidate.prompt.length > 50 ? '...' : ''}"`,
          };
        } else if (
          task.modality === 'text-to-image' ||
          task.modality === 'image-to-image'
        ) {
          output = {
            type: 'image',
            images: [{ url: `https://placeholder.image/mock-${candidate.id}.png` }],
          };
        } else if (
          task.modality === 'text-to-video' ||
          task.modality === 'image-to-video' ||
          task.modality === 'video-to-video'
        ) {
          output = {
            type: 'video',
            videos: [{ url: `https://placeholder.video/mock-${candidate.id}.mp4` }],
          };
        } else {
          output = {
            type: 'text',
            text: `Mock output for prompt: "${candidate.prompt.substring(0, 50)}${candidate.prompt.length > 50 ? '...' : ''}"`,
          };
        }
        
        // Update Run to "done" with mock result
        await updateRun(context.iterationId!, candidate.id, {
          status: 'done',
          outputJson: output as unknown as Record<string, unknown>,
          latencyMs,
        });
      }
      
      console.warn('[MockProvider] submitOnly mode - created and completed Run records with mock results. Set USE_MOCK_PROVIDERS=false to use real fal.ai');
      return { results: [] };
    }
    const results: RunResult[] = candidates.map((candidate, index) => {
      const latencyMs = Math.floor(Math.random() * 1000) + 100; // 100-1100ms

      // Determine output type based on task modality
      if (task.modality === 'text-to-text') {
        return {
          candidateId: candidate.id,
          output: {
            type: 'text',
            text: `Mock text output ${index + 1} for prompt: "${candidate.prompt.substring(0, 50)}${candidate.prompt.length > 50 ? '...' : ''}"`,
          },
          meta: {
            latencyMs,
          },
        };
      } else if (
        task.modality === 'text-to-image' ||
        task.modality === 'image-to-image'
      ) {
        return {
          candidateId: candidate.id,
          output: {
            type: 'image',
            images: [
              { url: `https://placeholder.image/mock-${candidate.id}.png` },
            ],
          },
          meta: {
            latencyMs,
          },
        };
      } else if (
        task.modality === 'text-to-video' ||
        task.modality === 'image-to-video' ||
        task.modality === 'video-to-video'
      ) {
        return {
          candidateId: candidate.id,
          output: {
            type: 'video',
            videos: [
              { url: `https://placeholder.video/mock-${candidate.id}.mp4` },
            ],
          },
          meta: {
            latencyMs,
          },
        };
      } else {
        // Fallback to text
        return {
          candidateId: candidate.id,
          output: {
            type: 'text',
            text: `Mock output ${index + 1} for prompt: "${candidate.prompt.substring(0, 50)}${candidate.prompt.length > 50 ? '...' : ''}"`,
          },
          meta: {
            latencyMs,
          },
        };
      }
    });

    return { results };
  }
}
