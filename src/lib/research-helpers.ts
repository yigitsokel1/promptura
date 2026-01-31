/**
 * Shared research job error handling
 * Reduces code duplication in research-related routes
 */

import { prisma } from '@/src/db/client';

/**
 * Update research job status to error
 * Used in both /api/research/process and /api/admin/models/[id]/refresh
 */
export async function updateResearchJobError(
  researchJobId: string,
  error: unknown
): Promise<void> {
  const errorMessage =
    error instanceof Error ? error.message : 'Unknown error';
  
  await prisma.researchJob.update({
    where: { id: researchJobId },
    data: {
      status: 'error',
      error: errorMessage,
      finishedAt: new Date(),
    },
  });
}
