/**
 * Provider adapter interfaces
 * All providers must implement these interfaces
 */

import type { TaskSpec, ModelRef, CandidatePrompt, RunResult } from '@/src/core/types';

/**
 * Context for prompt generation (e.g., previous iteration feedback)
 */
export interface PromptGenerationContext {
  previousCandidates?: CandidatePrompt[];
  feedback?: Array<{
    candidateId: string;
    note?: string;
    selected: boolean;
  }>;
  goal: string;
}

/**
 * Result of prompt generation
 */
export interface PromptGenerationResult {
  candidates: CandidatePrompt[];
}

/**
 * Result of running candidates
 */
export interface RunCandidatesResult {
  results: RunResult[];
}

/**
 * Provider adapter interface
 */
export interface ProviderAdapter {
  /**
   * Generate candidate prompts
   * @param task - The task specification
   * @param targetModel - The target model reference
   * @param count - Number of candidates to generate
   * @param context - Optional context (e.g., previous feedback)
   */
  generateCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    count: number,
    context?: PromptGenerationContext
  ): Promise<PromptGenerationResult>;

  /**
   * Run candidate prompts and get results
   * @param task - The task specification
   * @param targetModel - The target model reference
   * @param candidates - The candidate prompts to run
   */
  runCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    candidates: CandidatePrompt[]
  ): Promise<RunCandidatesResult>;
}
