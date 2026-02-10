/**
 * Common Prisma query patterns
 * Reduces code duplication across API routes
 */

import { Prisma } from '@prisma/client';
import { prisma } from './client';
import type { ModelEndpointWithRelations, Run } from './types';
import type { RunOutput } from '@/src/core/types';

/**
 * Common include pattern for ModelEndpoint with latest spec and jobs
 */
const modelEndpointInclude = {
  modelSpecs: {
    orderBy: { researchedAt: 'desc' as const },
    take: 1,
  },
  researchJobs: {
    orderBy: { startedAt: 'desc' as const },
    take: 1,
  },
} as const;

/**
 * Find ModelEndpoint with latest spec and job
 * For admin detail pages that need more job history, fetch jobs separately
 */
export async function findModelEndpointWithSpec(
  modelId: string,
  options?: { includeMoreJobs?: number }
): Promise<ModelEndpointWithRelations | null> {
  const include = options?.includeMoreJobs
    ? {
        modelSpecs: {
          orderBy: { researchedAt: 'desc' as const },
          take: 1,
        },
        researchJobs: {
          orderBy: { startedAt: 'desc' as const },
          take: options.includeMoreJobs,
        },
      }
    : modelEndpointInclude;

  const model = await prisma.modelEndpoint.findUnique({
    where: { id: modelId },
    include,
  });

  return model as ModelEndpointWithRelations | null;
}

/**
 * Find ModelEndpoint with latest spec only (for spec routes)
 */
export async function findModelEndpointWithSpecOnly(
  modelId: string
): Promise<ModelEndpointWithRelations | null> {
  const model = await prisma.modelEndpoint.findUnique({
    where: { id: modelId },
    include: {
      modelSpecs: {
        orderBy: { researchedAt: 'desc' as const },
        take: 1,
      },
    },
  });

  return model as ModelEndpointWithRelations | null;
}

/**
 * Find many ModelEndpoints with latest specs and jobs
 */
export async function findManyModelEndpointsWithSpecs(
  where: {
    source?: string;
    status?: string | { in: string[] };
  },
  options?: {
    orderBy?: { createdAt?: 'desc' | 'asc'; endpointId?: 'desc' | 'asc' };
    take?: number;
  }
): Promise<ModelEndpointWithRelations[]> {
  const models = await prisma.modelEndpoint.findMany({
    where,
    include: modelEndpointInclude,
    orderBy: options?.orderBy || { createdAt: 'desc' },
    take: options?.take,
  });

  return models as ModelEndpointWithRelations[];
}

/**
 * Create a new Run record
 */
export async function createRun(data: {
  iterationId: string;
  modelEndpointId: string;
  candidateId: string;
  falRequestId?: string;
  status?: 'queued' | 'running' | 'done' | 'error';
}): Promise<Run> {
  return prisma.run.create({
    data: {
      iterationId: data.iterationId,
      modelEndpointId: data.modelEndpointId,
      candidateId: data.candidateId,
      falRequestId: data.falRequestId,
      status: data.status || 'queued',
    },
  });
}

/**
 * Update a Run record
 */
export async function updateRun(
  iterationId: string,
  candidateId: string,
  data: {
    status?: 'queued' | 'running' | 'done' | 'error';
    falRequestId?: string;
    outputJson?: RunOutput;
    latencyMs?: number;
    error?: string;
    finishedAt?: Date;
  }
): Promise<Run> {
  const { outputJson, ...rest } = data;
  return prisma.run.update({
    where: {
      iterationId_candidateId: {
        iterationId,
        candidateId,
      },
    },
    data: {
      ...rest,
      outputJson: outputJson !== undefined ? (outputJson as unknown as Prisma.InputJsonValue) : undefined,
      finishedAt: data.finishedAt || (data.status === 'done' || data.status === 'error' ? new Date() : undefined),
    },
  });
}

/**
 * Find runs by iteration ID
 */
export async function findRunsByIterationId(iterationId: string): Promise<Run[]> {
  // Check if Run model exists in Prisma client
  if (!prisma.run) {
    throw new Error('Run model not available in Prisma client. Please run: npx prisma generate && npx prisma migrate deploy');
  }
  
  return prisma.run.findMany({
    where: { iterationId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Find run by iteration ID and candidate ID
 */
export async function findRunByIterationAndCandidate(
  iterationId: string,
  candidateId: string
): Promise<Run | null> {
  return prisma.run.findUnique({
    where: {
      iterationId_candidateId: {
        iterationId,
        candidateId,
      },
    },
  });
}

/**
 * Find runs by model endpoint ID
 */
export async function findRunsByModelEndpointId(
  modelEndpointId: string,
  options?: {
    orderBy?: { createdAt?: 'desc' | 'asc' };
    take?: number;
  }
): Promise<Run[]> {
  return prisma.run.findMany({
    where: { modelEndpointId },
    orderBy: options?.orderBy || { createdAt: 'desc' },
    take: options?.take,
  });
}
