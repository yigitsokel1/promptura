/**
 * Blok C: Execution provider abstraction.
 * All execution backends (fal.ai, eachlabs) implement this interface.
 */

import type { CandidatePrompt, OutputAsset, TaskAsset } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';

export type ExecutionJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ExecutionResult {
  output?: unknown;
  error?: string;
}

/** Task assets for payload building (image-to-image, etc.) */
export interface TaskInputs {
  image?: string;
  video?: string;
  text?: string;
  /** New modality-agnostic format; preferred when present */
  assets?: TaskAsset[];
  /**
   * Optional upload cache: base64/data URL -> fal.ai URL.
   * Avoids re-uploading the same image/video per candidate (was causing timeouts).
   */
  _uploadCache?: Map<string, string>;
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
   * options.requiredInputDefaults: provider-specific defaults for required params (e.g. from research request_schema); only that provider uses them.
   */
  submit(
    endpointId: string,
    payload: Record<string, unknown>,
    options?: { requiredInputDefaults?: Record<string, unknown> }
  ): Promise<string>;

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
   * Convert provider-specific raw output to OutputAsset[] using ModelSpec.
   */
  convertToOutputAssets(rawOutput: unknown, modelSpec: ModelSpec): OutputAsset[];
}

export type ExecutionProviderSlug = 'falai' | 'eachlabs';
