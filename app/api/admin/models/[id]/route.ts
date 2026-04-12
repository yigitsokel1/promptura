import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/client';
import { findModelEndpointWithSpec } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import { requireAdmin, unauthorizedResponse } from '@/src/lib/auth';

/**
 * Get model details by ID (ADMIN only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return unauthorizedResponse();
  try {
    const { id } = await params;

    // Get model with latest spec and last 5 jobs (for admin detail page)
    const model = await findModelEndpointWithSpec(id, { includeMoreJobs: 5 });

    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    return NextResponse.json({ model });
  } catch (error) {
    return handleApiError(error, '/api/admin/models/[id]');
  }
}

/**
 * Update model status (ADMIN only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return unauthorizedResponse();
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !['active', 'disabled', 'pending_research', 'research_failed'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be: active, disabled, pending_research, or research_failed' },
        { status: 400 }
      );
    }

    const model = await prisma.modelEndpoint.update({
      where: { id },
      data: { status },
    });

    return NextResponse.json({ model });
  } catch (error) {
    return handleApiError(error, '/api/admin/models/[id] (PATCH)');
  }
}

/**
 * Delete model endpoint (ADMIN only). Cascades specs, research jobs, and runs.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return unauthorizedResponse();
  try {
    const { id } = await params;
    await prisma.modelEndpoint.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }
    return handleApiError(error, '/api/admin/models/[id] (DELETE)');
  }
}
