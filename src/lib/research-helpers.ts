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
  eachLabsModality,
  eachLabsRequiredInputDefaults,
  eachLabsAspectRatioOptions,
  eachLabsAspectRatioDefault,
} from '@/src/providers/eachlabs/helpers';
import type { EachLabsModelDetail } from '@/src/providers/eachlabs/types';
import type { Modality } from '@/src/core/types';
import type { ModelSpec, RequiredAssets } from '@/src/core/modelSpec';
import {
  determineModalityFromCategory,
  getFalOpenApiInputPropertyKeys,
  getFalRequiredInputDefaults,
  getFalAspectRatioConfig,
} from '@/src/providers/falai/helpers';
import { combineOutputAndAssetsToModality } from '@/src/lib/modality-inference';
import { analyzeSchemaForAssets } from '@/src/lib/schema-asset-analyzer';
import { isDeferredVideoModality } from '@/src/lib/video-rollout';

const MAX_CONCURRENT_RESEARCH = 2;
const MAX_RETRIES = 3;
const STALE_RUNNING_MS = 10 * 60 * 1000; // 10 min → consider running job stale
let activeResearchCount = 0;

/** Backoff delay in ms for attempt (0-indexed): 2^attempt * 2s, cap 60s */
function backoffMs(attempt: number): number {
  return Math.min(60_000, Math.pow(2, attempt) * 2000);
}

export interface ModalityDerivationDebug {
  outputFrom: 'category' | 'output_type';
  categoryOrOutputType?: string;
  schemaPropertyKeys?: string[];
  schemaRequired?: string[];
  detectedInputFields: string[];
  requiredAssets: RequiredAssets;
  modality: Modality;
}

/**
 * Derive modality + required_assets + detected_input_fields via schema-asset-analyzer.
 * Returns debug info for admin "why did modality come out like this?".
 */
export async function deriveModalityAndAssets(params: {
  source: 'eachlabs' | 'fal.ai';
  dbModality: string | null | undefined;
  category: string | undefined;
  eachLabsDetail?: EachLabsModelDetail | null;
  endpointId?: string;
}): Promise<{
  modality: Modality;
  required_assets: RequiredAssets;
  detected_input_fields: string[];
  modalityDebug: ModalityDerivationDebug;
}> {
  const { source, dbModality, category, eachLabsDetail, endpointId } = params;

  const outputFrom: 'category' | 'output_type' = source === 'eachlabs' ? 'output_type' : 'category';
  const categoryOrOutputType =
    source === 'eachlabs' && eachLabsDetail
      ? eachLabsDetail.output_type
      : category;

  const output: 'text' | 'image' | 'video' =
    source === 'eachlabs' && eachLabsDetail
      ? eachLabsModality(eachLabsDetail)
      : (determineModalityFromCategory(category) ?? dbModality?.toLowerCase() ?? 'text') as 'text' | 'image' | 'video';

  let required_assets: RequiredAssets;
  let detected_input_fields: string[] = [];
  let schemaPropertyKeys: string[] | undefined;
  let schemaRequired: string[] | undefined;

  if (source === 'eachlabs' && eachLabsDetail) {
    const schema = eachLabsDetail.request_schema;
    const propertyKeys = schema?.properties && typeof schema.properties === 'object'
      ? Object.keys(schema.properties)
      : [];
    const required = Array.isArray(schema?.required) && schema.required.length > 0 ? schema.required : undefined;
    schemaPropertyKeys = propertyKeys;
    schemaRequired = required;
    const result = analyzeSchemaForAssets({ propertyKeys, required });
    required_assets = result.required_assets;
    detected_input_fields = result.detected_input_fields;
  } else if (source === 'fal.ai' && endpointId) {
    try {
      const { keys, required } = await getFalOpenApiInputPropertyKeys(endpointId);
      schemaPropertyKeys = keys;
      schemaRequired = required ?? undefined;
      const result = analyzeSchemaForAssets({
        propertyKeys: keys,
        required: required ?? undefined,
      });
      required_assets = result.required_assets;
      detected_input_fields = result.detected_input_fields;
    } catch {
      required_assets = 'none';
    }
  } else {
    required_assets = 'none';
  }

  const modality = combineOutputAndAssetsToModality(output, required_assets);
  const modalityDebug: ModalityDerivationDebug = {
    outputFrom,
    categoryOrOutputType: categoryOrOutputType ?? undefined,
    schemaPropertyKeys,
    schemaRequired,
    detectedInputFields: detected_input_fields,
    requiredAssets: required_assets,
    modality,
  };
  return { modality, required_assets, detected_input_fields, modalityDebug };
}

/**
 * Pick next queued job from DB (status=queued, runAt <= now or null) and run it.
 * DB-based queue: no in-memory list; survives process restart.
 */
export async function processNextQueuedJob(): Promise<void> {
  if (activeResearchCount >= MAX_CONCURRENT_RESEARCH) return;

  const now = new Date();
  const next = await prisma.researchJob.findFirst({
    where: {
      status: 'queued',
      OR: [
        { runAt: null },
        { runAt: { lte: now } },
      ],
    },
    orderBy: [{ runAt: 'asc' }, { startedAt: 'asc' }],
    select: { id: true },
  });

  if (next) {
    runResearchJob(next.id).catch((err) => {
      console.error(`Research job ${next.id} failed:`, err);
    });
  }
}

/**
 * Update research job on error: retry with backoff up to MAX_RETRIES, else mark error and research_failed.
 */
export async function updateResearchJobError(
  researchJobId: string,
  error: unknown
): Promise<void> {
  const errorMessage =
    error instanceof Error ? error.message : 'Unknown error';

  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: { modelEndpointId: true, retryCount: true },
  });

  if (!job) return;

  const retryCount = (job.retryCount ?? 0) + 1;
  const willRetry = retryCount < MAX_RETRIES;

  await prisma.researchJob.update({
    where: { id: researchJobId },
    data: {
      status: willRetry ? 'queued' : 'error',
      error: errorMessage,
      finishedAt: willRetry ? null : new Date(),
      startedAt: null,
      retryCount,
      runAt: willRetry ? new Date(Date.now() + backoffMs(retryCount - 1)) : null,
    },
  });

  if (!willRetry && job.modelEndpointId) {
    await prisma.modelEndpoint.update({
      where: { id: job.modelEndpointId },
      data: { status: 'research_failed' },
    });
  } else if (willRetry) {
    processNextQueuedJob();
  }
}

/**
 * Run a single research job by ID. Idempotent: re-fetch state; skip if done/error; reset stale running.
 * Concurrency: if at capacity, return (job stays queued in DB for processNextQueuedJob).
 */
export async function runResearchJob(researchJobId: string): Promise<void> {
  if (activeResearchCount >= MAX_CONCURRENT_RESEARCH) {
    return; // job stays queued in DB
  }

  const researchJob = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: { modelEndpoint: true },
  });

  if (!researchJob) {
    throw new Error(`No research job found: ${researchJobId}`);
  }
  if (researchJob.status === 'done' || researchJob.status === 'error') {
    return;
  }
  if (researchJob.status === 'running') {
    const startedAt = researchJob.startedAt?.getTime() ?? 0;
    if (Date.now() - startedAt < STALE_RUNNING_MS) {
      return; // still running, not stale
    }
    await prisma.researchJob.update({
      where: { id: researchJob.id },
      data: { status: 'queued', startedAt: null },
    });
  }

  activeResearchCount++;

  const modelEndpoint = researchJob.modelEndpoint;

  await prisma.researchJob.update({
    where: { id: researchJob.id },
    data: { status: 'running', startedAt: new Date(), error: null },
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

    // 1) Modality + required_assets: schema-asset-analyzer (eachlabs + fal same engine).
    const derived = await deriveModalityAndAssets({
      source: modelEndpoint.source as 'eachlabs' | 'fal.ai',
      dbModality: modelEndpoint.modality,
      category: modelMetadata.metadata?.category,
      eachLabsDetail: eachLabsDetail ?? undefined,
      endpointId: modelEndpoint.endpointId,
    });
    const modality = derived.modality;
    const required_assets = derived.required_assets;
    const detected_input_fields = derived.detected_input_fields;
    const modalityDebug = derived.modalityDebug;
    if (detected_input_fields.length > 0) {
      console.debug(`[research] ${modelEndpoint.endpointId} detected_input_fields:`, detected_input_fields);
    }

    // 2) Gemini produces only prompt guidelines + summary (never modality/required_assets/params)
    const modalityForPrompt = typeof modality === 'string' ? modality : 'text-to-image';
    const guidelines = await researchModelWithGemini(
      modelMetadata as FalAIModelMetadata,
      modelEndpoint.kind as 'model' | 'workflow',
      modalityForPrompt
    );

    const required_input_defaults = eachLabsDetail
      ? eachLabsRequiredInputDefaults(eachLabsDetail)
      : modelEndpoint.source === 'fal.ai'
        ? await getFalRequiredInputDefaults(modelEndpoint.endpointId)
        : undefined;
    const falAspectConfig = modelEndpoint.source === 'fal.ai'
      ? (await getFalAspectRatioConfig(modelEndpoint.endpointId)) ?? { options: [], default: undefined }
      : { options: [], default: undefined as string | undefined };
    const aspectRatioOptionsRaw = eachLabsDetail
      ? eachLabsAspectRatioOptions(eachLabsDetail)
      : falAspectConfig.options;
    const aspectRatioOptions = Array.isArray(aspectRatioOptionsRaw)
      ? aspectRatioOptionsRaw.filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [];
    const aspectRatioDefault = eachLabsDetail
      ? eachLabsAspectRatioDefault(eachLabsDetail)
      : falAspectConfig.default;
    const modelSpec: ModelSpec = {
      modality,
      required_assets,
      prompt_guidelines: guidelines.prompt_guidelines,
      summary: guidelines.summary,
      detected_input_fields,
      ...(aspectRatioOptions.length > 0 ? { aspect_ratio_options: aspectRatioOptions } : {}),
      ...(aspectRatioDefault ? { aspect_ratio_default: aspectRatioDefault } : {}),
      ...(required_input_defaults && Object.keys(required_input_defaults).length > 0
        ? { required_input_defaults }
        : {}),
    };

    const specWithDebug = { ...modelSpec, modality_debug: modalityDebug };
    const specJson: Prisma.InputJsonValue = JSON.parse(JSON.stringify(specWithDebug));
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
      data: {
        status: isDeferredVideoModality(modality) ? 'disabled' : 'active',
        lastCheckedAt: new Date(),
      },
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

let queueTickerStarted = false;

/**
 * Start a periodic ticker that drains the DB queue (every 20s).
 * Call once at app init so queued jobs are processed after process restart.
 */
export function startResearchQueueTicker(): void {
  if (queueTickerStarted) return;
  queueTickerStarted = true;
  setInterval(() => {
    processNextQueuedJob();
  }, 20_000);
}
