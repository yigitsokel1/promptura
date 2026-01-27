import { NextRequest, NextResponse } from 'next/server';
import type {
  TaskSpec,
  ModelRef,
  RefineRequest,
} from '@/src/core/types';
import { createIteration, addCandidates, addResults } from '@/src/core/iteration/iteration';
import { resolvePromptGenerator } from '@/src/core/iteration/promptStrategy';
import { getProviderAdapter, getPromptGenerationAdapter } from '@/src/providers';

interface RefineRequestBody {
  refineRequest: RefineRequest;
  targetModel: ModelRef;
  task: TaskSpec;
}

export async function POST(request: NextRequest) {
  try {
    const body: RefineRequestBody = await request.json();

    if (!body.refineRequest || !body.targetModel || !body.task) {
      return NextResponse.json(
        { error: 'Missing required fields: refineRequest, targetModel, task' },
        { status: 400 }
      );
    }

    const { refineRequest, targetModel, task } = body;

    // Get selected feedback items
    const selectedFeedback = refineRequest.feedback.filter((item) => item.selected);
    
    if (selectedFeedback.length === 0) {
      return NextResponse.json(
        { error: 'At least one feedback item must be selected' },
        { status: 400 }
      );
    }

    // Resolve prompt generator strategy
    const generator = resolvePromptGenerator(targetModel);

    // Get appropriate provider adapter
    const promptAdapter =
      generator === 'self'
        ? getProviderAdapter(targetModel)
        : getPromptGenerationAdapter();

    const runnerAdapter = getProviderAdapter(targetModel);

    // Generate new iteration ID
    const iterationId = `iter_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Create base iteration
    let iteration = createIteration(iterationId, task, targetModel);

    // Generate 10 refined candidate prompts using provider adapter with context
    const promptResult = await promptAdapter.generateCandidates(
      task,
      targetModel,
      10,
      {
        feedback: refineRequest.feedback,
        goal: task.goal,
      }
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
    console.error('Error in /api/iterations/refine:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
