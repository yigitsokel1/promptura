import { NextRequest, NextResponse } from 'next/server';
import {
  createFalAIClientFromEnv,
  extractModelMetadata,
} from '@/src/providers/falai/helpers';
import { prisma } from '@/src/db/client';
import { handleApiError } from '@/src/lib/api-helpers';

interface ValidateRequest {
  endpointId: string;
}

/**
 * Validate a fal.ai model endpoint
 * 
 * Flow:
 * 1. Search for model in fal.ai
 * 2. If NOT FOUND → return error
 * 3. If FOUND:
 *    - Create ModelEndpoint with status = pending_research
 *    - Start ResearchJob automatically
 */
export async function POST(request: NextRequest) {
  try {
    const body: ValidateRequest = await request.json();

    if (!body.endpointId || typeof body.endpointId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid endpointId' },
        { status: 400 }
      );
    }

    const { endpointId } = body;

    // Check if model endpoint already exists
    const existing = await prisma.modelEndpoint.findFirst({
      where: {
        endpointId,
        source: 'fal.ai',
      },
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        modelEndpoint: existing,
        message: 'Model endpoint already exists',
      });
    }

    // Create fal.ai client and search for model
    const client = createFalAIClientFromEnv();
    const modelMetadata = await client.findModel(endpointId);

    if (!modelMetadata) {
      return NextResponse.json(
        { error: `Model endpoint not found: ${endpointId}` },
        { status: 404 }
      );
    }

    // Extract modality and kind from metadata
    const { modality, kind } = extractModelMetadata(modelMetadata);

    // Create ModelEndpoint with status = pending_research
    const modelEndpoint = await prisma.modelEndpoint.create({
      data: {
        endpointId,
        kind,
        modality,
        status: 'pending_research',
        source: 'fal.ai',
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

    // Automatically trigger research processing in background
    // Fire and forget - don't wait for completion
    // This ensures: queued → running → done, ModelSpec written, status = active
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    
    // Start research process asynchronously (non-blocking)
    // Note: In Vercel/serverless, this works but has timeout limits
    // For production, consider using a proper job queue (e.g., Vercel Queue, BullMQ)
    fetch(`${baseUrl}/api/research/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ researchJobId: researchJob.id }),
    })
      .then((response) => {
        if (!response.ok) {
          console.error(
            `Research process failed for job ${researchJob.id}:`,
            response.status,
            response.statusText
          );
        } else {
          console.log(`Research process started for job ${researchJob.id}`);
        }
      })
      .catch((err) => {
        console.error(
          `Failed to auto-process research job ${researchJob.id}:`,
          err
        );
        // Update job status to error if fetch fails
        prisma.researchJob
          .update({
            where: { id: researchJob.id },
            data: {
              status: 'error',
              error: `Failed to trigger research: ${err instanceof Error ? err.message : 'Unknown error'}`,
              finishedAt: new Date(),
            },
          })
          .catch((updateErr) => {
            console.error('Failed to update research job status:', updateErr);
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
