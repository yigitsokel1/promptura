/**
 * Fal.ai provider adapter
 * Implements Runner & PromptGen capabilities
 */

import type {
  ProviderAdapter,
  PromptGenerationContext,
  PromptGenerationResult,
  RunCandidatesResult,
} from '../types';
import type { TaskSpec, ModelRef, CandidatePrompt, RunResult } from '@/src/core/types';
import { FalAIClient } from './client';
import type { FalAIConfig } from './types';

export class FalAIAdapter implements ProviderAdapter {
  private client: FalAIClient;

  constructor(config: FalAIConfig) {
    this.client = new FalAIClient(config);
  }

  /**
   * Generate candidate prompts
   * Fal.ai can generate prompts if the model supports it
   */
  async generateCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    count: number,
    context?: PromptGenerationContext
  ): Promise<PromptGenerationResult> {
    // TODO: Implement actual prompt generation via Fal.ai
    // For now, return placeholder
    const candidates: CandidatePrompt[] = Array.from({ length: count }, (_, i) => ({
      id: `falai_candidate_${Date.now()}_${i}`,
      prompt: `[Fal.ai] Generated prompt ${i + 1} for: ${task.goal}`,
      generator: 'self',
    }));

    return { candidates };
  }

  /**
   * Run candidate prompts and get results
   */
  async runCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    candidates: CandidatePrompt[]
  ): Promise<RunCandidatesResult> {
    const startTime = Date.now();

    // TODO: Implement actual Fal.ai API calls
    // For now, return placeholder results
    const results: RunResult[] = candidates.map((candidate) => {
      const latencyMs = Date.now() - startTime + Math.floor(Math.random() * 100);

      return {
        candidateId: candidate.id,
        outputText: `[Fal.ai Mock] Output for: ${candidate.prompt}`,
        meta: {
          latencyMs,
        },
      };
    });

    return { results };
  }
}

/**
 * Create Fal.ai adapter from environment variables
 */
export function createFalAIAdapter(): FalAIAdapter {
  const apiKey = process.env.FAL_AI_API_KEY;
  if (!apiKey) {
    throw new Error('FAL_AI_API_KEY environment variable is required');
  }

  return new FalAIAdapter({
    apiKey,
    baseUrl: process.env.FAL_AI_BASE_URL,
  });
}
