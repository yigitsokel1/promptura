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

const FAL_QUEUE_STATUSES = new Set<string>(Object.keys(STATUS_MAP));

/**
 * Map fal queue API status to execution poll status.
 * Unknown or empty values become `failed` so polls do not spin until stale timeout.
 */
function mapFalQueueStatusToExecution(
  falStatus: string | undefined,
  context: { endpointId: string; requestId: string; phase: 'poll' | 'result' }
): 'queued' | 'running' | 'completed' | 'failed' {
  if (falStatus === undefined || falStatus === '') {
    console.warn(
      `[FalAIExec] Empty queue status endpoint=${context.endpointId} requestId=${context.requestId} phase=${context.phase}`
    );
    return 'failed';
  }
  if (!FAL_QUEUE_STATUSES.has(falStatus)) {
    console.warn(
      `[FalAIExec] Unmapped queue status raw=${JSON.stringify(falStatus)} endpoint=${context.endpointId} requestId=${context.requestId} phase=${context.phase}`
    );
    return 'failed';
  }
  return STATUS_MAP[falStatus as FalAIQueueStatus];
}

export class FalAIExecutionProvider implements ExecutionProvider {
  /** From last status poll: fal's `response_url` for fetching the result body (parallel runs keyed by request id). */
  private falResultUrlByRequestId = new Map<string, string>();

  constructor(private client: FalAIClient) {}

  async buildPayload(
    candidate: CandidatePrompt,
    modelSpec: ModelSpec,
    taskInputs?: TaskInputs
  ): Promise<Record<string, unknown>> {
    return buildFalAIPayload(candidate, modelSpec, taskInputs, this.client);
  }

  async submit(
    endpointId: string,
    payload: Record<string, unknown>,
    _options?: { requiredInputDefaults?: Record<string, unknown> }
  ): Promise<string> {
    return this.client.submitQueueJob(endpointId, payload);
  }

  async getStatus(endpointId: string, requestId: string): Promise<'queued' | 'running' | 'completed' | 'failed'> {
    const res = await this.client.getQueueJobStatus(endpointId, requestId);
    const falStatus = res.status as string;
    if (
      (falStatus === 'COMPLETED' || falStatus === 'FAILED') &&
      typeof res.response_url === 'string' &&
      res.response_url.length > 0
    ) {
      this.falResultUrlByRequestId.set(requestId, res.response_url);
    }
    return mapFalQueueStatusToExecution(falStatus, {
      endpointId,
      requestId,
      phase: 'poll',
    });
  }

  async getResult(
    endpointId: string,
    requestId: string
  ): Promise<ExecutionResult & { status: 'queued' | 'running' | 'completed' | 'failed' }> {
    const responseUrl = this.falResultUrlByRequestId.get(requestId);
    if (responseUrl !== undefined) {
      this.falResultUrlByRequestId.delete(requestId);
    }
    const result = await this.client.getQueueJobResult(endpointId, requestId, { responseUrl });
    const status = mapFalQueueStatusToExecution(result.status as string, {
      endpointId,
      requestId,
      phase: 'result',
    });
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
