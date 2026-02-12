import { NextRequest, NextResponse } from 'next/server';
import { findIterationById, findRunsByIterationId } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';

/**
 * GET /api/admin/iterations/[id] — iteration detail with run status list (Blok E: observability)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: iterationId } = await params;
    if (!iterationId) {
      return NextResponse.json({ error: 'Missing iteration id' }, { status: 400 });
    }

    const [iteration, runs] = await Promise.all([
      findIterationById(iterationId),
      findRunsByIterationId(iterationId),
    ]);

    if (!iteration) {
      return NextResponse.json({ error: 'Iteration not found' }, { status: 404 });
    }

    return NextResponse.json({
      iteration: {
        id: iteration.id,
        modelEndpointId: iteration.modelEndpointId,
        startedAt: iteration.startedAt,
        finishedAt: iteration.finishedAt,
      },
      runs: runs.map((run) => ({
        id: run.id,
        candidateId: run.candidateId,
        status: run.status,
        latencyMs: run.latencyMs,
        error: run.error,
        falRequestId: run.falRequestId,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
      })),
    });
  } catch (error) {
    return handleApiError(error, '/api/admin/iterations/[id]');
  }
}
