import { NextRequest, NextResponse } from 'next/server';
import {
  createFalAIClientFromEnv,
  extractModelMetadata,
} from '@/src/providers/falai/helpers';
import {
  findEachLabsModel,
  eachLabsModality,
} from '@/src/providers/eachlabs/helpers';
import { prisma } from '@/src/db/client';
import { handleApiError } from '@/src/lib/api-helpers';
import { runResearchJob } from '@/src/lib/research-helpers';
import { requireAdmin, unauthorizedResponse } from '@/src/lib/auth';

type SourceSlug = 'fal.ai' | 'eachlabs';

interface ValidateRequest {
  endpointId: string;
  source?: SourceSlug;
}

/**
 * Validate a model endpoint (fal.ai or EachLabs).
 *
 * Flow:
 * 1. Resolve source (default fal.ai)
 * 2. Search for model in that provider
 * 3. If NOT FOUND → return error
 * 4. If FOUND: create ModelEndpoint (pending_research), start ResearchJob
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return unauthorizedResponse();
  try {
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

    let kind: 'model' | 'workflow';
    let modality: 'text' | 'image' | 'video';
    let provider: string;

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
      const client = createFalAIClientFromEnv();
      const modelMetadata = await client.findModel(endpointId);
      if (!modelMetadata) {
        return NextResponse.json(
          { error: `Model endpoint not found: ${endpointId}` },
          { status: 404 }
        );
      }
      const extracted = extractModelMetadata(modelMetadata);
      kind = extracted.kind;
      modality = extracted.modality;
      provider = 'falai';
    }

    const modelEndpoint = await prisma.modelEndpoint.create({
      data: {
        endpointId,
        kind,
        modality,
        status: 'pending_research',
        source,
        provider,
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

    // Run research in same process (no HTTP), so no auth/session issue
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
