import { NextResponse } from 'next/server';
import { findIterationsRecent } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import { requireAdmin, unauthorizedResponse } from '@/src/lib/auth';

/**
 * GET /api/admin/iterations — list recent iterations (ADMIN only)
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return unauthorizedResponse();
  try {
    const take = 50;
    const iterations = await findIterationsRecent({ take });
    return NextResponse.json({ iterations });
  } catch (error) {
    return handleApiError(error, '/api/admin/iterations');
  }
}
