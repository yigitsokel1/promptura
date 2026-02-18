import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/client';
import { createFalAIClientFromEnv, determineModalityFromCategory } from '@/src/providers/falai/helpers';
import {
  findEachLabsModel,
  eachLabsDetailToFalMetadata,
} from '@/src/providers/eachlabs/helpers';
import { researchModelWithGemini } from '@/src/providers/gemini/helpers';
import type { FalAIModelMetadata } from '@/src/providers/falai/types';
import type { Modality } from '@/src/core/types';
import type { ModelSpec, RequiredAssets } from '@/src/core/modelSpec';
import { Prisma } from '@prisma/client';
import { handleApiError } from '@/src/lib/api-helpers';
import { updateResearchJobError } from '@/src/lib/research-helpers';
import { requireAdmin, unauthorizedResponse } from '@/src/lib/auth';

/**
 * Refresh research for a model (ADMIN only). Sprint 7: modality+required_assets derived from metadata;
 * Gemini gives only prompt_guidelines + summary. No schema converters.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return unauthorizedResponse();
  try {
    const { id } = await params;

    // Get model endpoint
    const modelEndpoint = await prisma.modelEndpoint.findUnique({
      where: { id },
    });

    if (!modelEndpoint) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    // Create new research job
    const researchJob = await prisma.researchJob.create({
      data: {
        modelEndpointId: modelEndpoint.id,
        status: 'queued',
        startedAt: new Date(),
      },
    });

    // Update job status to running
    await prisma.researchJob.update({
      where: { id: researchJob.id },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });

    try {
      let modelMetadata: FalAIModelMetadata;
      let category: string | undefined;

      if (modelEndpoint.source === 'eachlabs') {
        const detail = await findEachLabsModel(modelEndpoint.endpointId);
        if (!detail) {
          throw new Error(
            `Model not found in EachLabs: ${modelEndpoint.endpointId}`
          );
        }
        modelMetadata = eachLabsDetailToFalMetadata(detail);
        category = detail.output_type;
      } else {
        const falClient = createFalAIClientFromEnv();
        const falMetadata = await falClient.findModel(modelEndpoint.endpointId);
        if (!falMetadata) {
          throw new Error(
            `Model not found in fal.ai: ${modelEndpoint.endpointId}`
          );
        }
        modelMetadata = falMetadata;
        category = falMetadata.metadata?.category;
      }

      const raw = determineModalityFromCategory(category) ?? modelEndpoint.modality?.toLowerCase() ?? 'text';
      const modality: Modality = raw === 'video' ? 'text-to-video' : raw === 'image' ? 'text-to-image' : 'text-to-text';
      const required_assets: RequiredAssets = 'none';

      // Gemini: guidelines + summary only (never modality/required_assets/params)
      const guidelines = await researchModelWithGemini(
        modelMetadata,
        modelEndpoint.kind as 'model' | 'workflow',
        modality
      );

      const modelSpec: ModelSpec = {
        modality,
        required_assets,
        prompt_guidelines: guidelines.prompt_guidelines,
        summary: guidelines.summary,
      };

      const specJson: Prisma.InputJsonValue = JSON.parse(JSON.stringify(modelSpec));

      // Delete old specs and create new one (overwrite)
      await prisma.modelSpec.deleteMany({
        where: { modelEndpointId: modelEndpoint.id },
      });

      await prisma.modelSpec.create({
        data: {
          modelEndpointId: modelEndpoint.id,
          specJson,
          schemaVersion: '1.0.0',
          researchedBy: 'gemini',
        },
      });

      // Update ModelEndpoint status to active
      await prisma.modelEndpoint.update({
        where: { id: modelEndpoint.id },
        data: {
          status: 'active',
          lastCheckedAt: new Date(),
        },
      });

      // Update ResearchJob status to done
      await prisma.researchJob.update({
        where: { id: researchJob.id },
        data: {
          status: 'done',
          finishedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        researchJobId: researchJob.id,
        message: 'Research refreshed successfully',
      });
    } catch (error) {
      // Update job status to error
      await updateResearchJobError(researchJob.id, error);

      throw error;
    }
  } catch (error) {
    return handleApiError(error, '/api/admin/models/[id]/refresh');
  }
}
