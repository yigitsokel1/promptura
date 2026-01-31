import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/client';
import { createFalAIClientFromEnv } from '@/src/providers/falai/helpers';
import { researchModelWithGemini } from '@/src/providers/gemini/helpers';
import { Prisma } from '@prisma/client';
import { handleApiError } from '@/src/lib/api-helpers';
import { updateResearchJobError } from '@/src/lib/research-helpers';

/**
 * Refresh research for a model
 * 
 * Flow:
 * 1. Create new ResearchJob (queued)
 * 2. Fetch model metadata from fal.ai
 * 3. Call Gemini to research and generate new ModelSpec
 * 4. Overwrite existing ModelSpec (or create new one)
 * 5. Update ResearchJob status
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      // Fetch model metadata from fal.ai
      const falClient = createFalAIClientFromEnv();
      const modelMetadata = await falClient.findModel(modelEndpoint.endpointId);

      if (!modelMetadata) {
        throw new Error(
          `Model not found in fal.ai: ${modelEndpoint.endpointId}`
        );
      }

      // Research model with Gemini
      const modelSpec = await researchModelWithGemini(
        modelMetadata,
        modelEndpoint.kind as 'model' | 'workflow',
        modelEndpoint.modality
      );

      // Convert to Prisma JsonValue
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
