import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/client';
import { runResearchJob, startResearchQueueTicker } from '@/src/lib/research-helpers';
import { handleApiError } from '@/src/lib/api-helpers';
import { requireAdmin, unauthorizedResponse } from '@/src/lib/auth';

interface ProcessRequest {
  researchJobId?: string;
}

/**
 * POST: Process a research job (admin only). Used for manual/cron trigger.
 * Internal trigger from validate uses runResearchJob() directly (no HTTP).
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return unauthorizedResponse();
  try {
    const body: ProcessRequest = await request.json().catch(() => ({}));
    const { researchJobId } = body;

    let jobId: string | null = null;
    if (researchJobId) {
      const job = await prisma.researchJob.findUnique({
        where: { id: researchJobId },
        select: { id: true, status: true },
      });
      if (!job) {
        return NextResponse.json({ error: 'No research job found' }, { status: 404 });
      }
      if (job.status !== 'queued' && job.status !== 'running') {
        return NextResponse.json(
          { error: `Research job cannot be processed (status: ${job.status})`, currentStatus: job.status },
          { status: 400 }
        );
      }
      jobId = job.id;
    } else {
      const now = new Date();
      const next = await prisma.researchJob.findFirst({
        where: {
          status: 'queued',
          OR: [{ runAt: null }, { runAt: { lte: now } }],
        },
        orderBy: [{ runAt: 'asc' }, { startedAt: 'asc' }],
        select: { id: true },
      });
      if (!next) {
        return NextResponse.json({ error: 'No research job found' }, { status: 404 });
      }
      jobId = next.id;
    }

    startResearchQueueTicker();
    await runResearchJob(jobId);

    return NextResponse.json({
      success: true,
      researchJobId: jobId,
      message: 'Research completed successfully',
    });
  } catch (error) {
    return handleApiError(error, '/api/research/process');
  }
}
