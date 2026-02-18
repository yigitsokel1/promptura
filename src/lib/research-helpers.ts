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
import type { Modality } from '@/src/core/types';
import type { ModelSpec, RequiredAssets } from '@/src/core/modelSpec';
import { determineModalityFromCategory } from '@/src/providers/falai/helpers';

const MAX_CONCURRENT_RESEARCH = 2;
let activeResearchCount = 0;
const researchQueue: string[] = [];

/**
 * Derive modality + required_assets from endpoint metadata (Sprint 7: no schema parsing).
 * required_assets is always 'none' — deterministic, no param/schema extraction.
 */
function deriveModalityAndAssets(
  dbModality: string | null | undefined,
  category: string | undefined
): { modality: Modality; required_assets: RequiredAssets } {
  const raw = determineModalityFromCategory(category) ?? dbModality?.toLowerCase() ?? 'text';
  if (raw === 'image') {
    return { modality: 'text-to-image', required_assets: 'none' };
  }
  if (raw === 'video') {
    return { modality: 'text-to-video', required_assets: 'none' };
  }
  return { modality: 'text-to-text', required_assets: 'none' };
}

function processNextQueuedJob(): void {
  if (activeResearchCount >= MAX_CONCURRENT_RESEARCH || researchQueue.length === 0) return;
  const jobId = researchQueue.shift();
  if (jobId) {
    runResearchJob(jobId).catch((err) => {
      console.error(`Research job ${jobId} failed:`, err);
    });
  }
}

/**
 * Update research job status to error and set ModelEndpoint to research_failed
 */
export async function updateResearchJobError(
  researchJobId: string,
  error: unknown
): Promise<void> {
  const errorMessage =
    error instanceof Error ? error.message : 'Unknown error';

  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: { modelEndpointId: true },
  });

  await prisma.researchJob.update({
    where: { id: researchJobId },
    data: {
      status: 'error',
      error: errorMessage,
      finishedAt: new Date(),
    },
  });

  if (job?.modelEndpointId) {
    await prisma.modelEndpoint.update({
      where: { id: job.modelEndpointId },
      data: { status: 'research_failed' },
    });
  }
}

/**
 * Run a single research job by ID (fetch metadata, Gemini research, save spec, set active).
 * Global concurrency limit: max 2 running. Excess jobs are queued.
 */
export async function runResearchJob(researchJobId: string): Promise<void> {
  if (activeResearchCount >= MAX_CONCURRENT_RESEARCH) {
    researchQueue.push(researchJobId);
    return;
  }

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

  activeResearchCount++;

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
    let eachLabsDetail: Awaited<ReturnType<typeof findEachLabsModel>> = null;

    if (modelEndpoint.source === 'eachlabs') {
      const detail = await findEachLabsModel(modelEndpoint.endpointId);
      if (!detail) {
        throw new Error(`Model not found in EachLabs: ${modelEndpoint.endpointId}`);
      }
      eachLabsDetail = detail;
      modelMetadata = eachLabsDetailToFalMetadata(detail);
    } else {
      const falClient = createFalAIClientFromEnv();
      const falMetadata = await falClient.findModel(modelEndpoint.endpointId);
      if (!falMetadata) {
        throw new Error(`Model not found in fal.ai: ${modelEndpoint.endpointId}`);
      }
      modelMetadata = falMetadata;
    }

    // 1) Modality + required_assets: derived from metadata only (Sprint 7: no schema converters).
    const derived = deriveModalityAndAssets(modelEndpoint.modality, modelMetadata.metadata?.category);
    const modality = derived.modality;
    const required_assets = derived.required_assets;

    // 2) Gemini produces only prompt guidelines + summary (never modality/required_assets/params)
    const modalityForPrompt = typeof modality === 'string' ? modality : 'text-to-image';
    const guidelines = await researchModelWithGemini(
      modelMetadata as FalAIModelMetadata,
      modelEndpoint.kind as 'model' | 'workflow',
      modalityForPrompt
    );

    const modelSpec: ModelSpec = {
      modality,
      required_assets,
      prompt_guidelines: guidelines.prompt_guidelines,
      summary: guidelines.summary,
    };

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
  } finally {
    activeResearchCount--;
    processNextQueuedJob();
  }
}
