/**
 * Shared research job handling: run job and error updates.
 * Used by /api/research/process (HTTP, with admin) and validate (internal, no HTTP).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/src/db/client';
import { researchModelWithGemini } from '@/src/providers/gemini/helpers';
import { createFalAIClientFromEnv } from '@/src/providers/falai/helpers';
import type { FalAIModelMetadata } from '@/src/providers/falai/types';
import {
  findEachLabsModel,
  eachLabsDetailToFalMetadata,
} from '@/src/providers/eachlabs/helpers';

/**
 * Update research job status to error
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

/**
 * Run a single research job by ID (fetch metadata, Gemini research, save spec, set active).
 * Call this from validate route in background, or from /api/research/process with admin.
 */
export async function runResearchJob(researchJobId: string): Promise<void> {
  const researchJob = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: { modelEndpoint: true },
  });

  if (!researchJob) {
    throw new Error(`No research job found: ${researchJobId}`);
  }
  if (researchJob.status !== 'queued' && researchJob.status !== 'running') {
    return; // already done or error
  }

  const modelEndpoint = researchJob.modelEndpoint;

  await prisma.researchJob.update({
    where: { id: researchJob.id },
    data: { status: 'running', startedAt: new Date() },
  });

  try {
    let modelMetadata: {
      endpoint_id: string;
      metadata: {
        display_name?: string;
        category?: string;
        description?: string;
        status?: string;
        tags?: string[];
      };
    };
    if (modelEndpoint.source === 'eachlabs') {
      const detail = await findEachLabsModel(modelEndpoint.endpointId);
      if (!detail) {
        throw new Error(`Model not found in EachLabs: ${modelEndpoint.endpointId}`);
      }
      modelMetadata = eachLabsDetailToFalMetadata(detail);
    } else {
      const falClient = createFalAIClientFromEnv();
      const falMetadata = await falClient.findModel(modelEndpoint.endpointId);
      if (!falMetadata) {
        throw new Error(`Model not found in fal.ai: ${modelEndpoint.endpointId}`);
      }
      modelMetadata = falMetadata;
    }

    const modelSpec = await researchModelWithGemini(
      modelMetadata as FalAIModelMetadata,
      modelEndpoint.kind as 'model' | 'workflow',
      modelEndpoint.modality
    );

    const specJson: Prisma.InputJsonValue = JSON.parse(JSON.stringify(modelSpec));
    await prisma.modelSpec.create({
      data: {
        modelEndpointId: modelEndpoint.id,
        specJson,
        schemaVersion: '1.0.0',
        researchedBy: 'gemini',
      },
    });

    await prisma.modelEndpoint.update({
      where: { id: modelEndpoint.id },
      data: { status: 'active', lastCheckedAt: new Date() },
    });

    await prisma.researchJob.update({
      where: { id: researchJob.id },
      data: { status: 'done', finishedAt: new Date() },
    });
  } catch (error) {
    await updateResearchJobError(researchJob.id, error);
    throw error;
  }
}
