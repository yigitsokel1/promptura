/**
 * Blok C: Execution provider abstraction.
 * All execution backends (fal.ai, eachlabs) implement this interface.
 */

import type { CandidatePrompt, RunOutput } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';

export type ExecutionJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ExecutionResult {
  output?: unknown;
  error?: string;
}

/** Optional task inputs (image, video, text) for payload building */
export interface TaskInputs {
  image?: string;
  video?: string;
  text?: string;
}

/**
 * Execution provider: submit job, poll status, get result.
 * Implementations: FalAI, EachLabs. No if(provider) in call sites.
 */
export interface ExecutionProvider {
  /**
   * Build request payload for this provider from candidate + spec + task inputs.
   */
  buildPayload(
    candidate: CandidatePrompt,
    modelSpec: ModelSpec,
    taskInputs?: TaskInputs
  ): Promise<Record<string, unknown>>;

  /**
   * Submit a job. Returns request ID for status/result polling.
   */
  submit(endpointId: string, payload: Record<string, unknown>): Promise<string>;

  /**
   * Get current job status.
   */
  getStatus(endpointId: string, requestId: string): Promise<ExecutionJobStatus>;

  /**
   * Get job result (when status is completed or failed).
   */
  getResult(
    endpointId: string,
    requestId: string
  ): Promise<ExecutionResult & { status: ExecutionJobStatus }>;

  /**
   * Convert provider-specific raw output to RunOutput using ModelSpec.
   */
  convertToRunOutput(rawOutput: unknown, modelSpec: ModelSpec): RunOutput;
}

export type ExecutionProviderSlug = 'falai' | 'eachlabs';
