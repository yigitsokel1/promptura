import { NextRequest, NextResponse } from 'next/server';
import type { TaskSpec, ModelRef } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { createIteration, addCandidates } from '@/src/core/iteration/iteration';
import { generateIterationId } from '@/src/core/iteration/id-generator';
import { getProviderAdapter, getPromptGenerationAdapter } from '@/src/providers';
import { findModelEndpointWithSpecOnly, createIterationRecord } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';
import { requireUserProviderKey, type ProviderSlug } from '@/src/lib/provider-keys';
import { checkRateLimit, getRateLimitMax, getRateLimitWindowMs } from '@/src/lib/rate-limit';

interface GenerateRequest {
  task: TaskSpec;
  modelEndpointId: string; // DB ModelEndpoint ID
}

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return unauthorizedResponse();

  if (!checkRateLimit(session.user.id)) {
    const windowSec = Math.ceil(getRateLimitWindowMs() / 1000);
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Max ${getRateLimitMax()} requests per ${windowSec}s.`,
        code: 'RateLimitExceeded',
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(windowSec),
        },
      }
    );
  }

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

    // Build ModelRef from ModelEndpoint (Blok C: use provider for execution)
    const targetModel: ModelRef = {
      provider: modelEndpoint.provider as ModelRef['provider'],
      modelId: modelEndpoint.endpointId,
    };

    // Blok B: user provider key (required for falai/eachlabs; Gemini stays system)
    let userApiKey: string | undefined;
    if (targetModel.provider === 'falai' || targetModel.provider === 'eachlabs') {
      try {
        userApiKey = await requireUserProviderKey(
          session.user.id,
          targetModel.provider as ProviderSlug
        );
      } catch (keyError) {
        const msg = keyError instanceof Error ? keyError.message : 'Missing provider API key';
        return NextResponse.json({ error: msg, code: 'MissingProviderKey' }, { status: 400 });
      }
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

    // Always use Gemini for prompt generation (Sprint 3)
    const promptAdapter = getPromptGenerationAdapter();
    const runnerAdapter = getProviderAdapter(targetModel, { apiKey: userApiKey });

    // Generate iteration ID
    const iterationId = generateIterationId();

    // Create base iteration (Blok B: store userId for status polling)
    let iteration = createIteration(iterationId, task, targetModel);
    await createIterationRecord({
      id: iterationId,
      modelEndpointId,
      userId: session.user.id,
    }).catch((err) =>
      console.warn('[Generate] Iteration record create failed (observability):', err)
    );

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
