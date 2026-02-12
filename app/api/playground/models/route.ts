import { NextRequest, NextResponse } from 'next/server';
import { findManyModelEndpointsWithSpecs } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';

/**
 * Get models for playground (auth required)
 * Returns models with status='active' or 'pending_research' (fal.ai and EachLabs)
 */
export async function GET(_request: NextRequest) {
  const session = await requireAuth();
  if (!session) return unauthorizedResponse();
  try {
    const models = await findManyModelEndpointsWithSpecs(
      {
        status: {
          in: ['active', 'pending_research'],
        },
        source: { in: ['fal.ai', 'eachlabs'] },
      },
      {
        orderBy: { endpointId: 'asc' },
      }
    );

    // For active models, only include those with specs
    // For pending_research models, include them even without specs (they're being researched)
    const filteredModels = models.filter(
      (model) => model.status === 'pending_research' || model.modelSpecs.length > 0
    );

    return NextResponse.json({ models: filteredModels });
  } catch (error) {
    return handleApiError(error, '/api/playground/models');
  }
}
