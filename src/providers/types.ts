/**
 * Provider adapter interfaces
 * All providers must implement these interfaces
 */

import type { TaskSpec, ModelRef, CandidatePrompt, RunResult } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';

/**
 * Selected prompt text + note + output summary for refine (Blok C: rich context)
 */
export interface SelectedPromptForRefine {
  prompt: string;
  note?: string;
  /** Short summary of run output (no raw JSON) so Gemini knows what the model produced */
  outputSummary?: string;
}

/**
 * Context for prompt generation (e.g., previous iteration feedback, model spec)
 */
export interface PromptGenerationContext {
  previousCandidates?: CandidatePrompt[];
  feedback?: Array<{
    candidateId: string;
    note?: string;
    selected: boolean;
  }>;
  /** For refine: selected prompts with text so Gemini can evolve them (Contract v2) */
  selectedPrompts?: SelectedPromptForRefine[];
  goal: string;
  modelSpec?: ModelSpec; // ModelSpec for ModelSpec-aware prompt generation
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
   * @param context - Optional context (e.g., ModelSpec, iterationId, modelEndpointId, submitOnly for DB persistence)
   */
  runCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    candidates: CandidatePrompt[],
    context?: { 
      modelSpec?: ModelSpec; 
      iterationId?: string; 
      modelEndpointId?: string;
      submitOnly?: boolean;
    }
  ): Promise<RunCandidatesResult>;
}
