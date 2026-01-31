import { NextRequest, NextResponse } from 'next/server';
import type {
  TaskSpec,
  ModelRef,
} from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { createIteration, addCandidates } from '@/src/core/iteration/iteration';
import { generateIterationId } from '@/src/core/iteration/id-generator';
import { getProviderAdapter, getPromptGenerationAdapter } from '@/src/providers';
import { findModelEndpointWithSpecOnly, findRunsByIterationId } from '@/src/db/queries';
import { handleApiError, sourceToProvider } from '@/src/lib/api-helpers';

interface RefineRequestBody {
  task: TaskSpec;
  modelEndpointId: string; // DB ModelEndpoint ID to fetch ModelSpec
  previousIterationId: string; // Previous iteration ID to get feedback from
  feedback: Array<{
    candidateId: string;
    note?: string;
    selected: boolean;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const body: RefineRequestBody = await request.json();

    if (!body.task || !body.modelEndpointId || !body.previousIterationId || !body.feedback) {
      return NextResponse.json(
        { error: 'Missing required fields: task, modelEndpointId, previousIterationId, feedback' },
        { status: 400 }
      );
    }

    const { task, modelEndpointId, previousIterationId, feedback } = body;

    // Get selected feedback items
    const selectedFeedback = feedback.filter((item) => item.selected);
    
    if (selectedFeedback.length === 0) {
      return NextResponse.json(
        { error: 'At least one feedback item must be selected' },
        { status: 400 }
      );
    }

    // Fetch previous iteration runs to get selected candidates' prompts
    const previousRuns = await findRunsByIterationId(previousIterationId);
    
    // Build feedback with previous prompts for context
    const feedbackWithPrompts = feedback.map((item) => {
      const run = previousRuns.find((r) => r.candidateId === item.candidateId);
      return {
        ...item,
        previousPrompt: run?.outputJson 
          ? JSON.stringify(run.outputJson) 
          : undefined,
      };
    });

    // Fetch ModelEndpoint with latest ModelSpec from DB
    const modelEndpoint = await findModelEndpointWithSpecOnly(modelEndpointId);

    if (!modelEndpoint) {
      return NextResponse.json(
        { error: `Model endpoint not found: ${modelEndpointId}` },
        { status: 404 }
      );
    }

    // Get ModelSpec from the latest spec
    const latestSpec = modelEndpoint.modelSpecs[0];
    if (!latestSpec || !latestSpec.specJson) {
      return NextResponse.json(
        { error: 'Model spec data is missing' },
        { status: 500 }
      );
    }
    const modelSpec = latestSpec.specJson as ModelSpec;

    // Build ModelRef from ModelEndpoint
    const targetModel: ModelRef = {
      provider: sourceToProvider(modelEndpoint.source),
      modelId: modelEndpoint.endpointId,
    };

    // Always use Gemini for prompt generation (Sprint 3)
    const promptAdapter = getPromptGenerationAdapter();
    const runnerAdapter = getProviderAdapter(targetModel);

    // Generate new iteration ID
    const iterationId = generateIterationId();

    // Create base iteration
    let iteration = createIteration(iterationId, task, targetModel);

    // Generate 10 refined candidate prompts using Gemini with ModelSpec and feedback
    const promptResult = await promptAdapter.generateCandidates(
      task,
      targetModel,
      10,
      {
        feedback: feedbackWithPrompts,
        goal: task.goal,
        modelSpec,
      }
    );

    // Add candidates to iteration
    iteration = addCandidates(iteration, promptResult.candidates);

    // Submit jobs to queue (submitOnly mode - UI will poll for results)
    await runnerAdapter.runCandidates(
      task,
      targetModel,
      promptResult.candidates,
      {
        modelSpec,
        iterationId,
        modelEndpointId: modelEndpoint.id,
        submitOnly: true, // Don't block on polling - UI will poll
      }
    );

    // Return iteration with pending status (UI will poll /api/iterations/[id]/status)
    return NextResponse.json({
      ...iteration,
      status: 'pending', // Indicates jobs are submitted, results pending
    });
  } catch (error) {
    return handleApiError(error, '/api/iterations/refine');
  }
}
