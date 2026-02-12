/**
 * Integration tests: refine happy path, 1 selection, 5 selection (Blok F)
 */

import { POST as RefinePOST } from '../refine/route';
import { POST as GeneratePOST } from '../generate/route';
import { NextRequest } from 'next/server';
import type { TaskSpec } from '@/src/core/types';
import { prisma } from '@/src/db/client';
import * as dbQueries from '@/src/db/queries';

jest.mock('@/src/lib/auth', () => ({
  requireAuth: jest.fn(() =>
    Promise.resolve({ user: { id: 'test-user-id', email: 'test@example.com' } })
  ),
  unauthorizedResponse: jest.fn(() => new Response(null, { status: 401 })),
}));
jest.mock('@/src/lib/provider-keys', () => ({
  requireUserProviderKey: jest.fn(() => Promise.resolve('mock-fal-key')),
}));

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
      specJson: {
        inputs: [{ name: 'prompt', type: 'string', required: true }],
        outputs: { type: 'image', format: 'url[]' },
        prompt_guidelines: ['Use clear descriptions'],
      },
      researchedAt: new Date(),
    },
  ],
};

jest.mock('@/src/providers', () => ({
  getProviderAdapter: jest.fn(() => ({
    runCandidates: jest.fn(async () => ({ results: [] })),
  })),
  getPromptGenerationAdapter: jest.fn(() => ({
    generateCandidates: jest.fn(async (_task: TaskSpec, _model: unknown, count: number, context: { selectedPrompts?: unknown[] }) => {
      const n = context?.selectedPrompts?.length ?? 0;
      return {
        candidates: Array.from({ length: count }, (_, i) => ({
          id: `refined_${n}_${i}`,
          prompt: `Refined prompt ${i + 1} (from ${n} selected)`,
          generator: 'gemini-fallback' as const,
        })),
      };
    }),
  })),
}));

jest.mock('@/src/db/client', () => ({
  prisma: {
    modelEndpoint: { findUnique: jest.fn() },
    run: { findMany: jest.fn() },
    iteration: { upsert: jest.fn() },
  },
}));

jest.mock('@/src/db/queries', () => ({
  findModelEndpointWithSpecOnly: jest.fn(),
  findRunsByIterationId: jest.fn(() => Promise.resolve([])),
  createIterationRecord: jest.fn(() => Promise.resolve()),
}));

describe('POST /api/iterations/refine', () => {
  const task: TaskSpec = { goal: 'Test goal', modality: 'text-to-image' };

  beforeEach(() => {
    jest.clearAllMocks();
    (dbQueries.findModelEndpointWithSpecOnly as jest.Mock).mockResolvedValue(mockModelEndpoint);
    (dbQueries.findRunsByIterationId as jest.Mock).mockResolvedValue([]);
  });

  it('refine with 1 selection returns 200 and 10 candidates', async () => {
    const feedback = [
      { candidateId: 'c1', selected: true, note: 'Good' },
      { candidateId: 'c2', selected: false },
    ];
    const selectedPrompts = [{ candidateId: 'c1', prompt: 'Prompt one', note: 'Good' }];

    const request = new NextRequest('http://localhost/api/iterations/refine', {
      method: 'POST',
      body: JSON.stringify({
        task,
        modelEndpointId: 'model-endpoint-id-123',
        previousIterationId: 'iter_prev_1',
        feedback,
        selectedPrompts,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await RefinePOST(request);
    expect(response.status).toBe(200);

    const iteration = await response.json();
    expect(iteration.candidates).toHaveLength(10);
    expect(iteration.status).toBe('pending');
    expect(iteration.id).toBeDefined();
  });

  it('refine with 5 selections returns 200 and 10 candidates', async () => {
    const feedback = Array.from({ length: 10 }, (_, i) => ({
      candidateId: `c${i}`,
      selected: i < 5,
      note: i < 5 ? `Note ${i}` : undefined,
    }));
    const selectedPrompts = Array.from({ length: 5 }, (_, i) => ({
      candidateId: `c${i}`,
      prompt: `Prompt ${i}`,
      note: `Note ${i}`,
    }));

    const request = new NextRequest('http://localhost/api/iterations/refine', {
      method: 'POST',
      body: JSON.stringify({
        task,
        modelEndpointId: 'model-endpoint-id-123',
        previousIterationId: 'iter_prev_5',
        feedback,
        selectedPrompts,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await RefinePOST(request);
    expect(response.status).toBe(200);

    const iteration = await response.json();
    expect(iteration.candidates).toHaveLength(10);
  });

  it('returns 400 when no feedback selected', async () => {
    const request = new NextRequest('http://localhost/api/iterations/refine', {
      method: 'POST',
      body: JSON.stringify({
        task,
        modelEndpointId: 'model-endpoint-id-123',
        previousIterationId: 'iter_prev',
        feedback: [{ candidateId: 'c1', selected: false }],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await RefinePOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('At least one');
  });
});

describe('Generate then Refine happy path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.modelEndpoint.findUnique as jest.Mock).mockResolvedValue(mockModelEndpoint);
    (dbQueries.findModelEndpointWithSpecOnly as jest.Mock).mockResolvedValue(mockModelEndpoint);
    (dbQueries.findRunsByIterationId as jest.Mock).mockResolvedValue([]);
  });

  it('generate returns iteration then refine returns new iteration with 10 candidates', async () => {
    const task: TaskSpec = { goal: 'Happy path goal', modality: 'text-to-image' };

    const genRequest = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ task, modelEndpointId: 'model-endpoint-id-123' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const genResponse = await GeneratePOST(genRequest);
    expect(genResponse.status).toBe(200);
    const genIteration = await genResponse.json();
    expect(genIteration.candidates.length).toBeGreaterThanOrEqual(1);
    const previousId = genIteration.id;
    const oneCandidateId = genIteration.candidates[0].id;

    const feedback = [
      { candidateId: oneCandidateId, selected: true },
      ...genIteration.candidates.slice(1).map((c: { id: string }) => ({ candidateId: c.id, selected: false })),
    ];
    const selectedPrompts = [
      { candidateId: oneCandidateId, prompt: genIteration.candidates[0].prompt },
    ];

    const refRequest = new NextRequest('http://localhost/api/iterations/refine', {
      method: 'POST',
      body: JSON.stringify({
        task,
        modelEndpointId: 'model-endpoint-id-123',
        previousIterationId: previousId,
        feedback,
        selectedPrompts,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const refResponse = await RefinePOST(refRequest);
    expect(refResponse.status).toBe(200);
    const refIteration = await refResponse.json();
    expect(refIteration.id).toBeDefined();
    expect(refIteration.id).not.toBe(previousId);
    expect(refIteration.candidates).toHaveLength(10);
  });
});
