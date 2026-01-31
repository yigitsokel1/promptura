import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/client';
import { findModelEndpointWithSpec } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';

/**
 * Get model details by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
 * Update model status
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !['active', 'disabled', 'pending_research'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be: active, disabled, or pending_research' },
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
