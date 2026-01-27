import { NextRequest, NextResponse } from 'next/server';
import type { TaskSpec, ModelRef } from '@/src/core/types';
import { createIteration, addCandidates, addResults } from '@/src/core/iteration/iteration';
import { resolvePromptGenerator } from '@/src/core/iteration/promptStrategy';
import { getProviderAdapter, getPromptGenerationAdapter } from '@/src/providers';

interface GenerateRequest {
  task: TaskSpec;
  targetModel: ModelRef;
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();

    if (!body.task || !body.targetModel) {
      return NextResponse.json(
        { error: 'Missing required fields: task, targetModel' },
        { status: 400 }
      );
    }

    const { task, targetModel } = body;

    // Resolve prompt generator strategy
    const generator = resolvePromptGenerator(targetModel);

    // Get appropriate provider adapter
    const promptAdapter =
      generator === 'self'
        ? getProviderAdapter(targetModel)
        : getPromptGenerationAdapter();

    const runnerAdapter = getProviderAdapter(targetModel);

    // Generate iteration ID
    const iterationId = `iter_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Create base iteration
    let iteration = createIteration(iterationId, task, targetModel);

    // Generate 20 candidate prompts using provider adapter
    const promptResult = await promptAdapter.generateCandidates(
      task,
      targetModel,
      20
    );

    // Set generator type on candidates
    promptResult.candidates.forEach((candidate) => {
      candidate.generator = generator;
    });

    // Add candidates to iteration
    iteration = addCandidates(iteration, promptResult.candidates);

    // Run candidates using provider adapter
    const runResult = await runnerAdapter.runCandidates(
      task,
      targetModel,
      promptResult.candidates
    );

    // Add results to iteration
    iteration = addResults(iteration, runResult.results);

    return NextResponse.json(iteration);
  } catch (error) {
    console.error('Error in /api/iterations/generate:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
