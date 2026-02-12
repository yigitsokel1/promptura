import { NextRequest, NextResponse } from 'next/server';
import { findManyModelEndpointsWithSpecs } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import { requireAdmin, unauthorizedResponse } from '@/src/lib/auth';

/**
 * Get all models for admin panel (ADMIN only)
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return unauthorizedResponse();
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // Optional filter by status

    const whereClause: { source?: string | { in: string[] }; status?: string } = {
      source: { in: ['fal.ai', 'eachlabs'] },
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
