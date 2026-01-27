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
import type { TaskSpec, ModelRef, CandidatePrompt, RunResult } from '@/src/core/types';

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
      (variation, i) =>
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

    const candidates: CandidatePrompt[] = promptStrings.slice(0, count).map((prompt, i) => ({
      id: `mock_candidate_${Date.now()}_${i}`,
      prompt,
      generator: 'self',
    }));

    return { candidates };
  }

  /**
   * Generate mock results
   */
  async runCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    candidates: CandidatePrompt[]
  ): Promise<RunCandidatesResult> {
    const startTime = Date.now();

    const results: RunResult[] = candidates.map((candidate, index) => {
      const latencyMs = Math.floor(Math.random() * 1000) + 100; // 100-1100ms

      return {
        candidateId: candidate.id,
        outputText: `Mock output ${index + 1} for prompt: "${candidate.prompt.substring(0, 50)}${candidate.prompt.length > 50 ? '...' : ''}"`,
        meta: {
          latencyMs,
        },
      };
    });

    return { results };
  }
}
