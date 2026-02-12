import { NextRequest, NextResponse } from 'next/server';
import type { ModelSpec } from '@/src/core/modelSpec';
import { findModelEndpointWithSpecOnly } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';

/**
 * Get model spec by model endpoint ID (auth required)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!session) return unauthorizedResponse();
  try {
    const { id } = await params;

    const model = await findModelEndpointWithSpecOnly(id);

    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    if (model.modelSpecs.length === 0) {
      return NextResponse.json(
        { error: 'Model spec not found' },
        { status: 404 }
      );
    }

    // Type-safe cast: specJson is stored as Prisma.JsonValue, but we know it's ModelSpec
    const spec = model.modelSpecs[0].specJson as unknown as ModelSpec;

    return NextResponse.json({ spec, modelEndpoint: model });
  } catch (error) {
    return handleApiError(error, '/api/playground/models/[id]/spec');
  }
}
