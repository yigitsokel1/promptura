/**
 * Integration tests for Gemini research pipeline
 * Tests that research job starts, Gemini is called (mocked), and spec is saved to DB
 */

import { POST } from '../route';
import { NextRequest } from 'next/server';
import { prisma } from '@/src/db/client';
import {
  createFalAIClientFromEnv,
  getFalOpenApiInputPropertyKeys,
} from '@/src/providers/falai/helpers';
import {
  findEachLabsModel,
  eachLabsDetailToFalMetadata,
  eachLabsModality,
} from '@/src/providers/eachlabs/helpers';
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
jest.mock('@/src/providers/eachlabs/helpers');
jest.mock('@/src/lib/research-helpers', () => {
  const actual = jest.requireActual('@/src/lib/research-helpers') as typeof import('@/src/lib/research-helpers');
  return { ...actual, startResearchQueueTicker: jest.fn() };
});
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

    // Mock fal.ai helpers (schema-asset-analyzer: T2I config-only → required_assets none)
    (getFalOpenApiInputPropertyKeys as jest.Mock).mockResolvedValue({
      keys: ['prompt', 'num_images', 'image_size'],
      required: undefined,
    });
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

  it('fal image editing model: OpenAPI schema with image_url → modality image-to-image, required_assets image', async () => {
    const mockModelEndpoint = {
      id: 'model-id-image-edit',
      endpointId: 'fal-ai/flux-pro/v1.1/image-to-image',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
    };

    const mockResearchJob = {
      id: 'job-id-image-edit',
      modelEndpointId: 'model-id-image-edit',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };

    const mockModelMetadata = {
      endpoint_id: 'fal-ai/flux-pro/v1.1/image-to-image',
      metadata: {
        category: 'image-to-image',
        display_name: 'FLUX Pro Image Edit',
        description: 'Image editing',
      },
    };

    const mockGuidelines: ResearchGuidelinesResult = {
      prompt_guidelines: ['Describe edits clearly'],
      summary: 'Image editing model',
    };

    (getFalOpenApiInputPropertyKeys as jest.Mock).mockResolvedValue({
      keys: ['prompt', 'image_url'],
      required: ['prompt', 'image_url'],
    });
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);

    const mockFalClient = {
      findModel: jest.fn().mockResolvedValue(mockModelMetadata),
    };
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue(mockFalClient);

    (researchModelWithGemini as jest.Mock).mockResolvedValue(mockGuidelines);

    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });

    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) => {
      return Promise.resolve({ id: 'spec-image-edit', ...args.data });
    });
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const request = new NextRequest('http://localhost/api/research/process', {
      method: 'POST',
      body: JSON.stringify({ researchJobId: 'job-id-image-edit' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    const createCall = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0];
    const specJson = createCall.data.specJson as { modality: string; required_assets: string };
    expect(specJson.modality).toBe('image-to-image');
    expect(specJson.required_assets).toBe('image');
  });

  it('fal T2I flux/dev: config-only schema → required_assets none', async () => {
    (getFalOpenApiInputPropertyKeys as jest.Mock).mockResolvedValue({
      keys: ['prompt', 'num_images', 'image_size'],
      required: undefined,
    });
    const mockModelEndpoint = {
      id: 'm-flux-dev',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
    };
    const mockResearchJob = {
      id: 'j-flux-dev',
      modelEndpointId: 'm-flux-dev',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    const mockMetadata = {
      endpoint_id: 'fal-ai/flux/dev',
      metadata: { category: 'text-to-image', display_name: 'FLUX [dev]' },
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue({
      findModel: jest.fn().mockResolvedValue(mockMetadata),
    });
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'T2I',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-1', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-flux-dev' }),
      })
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    const specJson = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0].data
      .specJson as { modality: string; required_assets: string };
    expect(specJson.required_assets).toBe('none');
    expect(specJson.modality).toBe('text-to-image');
  });

  it('fal I2I init_image: schema with init_image → required_assets image', async () => {
    (getFalOpenApiInputPropertyKeys as jest.Mock).mockResolvedValue({
      keys: ['prompt', 'init_image', 'num_steps'],
      required: ['prompt', 'init_image'],
    });
    const mockModelEndpoint = {
      id: 'm-i2i',
      endpointId: 'fal-ai/flux-pro/v1.1/image-to-image',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
    };
    const mockResearchJob = {
      id: 'j-i2i',
      modelEndpointId: 'm-i2i',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    const mockMetadata = {
      endpoint_id: 'fal-ai/flux-pro/v1.1/image-to-image',
      metadata: { category: 'image-to-image', display_name: 'FLUX Edit' },
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue({
      findModel: jest.fn().mockResolvedValue(mockMetadata),
    });
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'I2I',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-i2i', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-i2i' }),
      })
    );
    expect(res.status).toBe(200);
    const specJson = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0].data
      .specJson as { modality: string; required_assets: string };
    expect(specJson.required_assets).toBe('image');
    expect(specJson.modality).toBe('image-to-image');
  });

  it('fal I2I mask_image_url: schema with mask_image_url → required_assets image', async () => {
    (getFalOpenApiInputPropertyKeys as jest.Mock).mockResolvedValue({
      keys: ['prompt', 'image_url', 'mask_image_url'],
      required: ['prompt', 'image_url'],
    });
    const mockModelEndpoint = {
      id: 'm-mask',
      endpointId: 'fal-ai/flux/inpaint',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
    };
    const mockResearchJob = {
      id: 'j-mask',
      modelEndpointId: 'm-mask',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    const mockMetadata = {
      endpoint_id: 'fal-ai/flux/inpaint',
      metadata: { category: 'image-to-image', display_name: 'FLUX Inpaint' },
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue({
      findModel: jest.fn().mockResolvedValue(mockMetadata),
    });
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'Inpaint',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-mask', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-mask' }),
      })
    );
    expect(res.status).toBe(200);
    const specJson = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0].data
      .specJson as { required_assets: string };
    expect(specJson.required_assets).toBe('image');
  });

  it('fal I2V: image_url + video output → required_assets image, modality image-to-video', async () => {
    (getFalOpenApiInputPropertyKeys as jest.Mock).mockResolvedValue({
      keys: ['prompt', 'image_url', 'motion_bucket_id'],
      required: ['prompt', 'image_url'],
    });
    const mockModelEndpoint = {
      id: 'm-i2v',
      endpointId: 'fal-ai/minimax/video-01',
      kind: 'model',
      modality: 'video',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
    };
    const mockResearchJob = {
      id: 'j-i2v',
      modelEndpointId: 'm-i2v',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    const mockMetadata = {
      endpoint_id: 'fal-ai/minimax/video-01',
      metadata: { category: 'image-to-video', display_name: 'I2V' },
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue({
      findModel: jest.fn().mockResolvedValue(mockMetadata),
    });
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'I2V',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-i2v', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-i2v' }),
      })
    );
    expect(res.status).toBe(200);
    const specJson = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0].data
      .specJson as { modality: string; required_assets: string };
    expect(specJson.required_assets).toBe('image');
    expect(specJson.modality).toBe('image-to-video');
  });

  it('fal V2V: video_url → required_assets video, modality video-to-video', async () => {
    (getFalOpenApiInputPropertyKeys as jest.Mock).mockResolvedValue({
      keys: ['prompt', 'video_url'],
      required: ['prompt', 'video_url'],
    });
    const mockModelEndpoint = {
      id: 'm-v2v',
      endpointId: 'fal-ai/kling-video/v1.6/video-to-video',
      kind: 'model',
      modality: 'video',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
    };
    const mockResearchJob = {
      id: 'j-v2v',
      modelEndpointId: 'm-v2v',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    const mockMetadata = {
      endpoint_id: 'fal-ai/kling-video/v1.6/video-to-video',
      metadata: { category: 'video-to-video', display_name: 'V2V' },
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue({
      findModel: jest.fn().mockResolvedValue(mockMetadata),
    });
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'V2V',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-v2v', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-v2v' }),
      })
    );
    expect(res.status).toBe(200);
    const specJson = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0].data
      .specJson as { modality: string; required_assets: string };
    expect(specJson.required_assets).toBe('video');
    expect(specJson.modality).toBe('video-to-video');
  });

  it('fal optional image fallback: image_url not in required → still image (fallback to all keys)', async () => {
    (getFalOpenApiInputPropertyKeys as jest.Mock).mockResolvedValue({
      keys: ['prompt', 'image_url', 'num_steps'],
      required: ['prompt'],
    });
    const mockModelEndpoint = {
      id: 'm-opt',
      endpointId: 'fal-ai/recraft-v3',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
    };
    const mockResearchJob = {
      id: 'j-opt',
      modelEndpointId: 'm-opt',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    const mockMetadata = {
      endpoint_id: 'fal-ai/recraft-v3',
      metadata: { category: 'text-to-image', display_name: 'Recraft' },
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (createFalAIClientFromEnv as jest.Mock).mockReturnValue({
      findModel: jest.fn().mockResolvedValue(mockMetadata),
    });
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'Optional image',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-opt', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-opt' }),
      })
    );
    expect(res.status).toBe(200);
    const specJson = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0].data
      .specJson as { required_assets: string };
    expect(specJson.required_assets).toBe('image');
  });

  it('eachlabs T2I: request_schema config-only → required_assets none', async () => {
    const detail = {
      title: 'EachLabs T2I',
      slug: 'eachlabs/stable-diffusion',
      output_type: 'array',
      request_schema: {
        properties: {
          prompt: { type: 'string' },
          num_inference_steps: { type: 'integer' },
        },
      },
    };
    (findEachLabsModel as jest.Mock).mockResolvedValue(detail);
    (eachLabsDetailToFalMetadata as jest.Mock).mockReturnValue({
      endpoint_id: detail.slug,
      metadata: { category: 'image', display_name: detail.title },
    });
    (eachLabsModality as jest.Mock).mockReturnValue('image');
    const mockModelEndpoint = {
      id: 'm-el-t2i',
      endpointId: 'eachlabs/stable-diffusion',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'eachlabs',
      provider: 'eachlabs',
    };
    const mockResearchJob = {
      id: 'j-el-t2i',
      modelEndpointId: 'm-el-t2i',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'T2I',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-el-t2i', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-el-t2i' }),
      })
    );
    expect(res.status).toBe(200);
    const specJson = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0].data
      .specJson as { modality: string; required_assets: string };
    expect(specJson.required_assets).toBe('none');
    expect(specJson.modality).toBe('text-to-image');
  });

  it('eachlabs I2I: request_schema with image_url → required_assets image', async () => {
    const detail = {
      title: 'EachLabs I2I',
      slug: 'eachlabs/image-editor',
      output_type: 'array',
      request_schema: {
        properties: {
          prompt: { type: 'string' },
          image_url: { type: 'string' },
        },
        required: ['prompt', 'image_url'],
      },
    };
    (findEachLabsModel as jest.Mock).mockResolvedValue(detail);
    (eachLabsDetailToFalMetadata as jest.Mock).mockReturnValue({
      endpoint_id: detail.slug,
      metadata: { category: 'image', display_name: detail.title },
    });
    (eachLabsModality as jest.Mock).mockReturnValue('image');
    const mockModelEndpoint = {
      id: 'm-el-i2i',
      endpointId: 'eachlabs/image-editor',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'eachlabs',
      provider: 'eachlabs',
    };
    const mockResearchJob = {
      id: 'j-el-i2i',
      modelEndpointId: 'm-el-i2i',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'I2I',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-el-i2i', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-el-i2i' }),
      })
    );
    expect(res.status).toBe(200);
    const createCall = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0];
    const specJson = createCall.data.specJson as { modality: string; required_assets: string };
    expect(specJson.required_assets).toBe('image');
    expect(specJson.modality).toBe('image-to-image');
  });

  it('eachlabs image+video: request_schema with image_url and video_url → required_assets image+video', async () => {
    const detail = {
      title: 'EachLabs I+V',
      slug: 'eachlabs/multi-modal',
      output_type: 'video',
      request_schema: {
        properties: {
          prompt: { type: 'string' },
          image_url: { type: 'string' },
          video_url: { type: 'string' },
        },
        required: ['prompt', 'image_url', 'video_url'],
      },
    };
    (findEachLabsModel as jest.Mock).mockResolvedValue(detail);
    (eachLabsDetailToFalMetadata as jest.Mock).mockReturnValue({
      endpoint_id: detail.slug,
      metadata: { category: 'video', display_name: detail.title },
    });
    (eachLabsModality as jest.Mock).mockReturnValue('video');
    const mockModelEndpoint = {
      id: 'm-el-iv',
      endpointId: 'eachlabs/multi-modal',
      kind: 'model',
      modality: 'video',
      status: 'pending_research',
      source: 'eachlabs',
      provider: 'eachlabs',
    };
    const mockResearchJob = {
      id: 'j-el-iv',
      modelEndpointId: 'm-el-iv',
      status: 'queued',
      startedAt: new Date(),
      modelEndpoint: mockModelEndpoint,
    };
    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    (prisma.researchJob.findUnique as jest.Mock).mockResolvedValue(mockResearchJob);
    (researchModelWithGemini as jest.Mock).mockResolvedValue({
      prompt_guidelines: [],
      summary: 'I+V',
    });
    (prisma.researchJob.update as jest.Mock)
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'running' })
      .mockResolvedValueOnce({ ...mockResearchJob, status: 'done', finishedAt: new Date() });
    (prisma.modelSpec.create as jest.Mock).mockImplementation((args: { data: { specJson: unknown } }) =>
      Promise.resolve({ id: 'spec-el-iv', ...args.data })
    );
    (prisma.modelEndpoint.update as jest.Mock).mockResolvedValue({ ...mockModelEndpoint, status: 'active' });

    const res = await POST(
      new NextRequest('http://localhost/api/research/process', {
        method: 'POST',
        body: JSON.stringify({ researchJobId: 'j-el-iv' }),
      })
    );
    expect(res.status).toBe(200);
    const specJson = (prisma.modelSpec.create as jest.Mock).mock.calls[0][0].data
      .specJson as { modality: string; required_assets: string };
    expect(specJson.required_assets).toBe('image+video');
  });

  it('should handle errors: retry then update job status to error and endpoint to research_failed', async () => {
    const mockResearchJob = {
      id: 'job-id-123',
      modelEndpointId: 'model-id-123',
      status: 'queued',
      startedAt: new Date(),
      retryCount: 0,
      runAt: null,
      modelEndpoint: {
        id: 'model-id-123',
        endpointId: 'fal-ai/flux/dev',
        kind: 'model',
        modality: 'image',
      },
    };

    (prisma.researchJob.findFirst as jest.Mock).mockResolvedValue(mockResearchJob);
    // runResearchJob findUnique (full job) then updateResearchJobError findUnique (select retryCount) — last call returns retryCount 2 so 3rd failure marks error
    (prisma.researchJob.findUnique as jest.Mock)
      .mockResolvedValueOnce(mockResearchJob)
      .mockResolvedValueOnce({ modelEndpointId: 'model-id-123', retryCount: 2 });

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

    expect(prisma.researchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-id-123' },
        data: expect.objectContaining({
          status: 'error',
          error: expect.any(String),
        }),
      })
    );
    expect(prisma.modelEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'model-id-123' },
        data: { status: 'research_failed' },
      })
    );
  });
});
