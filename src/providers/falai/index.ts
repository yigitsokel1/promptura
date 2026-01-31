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
import type { TaskSpec, ModelRef, CandidatePrompt, RunResult, RunOutput } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { FalAIClient } from './client';
import type { FalAIConfig, FalAIQueueStatus } from './types';
import { buildFalAIPayload, convertFalAIOutputToRunOutput } from './helpers';
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
          const payload = await buildFalAIPayload(candidate, modelSpec, task.inputs, this.client);

          console.log(`[FalAI] Submitting job for candidate ${candidate.id} to ${targetModel.modelId}`);
          console.log(`[FalAI] Payload:`, JSON.stringify(payload, null, 2));

          // Submit job to queue
          const requestId = await this.client.submitQueueJob(
            targetModel.modelId,
            payload
          );

          console.log(`[FalAI] Job submitted successfully. Request ID: ${requestId} for candidate ${candidate.id}`);

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
        if (submission.error || !submission.requestId) {
          // Return error result (already saved to DB)
          return {
            candidateId: submission.candidateId,
            output: {
              type: 'text',
              text: `Error: ${submission.error || 'Failed to submit job'}`,
            },
            meta: {
              latencyMs: Date.now() - startTime,
            },
          };
        }

        // Return pending result (UI will poll for status)
        return {
          candidateId: submission.candidateId,
          output: {
            type: 'text',
            text: '[Pending] Job submitted, waiting for completion...',
          },
          meta: {
            latencyMs: Date.now() - startTime,
          },
        };
      });

      return { results };
    }

    // Poll for results (blocking - for testing/development only)
    const results: RunResult[] = await Promise.all(
      jobSubmissions.map(async (submission) => {
        if (submission.error || !submission.requestId) {
          // Return error result (already saved to DB)
          return {
            candidateId: submission.candidateId,
            output: {
              type: 'text',
              text: `Error: ${submission.error || 'Failed to submit job'}`,
            },
            meta: {
              latencyMs: Date.now() - startTime,
            },
          };
        }

        // Poll until job completes
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
          output: result.output,
          meta: result.meta,
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
  ): Promise<{ output: RunOutput; meta: { latencyMs: number; raw?: unknown } }> {
    const deadline = Date.now() + maxWaitTime;

    while (Date.now() < deadline) {
      const statusResponse = await this.client.getQueueJobStatus(modelId, requestId);
      const status = statusResponse.status;

      if (status === 'COMPLETED') {
        // Get result
        const result = await this.client.getQueueJobResult(modelId, requestId);
        
        if (result.error) {
          // Update Run with error
          await updateRun(iterationId, candidateId, {
            status: 'error',
            error: result.error,
          });
          throw new Error(`Job failed: ${result.error}`);
        }

        // Convert fal.ai output to RunOutput based on ModelSpec
        const output = convertFalAIOutputToRunOutput(result.output, modelSpec);
        const latencyMs = Date.now() - startTime;

        // Update Run with success result
        await updateRun(iterationId, candidateId, {
          status: 'done',
          outputJson: output as unknown as Record<string, unknown>,
          latencyMs,
        });

        return {
          output,
          meta: {
            latencyMs,
            raw: result.output,
          },
        };
      } else if (status === 'FAILED') {
        const result = await this.client.getQueueJobResult(modelId, requestId);
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
