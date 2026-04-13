import { NextRequest, NextResponse } from 'next/server';
import type { TaskSpec, ModelRef } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { modelSpecNeedsImage, modelSpecNeedsVideo } from '@/src/core/modelSpec';
import { createIteration, addCandidates } from '@/src/core/iteration/iteration';
import { generateIterationId } from '@/src/core/iteration/id-generator';
import { getProviderAdapter, getPromptGenerationAdapter } from '@/src/providers';
import { findModelEndpointWithSpecOnly, findRunsByIterationId, createIterationRecord } from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import { buildRefineContext } from '@/src/lib/gemini/refineContext';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';
import { requireUserProviderKey, type ProviderSlug } from '@/src/lib/provider-keys';
import { supportsModality } from '@/src/lib/provider-capabilities';
import type { ExecutionProviderSlug } from '@/src/providers/execution';

interface RefineRequestBody {
  task: TaskSpec;
  modelEndpointId: string; // DB ModelEndpoint ID to fetch ModelSpec
  previousIterationId: string; // Previous iteration ID to get feedback from
  feedback: Array<{
    candidateId: string;
    note?: string;
    selected: boolean;
  }>;
  /** Selected prompts with text so Gemini can evolve them (Contract v2). Must match selected feedback items. */
  selectedPrompts?: Array<{ candidateId: string; prompt: string; note?: string }>;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session) return unauthorizedResponse();

    const body: RefineRequestBody = await request.json();

    if (!body.task || !body.modelEndpointId || !body.previousIterationId || !body.feedback) {
      return NextResponse.json(
        { error: 'Missing required fields: task, modelEndpointId, previousIterationId, feedback' },
        { status: 400 }
      );
    }

    const { task, modelEndpointId, previousIterationId, feedback, selectedPrompts: bodySelectedPrompts } = body;

    // Get selected feedback items
    const selectedFeedback = feedback.filter((item) => item.selected);
    
    if (selectedFeedback.length === 0) {
      return NextResponse.json(
        { error: 'At least one feedback item must be selected' },
        { status: 400 }
      );
    }

    const previousRuns = await findRunsByIterationId(previousIterationId).catch(() => []);
    const selectedForTemplate = buildRefineContext(
      selectedFeedback,
      bodySelectedPrompts,
      previousRuns.map((r) => ({
        candidateId: r.candidateId,
        outputJson: r.outputJson,
      }))
    );

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

    // Sprint 7: fail fast when required asset is missing
    const taskAssets = task.assets ?? [];
    if (modelSpecNeedsImage(modelSpec) && !taskAssets.some((a) => a.type === 'image')) {
      return NextResponse.json(
        { error: 'Image required.', code: 'AssetRequired', required: 'image' },
        { status: 400 }
      );
    }
    if (modelSpecNeedsVideo(modelSpec) && !taskAssets.some((a) => a.type === 'video')) {
      return NextResponse.json(
        { error: 'Video required.', code: 'AssetRequired', required: 'video' },
        { status: 400 }
      );
    }

    // Build ModelRef from ModelEndpoint (Blok C: use provider for execution)
    const targetModel: ModelRef = {
      provider: modelEndpoint.provider as ModelRef['provider'],
      modelId: modelEndpoint.endpointId,
    };

    if (targetModel.provider === 'falai' || targetModel.provider === 'eachlabs') {
      const providerSlug = targetModel.provider as ExecutionProviderSlug;
      if (!supportsModality(providerSlug, task.modality)) {
        return NextResponse.json(
          {
            error: `Provider ${targetModel.provider} does not support modality "${task.modality}".`,
            code: 'ModalityNotSupported',
            provider: targetModel.provider,
            modality: task.modality,
          },
          { status: 400 }
        );
      }
    }

    // Blok D: user provider key for falai/eachlabs
    let userApiKey: string | undefined;
    if (targetModel.provider === 'falai' || targetModel.provider === 'eachlabs') {
      try {
        userApiKey = await requireUserProviderKey(
          session.user.id,
          targetModel.provider as ProviderSlug
        );
      } catch {
        return NextResponse.json(
          { error: 'Missing provider API key. Add your key in Settings → Provider keys.', code: 'MissingProviderKey' },
          { status: 400 }
        );
      }
    }

    // Always use Gemini for prompt generation (Sprint 3)
    const promptAdapter = getPromptGenerationAdapter();
    const runnerAdapter = getProviderAdapter(targetModel, { apiKey: userApiKey });

    // Generate new iteration ID
    const iterationId = generateIterationId();

    // Create base iteration (Blok D: userId in context for status polling)
    let iteration = createIteration(iterationId, task, targetModel);
    await createIterationRecord({
      id: iterationId,
      modelEndpointId,
      userId: session.user.id,
    }).catch((err) =>
      console.warn('[Refine] Iteration record create failed (observability):', err)
    );

    // Generate 10 refined candidate prompts using Gemini (Contract v2: evolve from selected prompts)
    const promptResult = await promptAdapter.generateCandidates(
      task,
      targetModel,
      10,
      {
        feedback: feedback.filter((f) => f.selected),
        selectedPrompts: selectedForTemplate,
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
