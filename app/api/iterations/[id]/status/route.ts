import { NextRequest, NextResponse } from 'next/server';
import { updateRun, updateIterationFinishedAt, findIterationById } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import type { RunOutput } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { executionProviderFactory } from '@/src/providers/execution';
import type { ExecutionProviderSlug } from '@/src/providers/execution';
import { prisma } from '@/src/db/client';
import { limitConcurrencySettled } from '@/src/lib/concurrency';
import { requireUserProviderKey, type ProviderSlug } from '@/src/lib/provider-keys';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';

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
    const session = await requireAuth();
    if (!session) return unauthorizedResponse();

    const { id: iterationId } = await params;

    if (!iterationId) {
      return NextResponse.json(
        { error: 'Missing iterationId' },
        { status: 400 }
      );
    }

    // Ensure iteration belongs to current user (userId in request context)
    const iterationRecord = await findIterationById(iterationId);
    if (iterationRecord?.userId && iterationRecord.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

      // Check status of "running" runs (Blok C: use ExecutionProvider from factory)
      const runningRuns = runs.filter((run) => run.status === 'running' && run.falRequestId && run.modelEndpoint);
      if (runningRuns.length > 0) {
        const iterationRecord = await findIterationById(iterationId);
        const userId = iterationRecord?.userId ?? null;
        const providerSlug = (runningRuns[0].modelEndpoint?.provider ?? 'falai') as ExecutionProviderSlug;
        if (!userId) {
          return NextResponse.json(
            { error: 'This iteration cannot be polled (missing user context). Start a new run from the playground.' },
            { status: 400 }
          );
        }
        let apiKey: string;
        try {
          apiKey = await requireUserProviderKey(userId, providerSlug as ProviderSlug);
        } catch (keyError) {
          const msg = keyError instanceof Error ? keyError.message : 'Missing provider API key';
          return NextResponse.json({ error: msg, code: 'MissingProviderKey' }, { status: 400 });
        }
        const executionProvider = executionProviderFactory(providerSlug, apiKey);
        const CONCURRENCY = 10;

        await limitConcurrencySettled(
          runningRuns,
          async (run) => {
            try {
              const endpointId = run.modelEndpoint!.endpointId;
              const requestId = run.falRequestId!;
              const status = await executionProvider.getStatus(endpointId, requestId);

              if (status === 'completed' || status === 'failed') {
                const result = await executionProvider.getResult(endpointId, requestId);
                const modelSpec = run.modelEndpoint!.modelSpecs[0]?.specJson as unknown as ModelSpec | undefined;

                if (result.error || status === 'failed') {
                  await updateRun(iterationId, run.candidateId, {
                    status: 'error',
                    error: result.error ?? 'Job failed',
                  });
                } else if (result.output !== undefined && modelSpec) {
                  const output = executionProvider.convertToRunOutput(result.output, modelSpec);
                  const latencyMs = Date.now() - run.createdAt.getTime();
                  await updateRun(iterationId, run.candidateId, {
                    status: 'done',
                    outputJson: output,
                    latencyMs,
                  });
                } else if (result.output !== undefined) {
                  // No modelSpec: coerce URL string or { url } to image so UI renders it
                  const raw = result.output;
                  const imageOutput: RunOutput =
                    typeof raw === 'string' && raw.trim().startsWith('http')
                      ? { type: 'image', images: [{ url: raw.trim() }] }
                      : typeof raw === 'object' && raw !== null && 'url' in (raw as object)
                        ? { type: 'image', images: [{ url: String((raw as { url: unknown }).url) }] }
                        : { type: 'text', text: JSON.stringify(raw) };
                  await updateRun(iterationId, run.candidateId, {
                    status: 'done',
                    outputJson: imageOutput,
                    latencyMs: Date.now() - run.createdAt.getTime(),
                  });
                }
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`[Status] request id=${run.falRequestId} error checking run ${run.candidateId}:`, errorMessage);
              if (errorMessage.includes('422') || errorMessage.includes('Unprocessable Entity')) {
                let detailedError = errorMessage;
                try {
                  const jsonMatch = errorMessage.match(/\{.*\}/);
                  if (jsonMatch) {
                    const errorDetail = JSON.parse(jsonMatch[0]) as { detail?: Array<{ msg?: string; loc?: string[] }> };
                    if (errorDetail.detail?.length) {
                      detailedError = `Validation error: ${errorDetail.detail
                        .map((d) => `${d.loc?.[d.loc.length - 1] ?? 'unknown'}: ${d.msg ?? 'validation error'}`)
                        .join('; ')}`;
                    }
                  }
                } catch {
                  /* use original */
                }
                await updateRun(iterationId, run.candidateId, { status: 'error', error: detailedError });
                return;
              }
              throw error;
            }
          },
          CONCURRENCY
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
    const allDone = runs.every((run) => run.status === 'done' || run.status === 'error');
    if (allDone) {
      updateIterationFinishedAt(iterationId).catch((err) =>
        console.warn('[Status] Iteration finishedAt update failed:', err)
      );
    }

    const statusResponse: StatusResponse = {
      iterationId,
      runs: runs.map((run) => ({
        candidateId: run.candidateId,
        status: run.status as 'queued' | 'running' | 'done' | 'error',
        output: run.outputJson as unknown as RunOutput | undefined,
        latencyMs: run.latencyMs || undefined,
        error: run.error || undefined,
      })),
      allDone,
      hasErrors: runs.some((run) => run.status === 'error'),
    };

    return NextResponse.json(statusResponse);
  } catch (error) {
    return handleApiError(error, '/api/iterations/[id]/status');
  }
}

