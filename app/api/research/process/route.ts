import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/client';
import { researchModelWithGemini } from '@/src/providers/gemini/helpers';
import { createFalAIClientFromEnv } from '@/src/providers/falai/helpers';
import { Prisma } from '@prisma/client';
import { handleApiError } from '@/src/lib/api-helpers';
import { updateResearchJobError } from '@/src/lib/research-helpers';

interface ProcessRequest {
  researchJobId?: string; // Optional: process specific job, otherwise process next queued
}

/**
 * Process a research job
 * 
 * Flow:
 * 1. Find queued research job (or use provided ID)
 * 2. Get ModelEndpoint
 * 3. Fetch model metadata from fal.ai
 * 4. Call Gemini to research and generate ModelSpec
 * 5. Save ModelSpec to database
 * 6. Update ModelEndpoint.status = active
 * 7. Update ResearchJob.status = done
 */
export async function POST(request: NextRequest) {
  try {
    const body: ProcessRequest = await request.json().catch(() => ({}));
    const { researchJobId } = body;

    // Find research job
    let researchJob;
    if (researchJobId) {
      researchJob = await prisma.researchJob.findUnique({
        where: { id: researchJobId },
        include: { modelEndpoint: true },
      });
    } else {
      // Find next queued job
      researchJob = await prisma.researchJob.findFirst({
        where: { status: 'queued' },
        include: { modelEndpoint: true },
        orderBy: { startedAt: 'asc' },
      });
    }

    if (!researchJob) {
      return NextResponse.json(
        { error: 'No research job found' },
        { status: 404 }
      );
    }

    // Allow processing if status is 'queued' or 'running' (idempotency)
    // 'running' can happen if the job was already started but not completed
    const isAlreadyRunning = researchJob.status === 'running';
    
    if (researchJob.status !== 'queued' && !isAlreadyRunning) {
      return NextResponse.json(
        { 
          error: `Research job cannot be processed (status: ${researchJob.status})`,
          currentStatus: researchJob.status,
        },
        { status: 400 }
      );
    }

    const modelEndpoint = researchJob.modelEndpoint;

    // Update job status to running (if not already running)
    if (!isAlreadyRunning) {
      await prisma.researchJob.update({
        where: { id: researchJob.id },
        data: {
          status: 'running',
          startedAt: new Date(),
        },
      });
    }

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

      // Save ModelSpec to database
      // Convert ModelSpec to Prisma JsonValue
      const specJson: Prisma.InputJsonValue = JSON.parse(JSON.stringify(modelSpec));
      
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
        modelEndpointId: modelEndpoint.id,
        message: 'Research completed successfully',
      });
    } catch (error) {
      // Update job status to error
      await updateResearchJobError(researchJob.id, error);

      throw error;
    }
  } catch (error) {
    return handleApiError(error, '/api/research/process');
  }
}
