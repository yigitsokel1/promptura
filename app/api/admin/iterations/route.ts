import { NextResponse } from 'next/server';
import { findIterationsRecent } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';

/**
 * GET /api/admin/iterations — list recent iterations (Blok E: observability)
 */
export async function GET() {
  try {
    const take = 50;
    const iterations = await findIterationsRecent({ take });
    return NextResponse.json({ iterations });
  } catch (error) {
    return handleApiError(error, '/api/admin/iterations');
  }
}
