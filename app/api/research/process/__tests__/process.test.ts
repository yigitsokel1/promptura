/**
 * Integration tests for Gemini research pipeline
 * Tests that research job starts, Gemini is called (mocked), and spec is saved to DB
 */

import { POST } from '../route';
import { NextRequest } from 'next/server';
import { prisma } from '@/src/db/client';
import { createFalAIClientFromEnv } from '@/src/providers/falai/helpers';
import { researchModelWithGemini } from '@/src/providers/gemini/helpers';
import type { ResearchGuidelinesResult } from '@/src/core/modelSpec';

// Mock dependencies
jest.mock('@/src/lib/auth', () => ({
  requireAdmin: jest.fn(() =>
    Promise.resolve({ session: { user: {} }, user: { id: 'admin-id', email: 'admin@test.com', role: 'ADMIN' } })
  ),
  unauthorizedResponse: jest.fn(() => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
}));
jest.mock('@/src/providers/falai/helpers');
jest.mock('@/src/providers/gemini/helpers');
jest.mock('@/src/db/client', () => ({
  prisma: {
    researchJob: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    modelEndpoint: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    modelSpec: {
      create: jest.fn(),
    },
  },
}));

describe('POST /api/research/process', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FAL_AI_API_KEY = 'test-api-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    // Suppress console.error for expected error tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return 404 if research job not found', async () => {
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/research/process', {
      method: 'POST',
      body: JSON.stringify({ researchJobId: 'non-existent' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('No research job found');
  });

  it('should process research job: fetch metadata, call Gemini, save spec', async () => {
    const mockModelEndpoint = {
      id: 'model-id-123',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
    };

    const mockResearchJob = {
      id: 'job-id-123',
      modelEndpointId: 'model-id-123',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };

    const mockModelMetadata = {
      endpoint_id: 'fal-ai/flux/dev',
      metadata: {
        category: 'text-to-image',
        display_name: 'FLUX.1 [dev]',
        description: 'Fast text-to-image generation',
      },
    };

    // Gemini returns only guidelines + summary (Sprint 7); runResearchJob merges with modality/required_assets
    const mockGuidelines: ResearchGuidelinesResult = {
      prompt_guidelines: [
        'Describe subject clearly',
        'Avoid ambiguous styles',
      ],
      summary: 'Fast text-to-image generation',
    };

    // Setup mocks (route uses findFirst to get jobId, then runResearchJob uses findUnique with include)
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);

    // Mock fal.ai helper
    const mockFalClient = {
      findModel: jest.fn().mockResolvedValue(mockModelMetadata),
    };
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue(mockFalClient);

    // Mock Gemini helper (guidelines only)
    (researchModelWithGemini as jest.Mock).mockResolvedValue(mockGuidelines);

    // Mock prisma update calls - chain them to return updated values
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({
        ...mockResearchJob,
        status: 'running',
      })
      .mockResolvedValueOnce({
        ...mockResearchJob,
        status: 'done',
        finishedAt: new Date(),
      });

    (prisma.modelSpec.create as jest.Mock).mockResolvedValue({
      id: 'spec-id-123',
      modelEndpointId: 'model-id-123',
      specJson: { modality: 'text-to-image', required_assets: 'none', ...mockGuidelines },
    });

    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({
      ...mockModelEndpoint,
      status: 'active',
    });

    const request = new NextRequest('http://localhost/api/research/process', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    // Verify response
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.researchJobId).toBe('job-id-123');

    // Verify research job was updated to running
    expect(prisma.researchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-id-123' },
        data: expect.objectContaining({
          status: 'running',
        }),
      })
    );

    // Verify fal.ai was called
    expect(mockFalClient.findModel).toHaveBeenCalledWith('fal-ai/flux/dev');

    // Verify Gemini was called with full modality (guidelines-only research)
    expect(researchModelWithGemini).toHaveBeenCalledWith(
      mockModelMetadata,
      'model',
      'text-to-image'
    );

    // Verify spec was saved to DB
    expect(prisma.modelSpec.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          modelEndpointId: 'model-id-123',
          researchedBy: 'gemini',
        }),
      })
    );

    // Verify model endpoint status was updated to active
    expect(prisma.modelEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'model-id-123' },
        data: expect.objectContaining({
          status: 'active',
        }),
      })
    );

    // Verify research job was marked as done
    expect(prisma.researchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-id-123' },
        data: expect.objectContaining({
          status: 'done',
        }),
      })
    );
  });

  it('should handle errors and update job status to error', async () => {
    const mockResearchJob = {
      id: 'job-id-123',
      modelEndpointId: 'model-id-123',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: {
        id: 'model-id-123',
        endpointId: 'fal-ai/flux/dev',
        kind: 'model',
        modality: 'image',
      },
    };

    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);

    // Mock fal.ai helper to throw error
    const mockFalClient = {
      findModel: jest.fn().mockRejectedValue(new Error('API Error')),
    };
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue(mockFalClient);

    (prisma.researchJob.update as jest.Mock).mockResolvedValue({
      ...mockResearchJob,
      status: 'running',
    });

    const request = new NextRequest('http://localhost/api/research/process', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBeDefined();

    // Verify job was updated to error status
    expect(prisma.researchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-id-123' },
        data: expect.objectContaining({
          status: 'error',
          error: expect.any(String),
        }),
      })
    );
  });
});
