import { NextRequest, NextResponse } from 'next/server';
import { updateRun } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import type { RunOutput } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { createFalAIClientFromEnv, convertFalAIOutputToRunOutput } from '@/src/providers/falai/helpers';
import { prisma } from '@/src/db/client';
import { limitConcurrencySettled } from '@/src/lib/concurrency';

interface StatusResponse {
  iterationId: string;
  runs: Array<{
    candidateId: string;
    status: 'queued' | 'running' | 'done' | 'error';
    output?: RunOutput;
    latencyMs?: number;
    error?: string;
    queuePosition?: number; // Position in fal.ai queue (if IN_QUEUE)
  }>;
  allDone: boolean;
  hasErrors: boolean;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: iterationId } = await params;

    if (!iterationId) {
      return NextResponse.json(
        { error: 'Missing iterationId' },
        { status: 400 }
      );
    }

    // Fetch runs from DB (with ModelEndpoint relation for endpointId and ModelSpec)
    let runs;
    try {
      runs = await prisma.run.findMany({
        where: { iterationId },
        include: { 
          modelEndpoint: {
            include: {
              modelSpecs: {
                orderBy: { researchedAt: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      // Only log if there are runs to check
      if (runs.length > 0) {
        const statusCounts = runs.reduce((acc, run) => {
          acc[run.status] = (acc[run.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        // Only log if there are running jobs (to reduce noise)
        if (statusCounts.running > 0) {
          console.log(`[Status] Iteration ${iterationId}: ${statusCounts.running} running, ${statusCounts.done || 0} done, ${statusCounts.error || 0} error`);
        }
      }

      // Check status of "running" runs with falRequestId from fal.ai
      const runningRuns = runs.filter((run) => run.status === 'running' && run.falRequestId && run.modelEndpoint);
      if (runningRuns.length > 0) {
        const falClient = createFalAIClientFromEnv();
        const FAL_AI_CONCURRENCY_LIMIT = 10;
        
        // Process with concurrency limit (10 concurrent requests max)
        await limitConcurrencySettled(
          runningRuns,
          async (run) => {
            try {
              const modelId = run.modelEndpoint.endpointId;
              const requestId = run.falRequestId!;
              
              // Check status from fal.ai
              const statusResponse = await falClient.getQueueJobStatus(modelId, requestId);
              const falStatus = statusResponse.status;
              
              if (falStatus === 'COMPLETED') {
                // Get result and update DB
                const result = await falClient.getQueueJobResult(modelId, requestId);
                
                if (result.error) {
                  await updateRun(iterationId, run.candidateId, {
                    status: 'error',
                    error: result.error,
                  });
                  console.log(`[Status] Run ${run.candidateId} failed: ${result.error}`);
                } else if (result.output !== undefined) {
                  // Convert fal.ai output to RunOutput
                  const modelSpec = run.modelEndpoint.modelSpecs[0]?.specJson as unknown as ModelSpec | undefined;
                  const output = modelSpec 
                    ? convertFalAIOutputToRunOutput(result.output, modelSpec)
                    : { type: 'text' as const, text: JSON.stringify(result.output) };
                  
                  const latencyMs = Date.now() - run.createdAt.getTime();
                  
                  await updateRun(iterationId, run.candidateId, {
                    status: 'done',
                    outputJson: output,
                    latencyMs,
                  });
                  
                  // Log output details for debugging
                  if (output.type === 'image' && output.images) {
                    console.log(`[Status] Run ${run.candidateId} completed (image, ${output.images.length} image(s), ${latencyMs}ms)`);
                  } else {
                    console.log(`[Status] Run ${run.candidateId} completed (${output.type}, ${latencyMs}ms)`);
                  }
                } else {
                  console.warn(`[Status] Run ${run.candidateId} COMPLETED but no output or error`);
                }
              } else if (falStatus === 'FAILED') {
                const result = await falClient.getQueueJobResult(modelId, requestId);
                const errorMessage = result.error || 'Job failed';
                await updateRun(iterationId, run.candidateId, {
                  status: 'error',
                  error: errorMessage,
                });
                console.log(`[Status] Run ${run.candidateId} failed: ${errorMessage}`);
              }
              // IN_QUEUE and IN_PROGRESS: no logging needed, will be checked again on next poll
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`[Status] Error checking run ${run.candidateId}:`, errorMessage);
              
              // Check if this is a 422 validation error (invalid parameter values)
              // These are permanent errors that should be marked in DB
              if (errorMessage.includes('422') || errorMessage.includes('Unprocessable Entity')) {
                // Extract error details from the message
                let detailedError = errorMessage;
                try {
                  // Try to extract the JSON error detail from the message
                  const jsonMatch = errorMessage.match(/\{.*\}/);
                  if (jsonMatch) {
                    const errorDetail = JSON.parse(jsonMatch[0]);
                    if (errorDetail.detail && Array.isArray(errorDetail.detail)) {
                      const validationErrors = errorDetail.detail
                        .map((d: { msg?: string; loc?: string[] }) => {
                          const param = d.loc?.[d.loc.length - 1] || 'unknown';
                          return `${param}: ${d.msg || 'validation error'}`;
                        })
                        .join('; ');
                      detailedError = `Validation error: ${validationErrors}`;
                    }
                  }
                } catch {
                  // If parsing fails, use the original error message
                }
                
                // Mark as error in DB
                await updateRun(iterationId, run.candidateId, {
                  status: 'error',
                  error: detailedError,
                });
                console.log(`[Status] Run ${run.candidateId} marked as error due to validation failure`);
                return; // Don't re-throw, error is handled
              }
              
              // For other errors, re-throw to be caught by allSettled
              throw error;
            }
          },
          FAL_AI_CONCURRENCY_LIMIT
        );
        
        // Re-fetch runs after updates to get latest status
        runs = await prisma.run.findMany({
          where: { iterationId },
          include: { 
            modelEndpoint: {
              include: {
                modelSpecs: {
                  orderBy: { researchedAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        });
      }
    } catch (dbError) {
      // If Run table doesn't exist or migration not run, return empty runs
      // This can happen if migration hasn't been applied yet
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      console.error('Error fetching runs:', errorMessage);
      
      // If it's a "Run model not available" error, return empty runs gracefully
      if (errorMessage.includes('Run model not available')) {
        return NextResponse.json({
          iterationId,
          runs: [],
          allDone: false,
          hasErrors: false,
        });
      }
      
      // For other errors, re-throw to be handled by handleApiError
      throw dbError;
    }

    // Build a map of queue positions from fal.ai status checks (if available)
    // Note: This would require storing queue position in DB or caching, but for now we'll just pass through
    // Queue position info is logged but not stored in DB - UI can show it if we pass it through
    const statusResponse: StatusResponse = {
      iterationId,
      runs: runs.map((run) => ({
        candidateId: run.candidateId,
        status: run.status as 'queued' | 'running' | 'done' | 'error',
        output: run.outputJson as unknown as RunOutput | undefined,
        latencyMs: run.latencyMs || undefined,
        error: run.error || undefined,
        // Queue position is not stored in DB, so we can't pass it here
        // But we log it in the status check above
      })),
      allDone: runs.every((run) => run.status === 'done' || run.status === 'error'),
      hasErrors: runs.some((run) => run.status === 'error'),
    };
    
    return NextResponse.json(statusResponse);
  } catch (error) {
    return handleApiError(error, '/api/iterations/[id]/status');
  }
}

