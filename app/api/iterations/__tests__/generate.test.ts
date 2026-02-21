/**
 * Integration test for /api/iterations/generate
 * Uses mock providers to test the full flow
 */

import { POST } from '../generate/route';
import { NextRequest } from 'next/server';
import type { TaskSpec } from '@/src/core/types';
import { prisma } from '@/src/db/client';

// Blok B: mock auth and provider keys so we don't pull in next-auth (ESM)
jest.mock('next/server', () => {
  const actual = jest.requireActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (fn: () => void | Promise<unknown>) => {
      void fn(); // fire and forget, same as real after()
    },
  };
});

jest.mock('@/src/lib/auth', () => ({
  requireAuth: jest.fn(() =>
    Promise.resolve({
      user: { id: 'test-user-id', email: 'test@example.com' },
    })
  ),
  unauthorizedResponse: jest.fn(() => new Response(null, { status: 401 })),
}));
const mockRequireUserProviderKey = jest.fn(
  (_userId: string, _provider: string) => Promise.resolve('mock-fal-key')
);
jest.mock('@/src/lib/provider-keys', () => ({
  requireUserProviderKey: (userId: string, provider: string) =>
    mockRequireUserProviderKey(userId, provider),
}));

// Shared mock adapter so tests can assert on runCandidates (Blok G)
const mockRunCandidates = jest.fn(async (task: TaskSpec, _model: unknown, candidates: unknown[], context: { submitOnly?: boolean }) => {
  if (context?.submitOnly) return { results: [] };
  return {
    results: (candidates as { id: string; prompt: string }[]).map((c) => ({
      candidateId: c.id,
      assets:
        task.modality === 'text-to-text'
          ? [{ type: 'text' as const, content: `Mock output for: ${c.prompt}` }]
          : task.modality === 'text-to-image' || task.modality === 'image-to-image'
            ? [{ type: 'image' as const, url: 'https://mock.image.png' }]
            : task.modality === 'text-to-video' || task.modality === 'image-to-video' || task.modality === 'video-to-video'
              ? [{ type: 'video' as const, url: 'https://mock.video.mp4' }]
              : [{ type: 'text' as const, content: `Mock output for: ${c.prompt}` }],
      metadata: { latencyMs: 100 },
    })),
  };
});

// Mock the provider module
jest.mock('@/src/providers', () => ({
  getProviderAdapter: jest.fn(() => ({
    generateCandidates: jest.fn(async (task: TaskSpec, model: unknown, count: number) => ({
      candidates: Array.from({ length: count }, (_, i) => ({
        id: `mock_candidate_${i}`,
        prompt: `Mock prompt ${i + 1} for: ${task.goal}`,
        generator: 'self' as const,
      })),
    })),
    runCandidates: mockRunCandidates,
  })),
  getPromptGenerationAdapter: jest.fn(() => ({
    generateCandidates: jest.fn(async (task, _model, count, context) => {
      // Verify ModelSpec is provided in context
      if (!context?.modelSpec) {
        throw new Error('ModelSpec is required for prompt generation');
      }
      return {
        candidates: Array.from({ length: count }, (_, i) => ({
          id: `mock_candidate_${i}`,
          prompt: `Mock prompt ${i + 1} for: ${task.goal}`,
          generator: 'gemini-fallback' as const,
        })),
      };
    }),
    runCandidates: jest.fn(async (task, _model, candidates) => ({
      results: candidates.map((candidate: { id: string; prompt: string }) => ({
        candidateId: candidate.id,
        assets:
          task.modality === 'text-to-text'
            ? [{ type: 'text' as const, content: `Mock output for: ${candidate.prompt}` }]
            : task.modality === 'text-to-image' || task.modality === 'image-to-image'
              ? [{ type: 'image' as const, url: 'https://mock.image.png' }]
              : task.modality === 'text-to-video' || task.modality === 'image-to-video' || task.modality === 'video-to-video'
                ? [{ type: 'video' as const, url: 'https://mock.video.mp4' }]
                : [{ type: 'text' as const, content: `Mock output for: ${candidate.prompt}` }],
        metadata: { latencyMs: 100 },
      })),
    })),
  })),
}));

// Mock prisma (Blok B: iteration.upsert; Sprint 3: rateLimitBucket for checkRateLimit)
jest.mock('@/src/db/client', () => ({
  prisma: {
    $transaction: jest.fn((fn: (tx: unknown) => Promise<boolean>) => {
      const tx = {
        rateLimitBucket: {
          deleteMany: jest.fn(() => Promise.resolve()),
          findUnique: jest.fn(() => Promise.resolve(null)),
          update: jest.fn(() => Promise.resolve()),
          create: jest.fn(() => Promise.resolve()),
        },
      };
      return fn(tx);
    }),
    modelEndpoint: { findUnique: jest.fn() },
    iteration: {
      upsert: jest.fn(() => Promise.resolve()),
      updateMany: jest.fn(() => Promise.resolve()),
      findUnique: jest.fn(),
    },
  },
}));

describe('POST /api/iterations/generate', () => {
  const origEnv = process.env;

  beforeEach(() => {
    mockRequireUserProviderKey.mockResolvedValue('mock-fal-key');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...origEnv, TEST_CANDIDATE_COUNT: '20' };
    delete (process.env as NodeJS.ProcessEnv).TEST_MODE;
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('Integration: user key var → returns 202, runs in background', async () => {
    const mockModelEndpoint = {
      id: 'model-endpoint-id-123',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'active',
      source: 'fal.ai',
      provider: 'falai',
      modelSpecs: [
        {
          id: 'spec-id-123',
          specJson: { modality: 'text-to-image', required_assets: 'none', prompt_guidelines: [] },
          researchedAt: new Date(),
        },
      ],
    };

    (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(mockModelEndpoint);

    const task: TaskSpec = {
      goal: 'Test task goal',
      modality: 'text-to-text',
    };

    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ task, modelEndpointId: 'model-endpoint-id-123' }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(202);

    const iteration = await response.json();

    expect(iteration).toHaveProperty('id');
    expect(iteration).toHaveProperty('task');
    expect(iteration).toHaveProperty('targetModel');
    expect(iteration.status).toBe('generating');
    expect(iteration.candidates).toEqual([]);
    // Background runs Gemini + fal.ai; wait and assert 20 prompts → 20 runs (mock)
    await new Promise((r) => setTimeout(r, 500));
    expect(mockRunCandidates).toHaveBeenCalled();
    const [, , candidates] = mockRunCandidates.mock.calls[mockRunCandidates.mock.calls.length - 1];
    expect(candidates).toHaveLength(20);
  });

  it('returns 400 when model requires image but task has no image asset', async () => {
    const imageRequiredEndpoint = {
      id: 'model-endpoint-id-123',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'active',
      source: 'fal.ai',
      provider: 'falai',
      modelSpecs: [
        {
          id: 'spec-id-123',
          specJson: { modality: 'image-to-image', required_assets: 'image', prompt_guidelines: [] },
          researchedAt: new Date(),
        },
      ],
    };
    (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(imageRequiredEndpoint);

    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({
        task: { goal: 'Style transfer', modality: 'image-to-image' },
        modelEndpointId: 'model-endpoint-id-123',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Image required.');
    expect(data.code).toBe('AssetRequired');
    expect(data.required).toBe('image');
  });

  it('should return 404 for non-existent model endpoint', async () => {
    (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(null);

    const task: TaskSpec = {
      goal: 'Test task goal',
      modality: 'text-to-text',
    };

    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ task, modelEndpointId: 'non-existent-id' }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(404);

    const error = await response.json();
    expect(error.error).toContain('Model endpoint not found');
  });

  it('should return 409 SpecNotReady for model without spec', async () => {
    const mockModelEndpoint = {
      id: 'model-endpoint-id-123',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'pending_research',
      source: 'fal.ai',
      provider: 'falai',
      modelSpecs: [],
    };

    (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(mockModelEndpoint);

    const task: TaskSpec = {
      goal: 'Test task goal',
      modality: 'text-to-text',
    };

    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ task, modelEndpointId: 'model-endpoint-id-123' }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(409);

    const error = await response.json();
    expect(error.error).toContain('Model spec not ready');
    expect(error.code).toBe('SpecNotReady');
  });

  it('should return 400 for non-active model', async () => {
    const mockModelEndpoint = {
      id: 'model-endpoint-id-123',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'disabled',
      source: 'fal.ai',
      provider: 'falai',
      modelSpecs: [
        {
          id: 'spec-id-123',
          specJson: { modality: 'text-to-image', required_assets: 'none', prompt_guidelines: [] },
          researchedAt: new Date(),
        },
      ],
    };

    (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(mockModelEndpoint);

    const task: TaskSpec = {
      goal: 'Test task goal',
      modality: 'text-to-text',
    };

    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ task, modelEndpointId: 'model-endpoint-id-123' }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const error = await response.json();
    expect(error.error).toContain('Model is not active');
  });

  it('Integration: user key yok → 400 MissingProviderKey', async () => {
    mockRequireUserProviderKey.mockRejectedValueOnce(new Error('Missing provider API key'));

    const mockModelEndpoint = {
      id: 'model-endpoint-id-123',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'active',
      source: 'fal.ai',
      provider: 'falai',
      modelSpecs: [
        {
          id: 'spec-id-123',
          specJson: { modality: 'text-to-image', required_assets: 'none', prompt_guidelines: [] },
          researchedAt: new Date(),
        },
      ],
    };
    (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(mockModelEndpoint);

    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({
        task: { goal: 'Test', modality: 'text-to-text' },
        modelEndpointId: 'model-endpoint-id-123',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.code).toBe('MissingProviderKey');
    expect(data.error).toBeTruthy();
  });

  it('should return 400 for missing task', async () => {
    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ modelEndpointId: 'model-id' }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const error = await response.json();
    expect(error.error).toContain('Missing required fields');
  });

  it('should return 400 for missing modelEndpointId', async () => {
    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ task: { goal: 'Test', modality: 'text-to-text' } }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const error = await response.json();
    expect(error.error).toContain('Missing required fields');
  });

  describe('Blok G: image-to-image integration mock', () => {
    const mockModelEndpoint = {
      id: 'model-endpoint-id-img2img',
      endpointId: 'fal-ai/flux/dev',
      kind: 'model',
      modality: 'image',
      status: 'active',
      source: 'fal.ai',
      provider: 'falai',
      modelSpecs: [
        {
          id: 'spec-img2img',
          specJson: {
            modality: 'image-to-image',
            required_assets: 'image',
            prompt_guidelines: [],
          },
          researchedAt: new Date(),
        },
      ],
    };

    it('passes task.assets to runCandidates for image-to-image', async () => {
      (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(mockModelEndpoint);

      const task: TaskSpec = {
        goal: 'Watercolor style transfer',
        modality: 'image-to-image',
        assets: [{ type: 'image', url: 'https://example.com/source.png' }],
      };

      const request = new NextRequest('http://localhost/api/iterations/generate', {
        method: 'POST',
        body: JSON.stringify({ task, modelEndpointId: 'model-endpoint-id-img2img' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      expect(response.status).toBe(202);

      // Background runs async; wait for mockRunCandidates to be invoked
      await new Promise((r) => setTimeout(r, 500));
      expect(mockRunCandidates).toHaveBeenCalled();
      const [passedTask] = mockRunCandidates.mock.calls[mockRunCandidates.mock.calls.length - 1];
      expect(passedTask.modality).toBe('image-to-image');
      expect(passedTask.assets).toHaveLength(1);
      expect(passedTask.assets?.[0]).toEqual({
        type: 'image',
        url: 'https://example.com/source.png',
      });
    });
  });

  describe('Blok G: image-to-video integration mock', () => {
    const mockModelEndpoint = {
      id: 'model-endpoint-id-img2vid',
      endpointId: 'eachlabs/kling-video',
      kind: 'model',
      modality: 'video',
      status: 'active',
      source: 'eachlabs',
      provider: 'eachlabs',
      modelSpecs: [
        {
          id: 'spec-img2vid',
          specJson: {
            modality: 'image-to-video',
            required_assets: 'image',
            prompt_guidelines: [],
          },
          researchedAt: new Date(),
        },
      ],
    };

    it('passes task.assets to runCandidates for image-to-video', async () => {
      (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(mockModelEndpoint);
      mockRequireUserProviderKey.mockResolvedValue('mock-eachlabs-key');

      const task: TaskSpec = {
        goal: 'Animate with smooth motion',
        modality: 'image-to-video',
        assets: [{ type: 'image', url: 'https://example.com/keyframe.png' }],
      };

      const request = new NextRequest('http://localhost/api/iterations/generate', {
        method: 'POST',
        body: JSON.stringify({ task, modelEndpointId: 'model-endpoint-id-img2vid' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      expect(response.status).toBe(202);

      await new Promise((r) => setTimeout(r, 500));
      expect(mockRunCandidates).toHaveBeenCalled();
      const [passedTask] = mockRunCandidates.mock.calls[mockRunCandidates.mock.calls.length - 1];
      expect(passedTask.modality).toBe('image-to-video');
      expect(passedTask.assets).toHaveLength(1);
      expect(passedTask.assets?.[0]).toEqual({
        type: 'image',
        url: 'https://example.com/keyframe.png',
      });
    });
  });
});
