import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/client';
import { createFalAIClientFromEnv } from '@/src/providers/falai/helpers';
import {
  findEachLabsModel,
  eachLabsDetailToFalMetadata,
} from '@/src/providers/eachlabs/helpers';
import { researchModelWithGemini } from '@/src/providers/gemini/helpers';
import type { FalAIModelMetadata } from '@/src/providers/falai/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { Prisma } from '@prisma/client';
import { handleApiError } from '@/src/lib/api-helpers';
import { deriveModalityAndAssets } from '@/src/lib/research-helpers';
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
      let eachLabsDetail: Awaited<ReturnType<typeof findEachLabsModel>> | null = null;

      if (modelEndpoint.source === 'eachlabs') {
        eachLabsDetail = await findEachLabsModel(modelEndpoint.endpointId);
        if (!eachLabsDetail) {
          throw new Error(
            `Model not found in EachLabs: ${modelEndpoint.endpointId}`
          );
        }
        modelMetadata = eachLabsDetailToFalMetadata(eachLabsDetail);
        category = eachLabsDetail.output_type;
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

      // Derive modality, required_assets, and detected_input_fields from schema
      const derived = await deriveModalityAndAssets({
        source: modelEndpoint.source === 'eachlabs' ? 'eachlabs' : 'fal.ai',
        dbModality: modelEndpoint.modality,
        category,
        eachLabsDetail: eachLabsDetail ?? undefined,
        endpointId: modelEndpoint.endpointId,
      });

      // Gemini: guidelines + summary only (never modality/required_assets/params)
      const guidelines = await researchModelWithGemini(
        modelMetadata,
        modelEndpoint.kind as 'model' | 'workflow',
        derived.modality
      );

      const modelSpec: ModelSpec = {
        modality: derived.modality,
        required_assets: derived.required_assets,
        prompt_guidelines: guidelines.prompt_guidelines,
        summary: guidelines.summary,
        ...(derived.detected_input_fields.length > 0 && {
          detected_input_fields: derived.detected_input_fields,
        }),
      };

      // Store modality_debug alongside spec in JSON (not part of ModelSpec type, but useful for admin debugging)
      const specWithDebug = { ...modelSpec, modality_debug: derived.modalityDebug };
      const specJson: Prisma.InputJsonValue = JSON.parse(JSON.stringify(specWithDebug));

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

      // Clean up stuck runs and iterations for this model (queued/running that will never complete)
      const cleanedRuns = await prisma.run.updateMany({
        where: {
          modelEndpointId: modelEndpoint.id,
          status: { in: ['queued', 'running'] },
        },
        data: {
          status: 'error',
          error: 'Cleaned up during model refresh — spec was outdated. Please start a new generation.',
        },
      });
      // Mark iterations with all-error/done runs as no longer generating
      if (cleanedRuns.count > 0) {
        // Find iterations for this model that are still "generating" or have no finishedAt
        const stuckIterations = await prisma.iteration.findMany({
          where: {
            modelEndpointId: modelEndpoint.id,
            finishedAt: null,
          },
          select: { id: true },
        });
        for (const it of stuckIterations) {
          const pendingCount = await prisma.run.count({
            where: { iterationId: it.id, status: { in: ['queued', 'running'] } },
          });
          if (pendingCount === 0) {
            await prisma.iteration.update({
              where: { id: it.id },
              data: { finishedAt: new Date() },
            }).catch(() => {});
          }
        }
        console.log(`[Refresh] Cleaned ${cleanedRuns.count} stuck runs for ${modelEndpoint.endpointId}`);
      }

      return NextResponse.json({
        success: true,
        researchJobId: researchJob.id,
        message: `Research refreshed successfully${cleanedRuns.count > 0 ? ` (cleaned ${cleanedRuns.count} stuck runs)` : ''}`,
      });
    } catch (error) {
      // Admin refresh: mark as error immediately (no retry queue)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await prisma.researchJob.update({
        where: { id: researchJob.id },
        data: {
          status: 'error',
          error: errorMessage,
          finishedAt: new Date(),
        },
      }).catch(() => {});

      throw error;
    }
  } catch (error) {
    return handleApiError(error, '/api/admin/models/[id]/refresh');
  }
}
