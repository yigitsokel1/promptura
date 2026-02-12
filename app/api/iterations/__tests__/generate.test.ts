/**
 * Integration test for /api/iterations/generate
 * Uses mock providers to test the full flow
 */

import { POST } from '../generate/route';
import { NextRequest } from 'next/server';
import type { TaskSpec } from '@/src/core/types';
import { prisma } from '@/src/db/client';

// Blok B: mock auth and provider keys so we don't pull in next-auth (ESM)
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

// Mock the provider module
jest.mock('@/src/providers', () => ({
  getProviderAdapter: jest.fn(() => ({
    generateCandidates: jest.fn(async (task, model, count) => ({
      candidates: Array.from({ length: count }, (_, i) => ({
        id: `mock_candidate_${i}`,
        prompt: `Mock prompt ${i + 1} for: ${task.goal}`,
        generator: 'self' as const,
      })),
    })),
    runCandidates: jest.fn(async (task, _model, candidates, context) => {
      // Sprint 3: When submitOnly is true, return empty results (jobs submitted, UI will poll)
      if (context?.submitOnly) {
        return { results: [] };
      }
      // Otherwise return mock results (for backward compatibility)
      return {
        results: candidates.map((candidate: { id: string; prompt: string }) => ({
          candidateId: candidate.id,
          output:
            task.modality === 'text-to-text'
              ? { type: 'text' as const, text: `Mock output for: ${candidate.prompt}` }
              : task.modality === 'text-to-image' || task.modality === 'image-to-image'
                ? { type: 'image' as const, images: [{ url: 'https://mock.image.png' }] }
                : task.modality === 'text-to-video' || task.modality === 'image-to-video' || task.modality === 'video-to-video'
                  ? { type: 'video' as const, videos: [{ url: 'https://mock.video.mp4' }] }
                  : { type: 'text' as const, text: `Mock output for: ${candidate.prompt}` },
          meta: { latencyMs: 100 },
        })),
      };
    }),
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
        output:
          task.modality === 'text-to-text'
            ? { type: 'text' as const, text: `Mock output for: ${candidate.prompt}` }
            : task.modality === 'text-to-image' || task.modality === 'image-to-image'
              ? { type: 'image' as const, images: [{ url: 'https://mock.image.png' }] }
              : task.modality === 'text-to-video' || task.modality === 'image-to-video' || task.modality === 'video-to-video'
                ? { type: 'video' as const, videos: [{ url: 'https://mock.video.mp4' }] }
                : { type: 'text' as const, text: `Mock output for: ${candidate.prompt}` },
        meta: { latencyMs: 100 },
      })),
    })),
  })),
}));

// Mock prisma (Blok B: iteration.upsert for createIterationRecord)
jest.mock('@/src/db/client', () => ({
  prisma: {
    modelEndpoint: {
      findUnique: jest.fn(),
    },
    iteration: {
      upsert: jest.fn(() => Promise.resolve()),
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

  it('Integration: user key var → run works (200, jobs submitted)', async () => {
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
          specJson: { inputs: [], outputs: { type: 'image' } },
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
    expect(response.status).toBe(200);

    const iteration = await response.json();

    // Verify iteration structure
    expect(iteration).toHaveProperty('id');
    expect(iteration).toHaveProperty('task');
    expect(iteration).toHaveProperty('targetModel');
    expect(iteration.candidates).toHaveLength(20);
    
    // Sprint 3: API returns immediately with pending status (async queue pattern)
    expect(iteration.status).toBe('pending');
    // Results are not returned immediately - they come via polling /api/iterations/[id]/status
    expect(iteration.results).toHaveLength(0);
    // User had provider key → generate succeeded and run submitted

    // Verify candidates structure
    iteration.candidates.forEach((candidate: { id: string; prompt: string; generator: string }) => {
      expect(candidate).toHaveProperty('id');
      expect(candidate).toHaveProperty('prompt');
      expect(candidate.generator).toBe('gemini-fallback'); // Sprint 3: Gemini-only
    });
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
          specJson: { inputs: [], outputs: { type: 'image' } },
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
          specJson: { inputs: [], outputs: { type: 'image' } },
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
});
