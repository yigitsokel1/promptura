/**
 * Blok C: Fal.ai execution provider (ExecutionProvider implementation).
 */

import type { ExecutionProvider, ExecutionResult, TaskInputs } from './types';
import type { FalAIQueueStatus } from '@/src/providers/falai/types';
import type { CandidatePrompt } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { FalAIClient } from '@/src/providers/falai/client';
import { buildFalAIPayload, convertFalAIOutputToOutputAssets } from '@/src/providers/falai/helpers';
import type { OutputAsset } from '@/src/core/types';

const STATUS_MAP: Record<FalAIQueueStatus, 'queued' | 'running' | 'completed' | 'failed'> = {
  IN_QUEUE: 'queued',
  IN_PROGRESS: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export class FalAIExecutionProvider implements ExecutionProvider {
  constructor(private client: FalAIClient) {}

  async buildPayload(
    candidate: CandidatePrompt,
    modelSpec: ModelSpec,
    taskInputs?: TaskInputs
  ): Promise<Record<string, unknown>> {
    return buildFalAIPayload(candidate, modelSpec, taskInputs, this.client);
  }

  async submit(endpointId: string, payload: Record<string, unknown>): Promise<string> {
    return this.client.submitQueueJob(endpointId, payload);
  }

  async getStatus(endpointId: string, requestId: string): Promise<'queued' | 'running' | 'completed' | 'failed'> {
    const res = await this.client.getQueueJobStatus(endpointId, requestId);
    return STATUS_MAP[res.status] ?? 'running';
  }

  async getResult(
    endpointId: string,
    requestId: string
  ): Promise<ExecutionResult & { status: 'queued' | 'running' | 'completed' | 'failed' }> {
    const result = await this.client.getQueueJobResult(endpointId, requestId);
    const status = STATUS_MAP[result.status] ?? 'running';
    return {
      status,
      output: result.output,
      error: result.error,
    };
  }

  convertToOutputAssets(rawOutput: unknown, modelSpec: ModelSpec): OutputAsset[] {
    return convertFalAIOutputToOutputAssets(rawOutput, modelSpec);
  }
}
