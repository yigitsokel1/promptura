import { NextRequest, NextResponse } from 'next/server';
import { findManyModelEndpointsWithSpecs } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';

/**
 * Get all models for admin panel
 * Returns list of ModelEndpoints with their latest specs
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // Optional filter by status

    const whereClause: { source?: string; status?: string } = {
      source: 'fal.ai', // Only fal.ai models for now
    };

    if (status) {
      whereClause.status = status;
    }

    const models = await findManyModelEndpointsWithSpecs(whereClause, {
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ models });
  } catch (error) {
    return handleApiError(error, '/api/admin/models');
  }
}
