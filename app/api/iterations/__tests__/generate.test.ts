/**
 * Integration test for /api/iterations/generate
 * Uses mock providers to test the full flow
 */

import { POST } from '../generate/route';
import { NextRequest } from 'next/server';
import type { TaskSpec, ModelRef } from '@/src/core/types';

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
    runCandidates: jest.fn(async (task, model, candidates) => ({
      results: candidates.map((candidate: any) => ({
        candidateId: candidate.id,
        outputText: `Mock output for: ${candidate.prompt}`,
        meta: { latencyMs: 100 },
      })),
    })),
  })),
  getPromptGenerationAdapter: jest.fn(() => ({
    generateCandidates: jest.fn(async (task, model, count) => ({
      candidates: Array.from({ length: count }, (_, i) => ({
        id: `mock_candidate_${i}`,
        prompt: `Mock prompt ${i + 1} for: ${task.goal}`,
        generator: 'self' as const,
      })),
    })),
    runCandidates: jest.fn(async (task, model, candidates) => ({
      results: candidates.map((candidate: any) => ({
        candidateId: candidate.id,
        outputText: `Mock output for: ${candidate.prompt}`,
        meta: { latencyMs: 100 },
      })),
    })),
  })),
}));

describe('POST /api/iterations/generate', () => {
  it('should generate 20 candidates with results', async () => {
    const task: TaskSpec = {
      goal: 'Test task goal',
      modality: 'text-to-text',
    };

    const targetModel: ModelRef = {
      provider: 'falai',
      modelId: 'test-model',
    };

    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ task, targetModel }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const iteration = await response.json();

    expect(iteration).toHaveProperty('id');
    expect(iteration).toHaveProperty('task');
    expect(iteration).toHaveProperty('targetModel');
    expect(iteration.candidates).toHaveLength(20);
    expect(iteration.results).toHaveLength(20);

    // Verify each candidate has a corresponding result
    iteration.candidates.forEach((candidate: any) => {
      const result = iteration.results.find(
        (r: any) => r.candidateId === candidate.id
      );
      expect(result).toBeDefined();
      expect(result.outputText).toContain('Mock output');
    });
  });

  it('should return 400 for missing task', async () => {
    const request = new NextRequest('http://localhost/api/iterations/generate', {
      method: 'POST',
      body: JSON.stringify({ targetModel: { provider: 'falai', modelId: 'test' } }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const error = await response.json();
    expect(error.error).toContain('Missing required fields');
  });

  it('should return 400 for missing targetModel', async () => {
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
