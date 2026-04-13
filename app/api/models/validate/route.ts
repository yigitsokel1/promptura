import { NextRequest, NextResponse } from 'next/server';
import {
  createFalAIClientFromEnv,
  extractModelMetadata,
  validateFalModelViaSchema,
} from '@/src/providers/falai/helpers';
import {
  findEachLabsModel,
  eachLabsModality,
} from '@/src/providers/eachlabs/helpers';
import { prisma } from '@/src/db/client';
import { handleApiError } from '@/src/lib/api-helpers';
import { runResearchJob, startResearchQueueTicker } from '@/src/lib/research-helpers';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';
import type { Modality } from '@/src/core/types';
import { isDeferredVideoModality, videoRolloutErrorMessage } from '@/src/lib/video-rollout';

type SourceSlug = 'fal.ai' | 'eachlabs';

interface ValidateRequest {
  endpointId: string;
  source?: SourceSlug;
}

function normalizeValidateModality(modality: string): Modality {
  if (modality === 'text' || modality === 'text-to-text') return 'text-to-text';
  if (modality === 'image' || modality === 'text-to-image' || modality === 'image-to-image') {
    return modality === 'image-to-image' ? 'image-to-image' : 'text-to-image';
  }
  if (modality === 'video' || modality === 'text-to-video') return 'text-to-video';
  if (modality === 'image-to-video') return 'image-to-video';
  if (modality === 'video-to-video') return 'video-to-video';
  return 'text-to-text';
}

/**
 * Validate a model endpoint (fal.ai or EachLabs).
 * Any authenticated user can add models. If model exists in provider, it is added to catalog.
 *
 * Flow:
 * 1. Resolve source (default fal.ai)
 * 2. Search for model in that provider
 * 3. If NOT FOUND → return error
 * 4. If FOUND: create ModelEndpoint (pending_research), start ResearchJob
 */
const RATE_LIMIT_PER_MINUTE = 3;

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return unauthorizedResponse();
  try {
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID not found in session' },
        { status: 401 }
      );
    }

    // Per-user rate limit: max 3 model additions per minute
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const recentCount = await prisma.modelEndpoint.count({
      where: {
        addedByUserId: userId,
        createdAt: { gte: oneMinuteAgo },
      },
    });
    if (recentCount >= RATE_LIMIT_PER_MINUTE) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded: max ${RATE_LIMIT_PER_MINUTE} model additions per minute. Try again later.`,
        },
        { status: 429 }
      );
    }

    const body: ValidateRequest = await request.json();

    if (!body.endpointId || typeof body.endpointId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid endpointId' },
        { status: 400 }
      );
    }

    const endpointId = body.endpointId.trim();
    const source: SourceSlug =
      body.source === 'eachlabs' ? 'eachlabs' : 'fal.ai';

    // Check if model endpoint already exists (unique on endpointId + source)
    const existing = await prisma.modelEndpoint.findFirst({
      where: { endpointId, source },
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        modelEndpoint: existing,
        message: 'Model endpoint already exists',
      });
    }

    let kind: 'model' | 'workflow' = 'model';
    let modality: string = 'text-to-text';
    let provider: string = source === 'eachlabs' ? 'eachlabs' : 'falai';

    if (source === 'eachlabs') {
      const detail = await findEachLabsModel(endpointId);
      if (!detail) {
        return NextResponse.json(
          { error: `Model not found in EachLabs: ${endpointId}` },
          { status: 404 }
        );
      }
      kind = 'model';
      modality = eachLabsModality(detail);
      provider = 'eachlabs';
    } else {
      let modelMetadata: { endpoint_id: string; metadata: { category?: string } } | null = null;
      let usedSchemaFallback = false;
      try {
        const client = createFalAIClientFromEnv();
        modelMetadata = await client.findModel(endpointId);
      } catch (findError) {
        const errMsg = findError instanceof Error ? findError.message : String(findError);
        const is5xx = /5\d\d/.test(errMsg) || errMsg.includes('500') || errMsg.includes('504');
        if (is5xx) {
          const schemaResult = await validateFalModelViaSchema(endpointId);
          if (schemaResult.valid && schemaResult.kind && schemaResult.modality) {
            kind = schemaResult.kind;
            modality = schemaResult.modality;
            provider = 'falai';
            usedSchemaFallback = true;
          } else {
            return NextResponse.json(
              { error: `Fal.ai API is temporarily unavailable (${errMsg.slice(0, 80)}...). Could not validate model. Try again later.` },
              { status: 502 }
            );
          }
        } else {
          throw findError;
        }
      }
      if (modelMetadata) {
        const extracted = extractModelMetadata(modelMetadata);
        kind = extracted.kind;
        modality = extracted.modality;
        provider = 'falai';
      } else if (!usedSchemaFallback) {
        return NextResponse.json(
          { error: `Model endpoint not found: ${endpointId}` },
          { status: 404 }
        );
      }
    }

    const normalizedModality = normalizeValidateModality(modality);
    if (isDeferredVideoModality(normalizedModality)) {
      return NextResponse.json(
        {
          error: videoRolloutErrorMessage(normalizedModality),
          code: 'ModalityDeferred',
          modality: normalizedModality,
        },
        { status: 400 }
      );
    }

    const modelEndpoint = await prisma.modelEndpoint.create({
      data: {
        endpointId,
        kind,
        modality: normalizedModality,
        status: 'pending_research',
        source,
        provider,
        addedByUserId: userId,
        lastCheckedAt: new Date(),
      },
    });

    // Start ResearchJob automatically
    const researchJob = await prisma.researchJob.create({
      data: {
        modelEndpointId: modelEndpoint.id,
        status: 'queued',
        startedAt: new Date(),
      },
    });

    startResearchQueueTicker();
    const jobId = researchJob.id;
    setImmediate(() => {
      runResearchJob(jobId).catch((err) => {
        console.error(`Research job ${jobId} failed:`, err);
      });
    });

    return NextResponse.json({
      success: true,
      modelEndpoint,
      researchJob,
      message: 'Model validated and research job started',
    });
  } catch (error) {
    return handleApiError(error, '/api/models/validate');
  }
}
