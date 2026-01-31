import { NextRequest, NextResponse } from 'next/server';
import type { TaskSpec, ModelRef } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { createIteration, addCandidates, addResults } from '@/src/core/iteration/iteration';
import { generateIterationId } from '@/src/core/iteration/id-generator';
import { getProviderAdapter, getPromptGenerationAdapter } from '@/src/providers';
import { findModelEndpointWithSpecOnly } from '@/src/db/queries';
import { handleApiError, sourceToProvider } from '@/src/lib/api-helpers';

interface GenerateRequest {
  task: TaskSpec;
  modelEndpointId: string; // DB ModelEndpoint ID
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();

    if (!body.task || !body.modelEndpointId) {
      return NextResponse.json(
        { error: 'Missing required fields: task, modelEndpointId' },
        { status: 400 }
      );
    }

    const { task, modelEndpointId } = body;

    // Fetch ModelEndpoint with latest ModelSpec from DB
    const modelEndpoint = await findModelEndpointWithSpecOnly(modelEndpointId);

    if (!modelEndpoint) {
      return NextResponse.json(
        { error: `Model endpoint not found: ${modelEndpointId}` },
        { status: 404 }
      );
    }

    // Check if model has a spec
    if (!modelEndpoint.modelSpecs || modelEndpoint.modelSpecs.length === 0) {
      return NextResponse.json(
        { 
          error: 'Model spec not ready',
          code: 'SpecNotReady',
          modelEndpointId: modelEndpoint.id,
          status: modelEndpoint.status,
        },
        { status: 409 }
      );
    }

    // Check if model is active
    if (modelEndpoint.status !== 'active') {
      return NextResponse.json(
        { 
          error: `Model is not active (status: ${modelEndpoint.status})`,
          modelEndpointId: modelEndpoint.id,
          status: modelEndpoint.status,
        },
        { status: 400 }
      );
    }

    // Build ModelRef from ModelEndpoint
    const targetModel: ModelRef = {
      provider: sourceToProvider(modelEndpoint.source),
      modelId: modelEndpoint.endpointId,
    };

    // Get ModelSpec from the latest spec
    const latestSpec = modelEndpoint.modelSpecs[0];
    if (!latestSpec || !latestSpec.specJson) {
      return NextResponse.json(
        { error: 'Model spec data is missing' },
        { status: 500 }
      );
    }
    const modelSpec = latestSpec.specJson as ModelSpec;

    // Always use Gemini for prompt generation (Sprint 3)
    const promptAdapter = getPromptGenerationAdapter();
    const runnerAdapter = getProviderAdapter(targetModel);

    // Generate iteration ID
    const iterationId = generateIterationId();

    // Create base iteration
    let iteration = createIteration(iterationId, task, targetModel);

    // Generate candidate prompts using Gemini with ModelSpec
    // Priority: TEST_CANDIDATE_COUNT > TEST_MODE > default (20)
    // If TEST_CANDIDATE_COUNT is set, use it regardless of TEST_MODE
    let candidateCount = 20; // default
    if (process.env.TEST_CANDIDATE_COUNT) {
      candidateCount = parseInt(process.env.TEST_CANDIDATE_COUNT, 10);
      if (isNaN(candidateCount) || candidateCount < 1) {
        console.warn(`Invalid TEST_CANDIDATE_COUNT: ${process.env.TEST_CANDIDATE_COUNT}, using default 20`);
        candidateCount = 20;
      }
    } else if (process.env.TEST_MODE === 'true') {
      candidateCount = 5; // TEST_MODE default
    }
    
    console.log(`[Generate] Using candidate count: ${candidateCount} (TEST_CANDIDATE_COUNT=${process.env.TEST_CANDIDATE_COUNT}, TEST_MODE=${process.env.TEST_MODE})`);
    
    const promptResult = await promptAdapter.generateCandidates(
      task,
      targetModel,
      candidateCount,
      {
        goal: task.goal,
        modelSpec,
      }
    );
    console.log(`[Generate] Gemini returned ${promptResult.candidates.length} candidates`);

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
    console.log(`[Generate] Jobs submitted for iteration ${iterationId}`);

    // Return iteration with pending status (UI will poll /api/iterations/[id]/status)
    return NextResponse.json({
      ...iteration,
      status: 'pending', // Indicates jobs are submitted, results pending
    });
  } catch (error) {
    return handleApiError(error, '/api/iterations/generate');
  }
}
