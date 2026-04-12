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
import type { ModelSpec } from '@/src/core/modelSpec';
import { FalAIClient } from './client';
import type { FalAIConfig } from './types';
import { buildFalAIPayload, convertFalAIOutputToOutputAssets } from './helpers';
import { createRun, updateRun } from '@/src/db/queries';
import { limitConcurrency } from '@/src/lib/concurrency';

export class FalAIAdapter implements ProviderAdapter {
  private client: FalAIClient;

  constructor(config: FalAIConfig) {
    this.client = new FalAIClient(config);
  }

  /**
   * Generate candidate prompts
   * @deprecated Sprint 3: All prompt generation is done by Gemini.
   * FalAIAdapter is now only a runner, not a prompt generator.
   * This method should never be called - use GeminiAdapter instead.
   */
  async generateCandidates(
    _task: TaskSpec,
    _targetModel: ModelRef,
    _count: number,
    _context?: PromptGenerationContext
  ): Promise<PromptGenerationResult> {
    throw new Error(
      'FalAIAdapter does not support prompt generation. Use GeminiAdapter for prompt generation (Sprint 3: Gemini-only).'
    );
  }

  /**
   * Run candidate prompts and get results using fal.ai Queue API
   * Requires ModelSpec, iterationId, and modelEndpointId in context
   * If submitOnly is true, only submits jobs and returns pending results (for UI polling)
   */
  async runCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    candidates: CandidatePrompt[],
    context?: { 
      modelSpec?: ModelSpec; 
      iterationId?: string; 
      modelEndpointId?: string;
      submitOnly?: boolean; // If true, only submit jobs, don't poll (for UI polling)
    }
  ): Promise<RunCandidatesResult> {
    if (!context?.modelSpec) {
      throw new Error('ModelSpec is required for running candidates');
    }
    if (!context?.iterationId) {
      throw new Error('iterationId is required for running candidates');
    }
    if (!context?.modelEndpointId) {
      throw new Error('modelEndpointId is required for running candidates');
    }

    const modelSpec = context.modelSpec;
    const iterationId = context.iterationId;
    const modelEndpointId = context.modelEndpointId;
    const startTime = Date.now();

    // Create Run records in DB for all candidates
    const runPromises = candidates.map((candidate) =>
      createRun({
        iterationId,
        modelEndpointId,
        candidateId: candidate.id,
        status: 'queued',
      })
    );
    await Promise.all(runPromises);

    // Submit all jobs with concurrency limit (10 concurrent requests max)
    const FAL_AI_CONCURRENCY_LIMIT = 10;
    const jobSubmissions = await limitConcurrency(
      candidates,
      async (candidate) => {
        try {
          // Build payload from candidate and ModelSpec (with upload support)
          const taskInputs = { ...task.inputs, assets: task.assets };
          const payload = await buildFalAIPayload(candidate, modelSpec, taskInputs, this.client);

          // Submit job to queue
          const requestId = await this.client.submitQueueJob(
            targetModel.modelId,
            payload
          );
          console.log(`[FalAI] fal.ai request id=${requestId} iterationId=${iterationId} candidateId=${candidate.id} submitted`);

          // Update Run with falRequestId and status
          await updateRun(iterationId, candidate.id, {
            falRequestId: requestId,
            status: 'running',
          });

          return {
            candidateId: candidate.id,
            requestId,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          console.error(`[FalAI] Failed to submit job for candidate ${candidate.id}:`, errorMessage);
          
          // Update Run with error
          await updateRun(iterationId, candidate.id, {
            status: 'error',
            error: errorMessage,
          });

          return {
            candidateId: candidate.id,
            requestId: null,
            error: errorMessage,
          };
        }
      },
      FAL_AI_CONCURRENCY_LIMIT
    );

    // If submitOnly, return pending results (UI will poll)
    if (context?.submitOnly) {
      const results: RunResult[] = jobSubmissions.map((submission) => {
        const text = submission.error || !submission.requestId
          ? `Error: ${submission.error || 'Failed to submit job'}`
          : '[Pending] Job submitted, waiting for completion...';
        return {
          candidateId: submission.candidateId,
          assets: [{ type: 'text' as const, content: text }],
          metadata: { latencyMs: Date.now() - startTime },
        };
      });
      return { results };
    }

    const results: RunResult[] = await Promise.all(
      jobSubmissions.map(async (submission) => {
        if (submission.error || !submission.requestId) {
          return {
            candidateId: submission.candidateId,
            assets: [{ type: 'text' as const, content: `Error: ${submission.error || 'Failed to submit job'}` }],
            metadata: { latencyMs: Date.now() - startTime },
          };
        }

        const result = await this.pollJobResult(
          targetModel.modelId,
          submission.requestId,
          modelSpec,
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

  /**
   * Poll a job until it completes and return the result
   * Updates Run record in DB as job progresses
   */
  private async pollJobResult(
    modelId: string,
    requestId: string,
    modelSpec: ModelSpec,
    iterationId: string,
    candidateId: string,
    startTime: number,
    maxWaitTime = 300000, // 5 minutes max
    pollInterval = 2000 // 2 seconds between polls
  ): Promise<{ assets: import('@/src/core/types').OutputAsset[]; metadata: { latencyMs: number; raw?: unknown } }> {
    const deadline = Date.now() + maxWaitTime;

    while (Date.now() < deadline) {
      const statusResponse = await this.client.getQueueJobStatus(modelId, requestId);
      const status = statusResponse.status;

      if (status === 'COMPLETED') {
        const result = await this.client.getQueueJobResult(modelId, requestId, {
          responseUrl: statusResponse.response_url,
        });
        
        if (result.error) {
          // Update Run with error
          await updateRun(iterationId, candidateId, {
            status: 'error',
            error: result.error,
          });
          throw new Error(`Job failed: ${result.error}`);
        }

        const assets = convertFalAIOutputToOutputAssets(result.output, modelSpec);
        const latencyMs = Date.now() - startTime;

        await updateRun(iterationId, candidateId, {
          status: 'done',
          outputJson: { assets },
          latencyMs,
        });

        return {
          assets,
          metadata: {
            latencyMs,
            raw: result.output,
          },
        };
      } else if (status === 'FAILED') {
        const result = await this.client.getQueueJobResult(modelId, requestId, {
          responseUrl: statusResponse.response_url,
        });
        const errorMessage = result.error || 'Unknown error';
        
        // Update Run with error
        await updateRun(iterationId, candidateId, {
          status: 'error',
          error: errorMessage,
        });
        
        throw new Error(`Job failed: ${errorMessage}`);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timeout - update Run with error
    await updateRun(iterationId, candidateId, {
      status: 'error',
      error: `Job timed out after ${maxWaitTime}ms`,
    });

    throw new Error(`Job timed out after ${maxWaitTime}ms`);
  }

  /**
   * Convert fal.ai output to RunOutput based on ModelSpec
   */
}

/**
 * Create Fal.ai adapter with given apiKey (Blok B: user key) or from env (admin/system).
 */
export function createFalAIAdapter(config?: { apiKey?: string }): FalAIAdapter {
  const apiKey = config?.apiKey ?? process.env.FAL_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'FAL_AI_API_KEY is required. Add your key in Settings → Provider keys, or set FAL_AI_API_KEY for system use.'
    );
  }
  return new FalAIAdapter({
    apiKey,
    baseUrl: process.env.FAL_AI_BASE_URL,
  });
}
