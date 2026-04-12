import { NextRequest, NextResponse } from 'next/server';
import {
  updateRun,
  updateIterationFinishedAt,
  findIterationByIdLight,
} from '@/src/db/queries';
import { prisma } from '@/src/db/client';
import { handleApiError } from '@/src/lib/api-helpers';
import type { OutputAsset, TaskSpec } from '@/src/core/types';
import { normalizeStoredOutputToAssets } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { executionProviderFactory } from '@/src/providers/execution';
import type { ExecutionProviderSlug } from '@/src/providers/execution';
import { limitConcurrencySettled } from '@/src/lib/concurrency';
import { requireUserProviderKey, type ProviderSlug } from '@/src/lib/provider-keys';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';

/** Iteration IDs that already hit P6009 (response >5MB); skip heavy fetch on subsequent polls to avoid log spam. */
const iterationIdsOverSizeLimit = new Set<string>();

/** Stale timeout for runs that were submitted (have falRequestId) but never completed. */
const STALE_RUNNING_MS = 5 * 60 * 1000;
/** Stale timeout for runs stuck in queued (no falRequestId — submission never happened). */
const STALE_QUEUED_MS = 3 * 60 * 1000;

/** Track consecutive transient poll errors per run ID. After threshold, mark as permanent error. */
const transientErrorCounts = new Map<string, number>();
const MAX_TRANSIENT_RETRIES = 5;

/** User-visible hint when fal returns 403 / Forbidden during status poll. */
function formatFalPollErrorMessage(message: string): string {
  const m = message.trim();
  if (m === 'Forbidden' || m.includes('403') || m.toLowerCase().includes('forbidden')) {
    return `${m} — Check your fal.ai API key in Settings (Model API access). Status polling must use the same key as submit.`;
  }
  return m;
}

/**
 * True when the error should mark the run failed (not retried next poll).
 * limitConcurrencySettled swallows thrown errors — never rethrow from the poll worker.
 */
function isPermanentProviderPollError(message: string): boolean {
  if (/422|Unprocessable Entity/i.test(message)) return true;
  if (/429|Too Many Requests|rate limit/i.test(message)) return false;
  if (/403|401|404|Forbidden|Not Found|not found|invalid request|Invalid request id|Fal\.ai API error: 4\d\d/i.test(message))
    return true;
  if (/GraphQL|ECONNREFUSED|ETIMEDOUT|fetch failed|network|socket/i.test(message)) return false;
  if (/5\d\d/.test(message)) return false;
  return false;
}

interface StatusResponse {
  iterationId: string;
  status: 'generating' | 'pending' | 'error';
  task?: TaskSpec;
  candidates?: Array<{ id: string; prompt: string }>;
  error?: string;
  runs: Array<{
    candidateId: string;
    status: 'queued' | 'running' | 'done' | 'error';
    assets?: OutputAsset[];
    latencyMs?: number;
    error?: string;
    queuePosition?: number;
  }>;
  allDone: boolean;
  hasErrors: boolean;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: iterationId } = await params;
  if (!iterationId) {
    return NextResponse.json(
      { error: 'Missing iterationId' },
      { status: 400 }
    );
  }

  try {
    const session = await requireAuth();
    if (!session) return unauthorizedResponse();

    // Ensure iteration belongs to current user (use light query to avoid P6009 on large taskJson)
    const iterationRecord = await findIterationByIdLight(iterationId);
    if (iterationRecord?.userId && iterationRecord.userId !== session.user.id) {
      return NextResponse.json(
        {
          error:
            'This iteration belongs to another account. Sign in as the user who started the run, or start a new generation.',
          code: 'IterationForbidden',
        },
        { status: 403 }
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

      const nowMs = Date.now();
      const staleQueued = runs.filter(
        (r) => r.status === 'queued' && !r.falRequestId && nowMs - r.createdAt.getTime() > STALE_QUEUED_MS
      );
      for (const r of staleQueued) {
        await updateRun(iterationId, r.candidateId, {
          status: 'error',
          error:
            'Never reached the provider (stuck in queued). Background submit may not have run, failed before queue, or timed out. Check server logs, provider keys, and try generating again.',
        });
      }
      if (staleQueued.length > 0) {
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

      // Check status of "running" runs (Blok C: use ExecutionProvider from factory)
      const runningRuns = runs.filter((run) => run.status === 'running' && run.falRequestId && run.modelEndpoint);
      if (runningRuns.length > 0) {
        const iterationRecord = await findIterationByIdLight(iterationId);
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
              const runningAgeMs = Date.now() - run.createdAt.getTime();
              if (runningAgeMs > STALE_RUNNING_MS) {
                await updateRun(iterationId, run.candidateId, {
                  status: 'error',
                  error: `Timed out waiting for provider (${Math.round(STALE_RUNNING_MS / 60000)} min). Check your provider dashboard or try again.`,
                });
                return;
              }
              const status = await executionProvider.getStatus(endpointId, requestId);

              // Reset transient error counter on successful poll
              transientErrorCounts.delete(run.id);

              if (status === 'completed' || status === 'failed') {
                const result = await executionProvider.getResult(endpointId, requestId);
                const modelSpec = run.modelEndpoint!.modelSpecs[0]?.specJson as unknown as ModelSpec | undefined;

                if (result.error || status === 'failed') {
                  await updateRun(iterationId, run.candidateId, {
                    status: 'error',
                    error: result.error ?? 'Job failed',
                  });
                } else if (result.output !== undefined && modelSpec) {
                  const assets = executionProvider.convertToOutputAssets(result.output, modelSpec);
                  const latencyMs = Date.now() - run.createdAt.getTime();
                  await updateRun(iterationId, run.candidateId, {
                    status: 'done',
                    outputJson: { assets },
                    latencyMs,
                  });
                } else if (result.output !== undefined) {
                  const raw = result.output;
                  const assets: OutputAsset[] =
                    typeof raw === 'string' && raw.trim().startsWith('http')
                      ? [{ type: 'image', url: raw.trim() }]
                      : typeof raw === 'object' && raw !== null && 'url' in (raw as object)
                        ? [{ type: 'image', url: String((raw as { url: unknown }).url) }]
                        : [{ type: 'text', content: JSON.stringify(raw) }];
                  await updateRun(iterationId, run.candidateId, {
                    status: 'done',
                    outputJson: { assets },
                    latencyMs: Date.now() - run.createdAt.getTime(),
                  });
                } else {
                  await updateRun(iterationId, run.candidateId, {
                    status: 'error',
                    error:
                      'Job reported completed but no output was returned. If this persists, check the model on fal.ai or try a smaller input image (upload uses fal file storage).',
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
              if (isPermanentProviderPollError(errorMessage)) {
                await updateRun(iterationId, run.candidateId, {
                  status: 'error',
                  error: formatFalPollErrorMessage(errorMessage),
                });
                return;
              }
              // Transient error: track count, escalate after threshold
              const count = (transientErrorCounts.get(run.id) ?? 0) + 1;
              transientErrorCounts.set(run.id, count);
              console.warn(`[Status] Transient error for run ${run.id} (${count}/${MAX_TRANSIENT_RETRIES}): ${errorMessage}`);
              if (count >= MAX_TRANSIENT_RETRIES) {
                transientErrorCounts.delete(run.id);
                await updateRun(iterationId, run.candidateId, {
                  status: 'error',
                  error: `Provider status check failed after ${count} attempts: ${formatFalPollErrorMessage(errorMessage)}. The job may still be running on the provider — check your dashboard.`,
                });
              }
              return;
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

    let iterationRow: { taskJson?: unknown; candidatesJson?: unknown[]; errorMessage?: string } | null = null;
    let responseError: string | undefined;
    const isP6009 = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes('P6009') || msg.includes('response size') || msg.includes('exceeded the the maximum of 5MB');
    };

    if (iterationIdsOverSizeLimit.has(iterationId)) {
      const light = await findIterationByIdLight(iterationId);
      iterationRow = light ? { errorMessage: light.errorMessage ?? undefined } : null;
      responseError =
        'Iteration data too large (Prisma 5MB limit). Use smaller task assets (e.g. URLs instead of base64) or increase the limit in Prisma Console.';
    } else {
      try {
        const row = await prisma.iteration.findUnique({
          where: { id: iterationId },
          select: { taskJson: true, candidatesJson: true, errorMessage: true },
        });
        iterationRow = row
          ? {
              taskJson: row.taskJson,
              candidatesJson: Array.isArray(row.candidatesJson) ? row.candidatesJson : undefined,
              errorMessage: row.errorMessage ?? undefined,
            }
          : null;
      } catch (err) {
        if (isP6009(err)) {
          iterationIdsOverSizeLimit.add(iterationId);
          const light = await findIterationByIdLight(iterationId);
          iterationRow = light ? { errorMessage: light.errorMessage ?? undefined } : null;
          responseError =
            'Iteration data too large (Prisma 5MB limit). Use smaller task assets (e.g. URLs instead of base64) or increase the limit in Prisma Console.';
        } else {
          throw err;
        }
      }
    }

    const it = iterationRow;
    const statusResponse: StatusResponse = {
      iterationId,
      status: it?.errorMessage ? 'error' : it?.candidatesJson?.length ? 'pending' : 'generating',
      error: responseError ?? it?.errorMessage,
      task: it?.taskJson as StatusResponse['task'],
      candidates: Array.isArray(it?.candidatesJson)
        ? (it.candidatesJson as Array<{ id: string; prompt: string }>)
        : undefined,
      runs: runs.map((run) => ({
        candidateId: run.candidateId,
        status: run.status as 'queued' | 'running' | 'done' | 'error',
        assets: normalizeStoredOutputToAssets(run.outputJson),
        latencyMs: run.latencyMs || undefined,
        error: run.error || undefined,
      })),
      allDone,
      hasErrors: runs.some((run) => run.status === 'error'),
    };

    return NextResponse.json(statusResponse);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const isP6009Err =
      errMsg.includes('P6009') || errMsg.includes('response size') || errMsg.includes('exceeded the the maximum of 5MB');
    if (isP6009Err) {
      try {
        const light = await findIterationByIdLight(iterationId);
        const runsLight = await prisma.run.findMany({
          where: { iterationId },
          select: { candidateId: true, status: true, error: true, latencyMs: true },
          orderBy: { createdAt: 'asc' as const },
        });
        const allDone = runsLight.every((r) => r.status === 'done' || r.status === 'error');
        return NextResponse.json({
          iterationId,
          status: light?.errorMessage ? 'error' : 'pending',
          error:
            'Response too large (Prisma 5MB limit). Run statuses below; use smaller task assets or increase limit in Prisma Console.',
          runs: runsLight.map((r) => ({
            candidateId: r.candidateId,
            status: r.status as 'queued' | 'running' | 'done' | 'error',
            latencyMs: r.latencyMs ?? undefined,
            error: r.error ?? undefined,
          })),
          allDone,
          hasErrors: runsLight.some((r) => r.status === 'error'),
        } as StatusResponse);
      } catch (fallbackErr) {
        return handleApiError(fallbackErr, '/api/iterations/[id]/status');
      }
    }
    return handleApiError(error, '/api/iterations/[id]/status');
  }
}

