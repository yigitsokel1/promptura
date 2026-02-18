/**
 * Integration tests for model validation (fal.ai and EachLabs)
 */

import { POST } from '../route';
import { NextRequest } from 'next/server';
import { createFalAIClientFromEnv, extractModelMetadata } from '@/src/providers/falai/helpers';
import { findEachLabsModel, eachLabsModality } from '@/src/providers/eachlabs/helpers';
import { prisma } from '@/src/db/client';
import { requireAuth } from '@/src/lib/auth';

// Mock dependencies
jest.mock('@/src/lib/auth', () => ({
  requireAuth: jest.fn(() =>
    Promise.resolve({ user: { id: 'user-id', email: 'user@test.com' } })
  ),
  unauthorizedResponse: jest.fn(() => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
}));
jest.mock('@/src/providers/falai/helpers', () => ({
  createFalAIClientFromEnv: jest.fn(),
  extractModelMetadata: jest.fn(),
}));
jest.mock('@/src/providers/eachlabs/helpers', () => ({
  findEachLabsModel: jest.fn(),
  eachLabsModality: jest.fn(),
}));
jest.mock('@/src/lib/research-helpers', () => ({
  runResearchJob: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/src/db/client', () => ({
  prisma: {
    modelEndpoint: {
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    researchJob: {
      create: jest.fn(),
    },
  },
}));

// Mock global fetch for fire-and-forget research process calls
global.fetch = jest.fn();

describe('POST /api/models/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FAL_AI_API_KEY = 'test-api-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    (prisma.modelEndpoint.count as jest.Mock).mockResolvedValue(0);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
  });

  it('should return 429 when rate limit exceeded', async () => {
    (prisma.modelEndpoint.count as jest.Mock).mockResolvedValue(3);

    const request = new NextRequest('http://localhost/api/models/validate', {
      method: 'POST',
      body: JSON.stringify({ endpointId: 'fal-ai/flux/dev' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error).toContain('Rate limit exceeded');
    expect(prisma.modelEndpoint.create).not.toHaveBeenCalled();
  });

  it('should return 401 when not authenticated', async () => {
    (requireAuth as jest.Mock).mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost/api/models/validate', {
      method: 'POST',
      body: JSON.stringify({ endpointId: 'fal-ai/flux/dev' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it('should return 400 for missing endpointId', async () => {
    const request = new NextRequest('http://localhost/api/models/validate', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Missing or invalid endpointId');
  });

  it('should return 404 for invalid endpoint (model not found in fal.ai)', async () => {
    const mockFalClient = {
      findModel: jest.fn().mockResolvedValue(null),
    };
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue(mockFalClient);

    (prisma.modelEndpoint.findFirst as jest.Mock).mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/models/validate', {
      method: 'POST',
      body: JSON.stringify({ endpointId: 'invalid-endpoint' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('Model endpoint not found');
    expect(mockFalClient.findModel).toHaveBeenCalledWith('invalid-endpoint');
  });

  it('should create ModelEndpoint and ResearchJob for valid endpoint', async () => {
    const mockModelMetadata = {
      endpoint_id: 'fal-ai/flux/dev',
      metadata: {
        category: 'text-to-image',
        display_name: 'FLUX.1 [dev]',
        description: 'Fast text-to-image generation',
        status: 'active' as const,
      },
    };

    const mockFalClient = {
      findModel: jest.fn().mockResolvedValue(mockModelMetadata),
    };
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue(mockFalClient);
    
    // Mock extractModelMetadata to return modality and kind
    (extractModelMetadata as jest.Mock).mockReturnValue({
      modality: 'image',
      kind: 'model',
    });

    const mockModelEndpoint = {
      id: 'model-id-123',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'fal.ai',
      createdAt: new Date(),
      lastCheckedAt: new Date(),
    };

    const mockResearchJob = {
      id: 'job-id-123',
      modelEndpointId: 'model-id-123',
      status: 'queued',
      startedAt: new Date(),
    };

    (prisma.modelEndpoint.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.modelEndpoint.create as jest.Mock).mockResolvedValue(mockModelEndpoint);
    (prisma.researchJob.create as jest.Mock).mockResolvedValue(mockResearchJob);

    const request = new NextRequest('http://localhost/api/models/validate', {
      method: 'POST',
      body: JSON.stringify({ endpointId: 'fal-ai/flux/dev' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.modelEndpoint).toBeDefined();
    expect(data.researchJob).toBeDefined();
    expect(mockFalClient.findModel).toHaveBeenCalledWith('fal-ai/flux/dev');
    expect(prisma.modelEndpoint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endpointId: 'fal-ai/flux/dev',
          kind: 'model',
          modality: 'image',
          status: 'pending_research',
          addedByUserId: 'user-id',
        }),
      })
    );
    expect(prisma.researchJob.create).toHaveBeenCalled();
  });

  it('should return existing model if already in database', async () => {
    const existingModel = {
      id: 'existing-id',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'active',
      source: 'fal.ai',
    };

    (prisma.modelEndpoint.findFirst as jest.Mock).mockResolvedValue(existingModel);

    const request = new NextRequest('http://localhost/api/models/validate', {
      method: 'POST',
      body: JSON.stringify({ endpointId: 'fal-ai/flux/dev' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toContain('already exists');
    expect(prisma.modelEndpoint.create).not.toHaveBeenCalled();
  });

  it('should create ModelEndpoint and ResearchJob for valid EachLabs slug', async () => {
    const mockEachLabsDetail = {
      title: 'Nano Banana Pro Edit',
      slug: 'nano-banana-pro-edit',
      version: '1.0',
      output_type: 'array',
    };
    (findEachLabsModel as jest.Mock).mockResolvedValue(mockEachLabsDetail);
    (eachLabsModality as jest.Mock).mockReturnValue('image');

    (prisma.modelEndpoint.findFirst as jest.Mock).mockResolvedValue(null);
    const mockModelEndpoint = {
      id: 'model-id-el',
      endpointId: 'nano-banana-pro-edit',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'eachlabs',
      provider: 'eachlabs',
      createdAt: new Date(),
      lastCheckedAt: new Date(),
    };
    const mockResearchJob = {
      id: 'job-id-el',
      modelEndpointId: 'model-id-el',
      status: 'queued',
      startedAt: new Date(),
    };
    (prisma.modelEndpoint.create as jest.Mock).mockResolvedValue(mockModelEndpoint);
    (prisma.researchJob.create as jest.Mock).mockResolvedValue(mockResearchJob);

    const request = new NextRequest('http://localhost/api/models/validate', {
      method: 'POST',
      body: JSON.stringify({ endpointId: 'nano-banana-pro-edit', source: 'eachlabs' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(findEachLabsModel).toHaveBeenCalledWith('nano-banana-pro-edit');
    expect(eachLabsModality).toHaveBeenCalledWith(mockEachLabsDetail);
    expect(prisma.modelEndpoint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endpointId: 'nano-banana-pro-edit',
          kind: 'model',
          modality: 'image',
          source: 'eachlabs',
          provider: 'eachlabs',
          status: 'pending_research',
          addedByUserId: 'user-id',
        }),
      })
    );
    expect(prisma.researchJob.create).toHaveBeenCalled();
  });

  it('should return 404 for EachLabs slug not found', async () => {
    (findEachLabsModel as jest.Mock).mockResolvedValue(null);
    (prisma.modelEndpoint.findFirst as jest.Mock).mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/models/validate', {
      method: 'POST',
      body: JSON.stringify({ endpointId: 'nonexistent-slug', source: 'eachlabs' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('Model not found in EachLabs');
  });
});
