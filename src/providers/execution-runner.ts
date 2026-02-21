/**
 * Blok C: Generic runner adapter that uses ExecutionProvider.
 * No if(provider) in this file — provider is injected via factory.
 */

import type {
  ProviderAdapter,
  PromptGenerationContext,
  PromptGenerationResult,
  RunCandidatesResult,
} from './types';
import type { TaskSpec, ModelRef, CandidatePrompt, RunResult } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import type { ExecutionProvider } from './execution';
import { createRun, updateRun } from '@/src/db/queries';
import { limitConcurrency } from '@/src/lib/concurrency';

export class ExecutionRunnerAdapter implements ProviderAdapter {
  constructor(private executionProvider: ExecutionProvider) {}

  async generateCandidates(
    _task: TaskSpec,
    _targetModel: ModelRef,
    _count: number,
    _context?: PromptGenerationContext
  ): Promise<PromptGenerationResult> {
    throw new Error(
      'ExecutionRunnerAdapter does not support prompt generation. Use Gemini for prompt generation.'
    );
  }

  async runCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    candidates: CandidatePrompt[],
    context?: {
      modelSpec?: ModelSpec;
      iterationId?: string;
      modelEndpointId?: string;
      submitOnly?: boolean;
    }
  ): Promise<RunCandidatesResult> {
    if (!context?.modelSpec) throw new Error('ModelSpec is required for running candidates');
    if (!context?.iterationId) throw new Error('iterationId is required for running candidates');
    if (!context?.modelEndpointId) throw new Error('modelEndpointId is required for running candidates');

    const modelSpec = context.modelSpec;
    const iterationId = context.iterationId;
    const modelEndpointId = context.modelEndpointId;
    const endpointId = targetModel.modelId;
    const startTime = Date.now();
    const provider = this.executionProvider;

    await Promise.all(
      candidates.map((candidate) =>
        createRun({ iterationId, modelEndpointId, candidateId: candidate.id, status: 'queued' })
      )
    );

    const CONCURRENCY = 10;
    // Normalize: ensure image/video from assets are available as legacy task.inputs for buildPayload
    const imgFromAssets = task.assets?.find((a) => a.type === 'image')?.url;
    const vidFromAssets = task.assets?.find((a) => a.type === 'video')?.url;
    const taskInputs = {
      ...task.inputs,
      image: task.inputs?.image ?? imgFromAssets,
      video: task.inputs?.video ?? vidFromAssets,
      assets: task.assets,
      _uploadCache: new Map<string, string>(), // Same image/video uploaded once, reused for all candidates
    };

    const jobSubmissions = await limitConcurrency(
      candidates,
      async (candidate) => {
        try {
          const payload = await provider.buildPayload(
            candidate,
            modelSpec,
            taskInputs
          );
          const requestId = await provider.submit(endpointId, payload, {
            requiredInputDefaults: modelSpec.required_input_defaults,
          });

          await updateRun(iterationId, candidate.id, {
            falRequestId: requestId,
            status: 'running',
          });

          return { candidateId: candidate.id, requestId };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await updateRun(iterationId, candidate.id, { status: 'error', error: msg });
          return { candidateId: candidate.id, requestId: null, error: msg };
        }
      },
      CONCURRENCY
    );

    if (context.submitOnly) {
      return {
        results: jobSubmissions.map((s) => ({
          candidateId: s.candidateId,
          assets: [
            {
              type: 'text' as const,
              content: s.error
                ? `Error: ${s.error}`
                : '[Pending] Job submitted, waiting for completion...',
            },
          ],
          metadata: { latencyMs: Date.now() - startTime },
        })),
      };
    }

    const results: RunResult[] = await Promise.all(
      jobSubmissions.map(async (submission) => {
        if (submission.error || !submission.requestId) {
          return {
            candidateId: submission.candidateId,
            assets: [
              {
                type: 'text' as const,
                content: `Error: ${submission.error ?? 'Failed to submit job'}`,
              },
            ],
            metadata: { latencyMs: Date.now() - startTime },
          };
        }
        const result = await this.pollJobResult(
          endpointId,
          submission.requestId,
          modelSpec,
          provider,
          iterationId,
          submission.candidateId,
          startTime
        );
        return {
          candidateId: submission.candidateId,
          assets: result.assets,
          metadata: result.metadata,
        };
      })
    );
    return { results };
  }

  private async pollJobResult(
    endpointId: string,
    requestId: string,
    modelSpec: ModelSpec,
    provider: ExecutionProvider,
    iterationId: string,
    candidateId: string,
    startTime: number,
    maxWaitMs = 300_000,
    pollIntervalMs = 2000
  ): Promise<{ assets: import('@/src/core/types').OutputAsset[]; metadata: { latencyMs: number } }> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const status = await provider.getStatus(endpointId, requestId);
      if (status === 'completed' || status === 'failed') {
        const result = await provider.getResult(endpointId, requestId);
        const latencyMs = Date.now() - startTime;
        if (status === 'failed' || result.error) {
          const err = result.error ?? 'Unknown error';
          await updateRun(iterationId, candidateId, { status: 'error', error: err });
          throw new Error(`Job failed: ${err}`);
        }
        const assets = provider.convertToOutputAssets(result.output, modelSpec);
        await updateRun(iterationId, candidateId, {
          status: 'done',
          outputJson: { assets },
          latencyMs,
        });
        return { assets, metadata: { latencyMs } };
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    await updateRun(iterationId, candidateId, {
      status: 'error',
      error: `Job timed out after ${maxWaitMs}ms`,
    });
    throw new Error(`Job timed out after ${maxWaitMs}ms`);
  }
}
