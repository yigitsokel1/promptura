import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import type { TaskSpec, ModelRef } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { modelSpecNeedsImage, modelSpecNeedsVideo } from '@/src/core/modelSpec';
import { generateIterationId } from '@/src/core/iteration/id-generator';
import { getProviderAdapter, getPromptGenerationAdapter } from '@/src/providers';
import {
  findModelEndpointWithSpecOnly,
  createIterationRecord,
  updateIterationWithCandidates,
  updateIterationError,
} from '@/src/db/queries';
import { handleApiError } from '@/src/lib/api-helpers';
import { taskJsonForStorage } from '@/src/lib/task-assets';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';
import { requireUserProviderKey, type ProviderSlug } from '@/src/lib/provider-keys';
import { checkRateLimit, getRateLimitMax, getRateLimitWindowMs } from '@/src/lib/rate-limit';
import { supportsModality } from '@/src/lib/provider-capabilities';
import type { ExecutionProviderSlug } from '@/src/providers/execution';

interface GenerateRequest {
  task: TaskSpec;
  modelEndpointId: string; // DB ModelEndpoint ID
}

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return unauthorizedResponse();

  if (!(await checkRateLimit(session.user.id))) {
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
    let body: GenerateRequest;
    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      // FormData: image sent as file to avoid JSON body size limit
      const formData = await request.formData();
      const taskJson = formData.get('task');
      const modelEndpointIdRaw = formData.get('modelEndpointId');
      const imageFile = formData.get('image') as File | null;

      if (!taskJson || typeof taskJson !== 'string' || !modelEndpointIdRaw || typeof modelEndpointIdRaw !== 'string') {
        return NextResponse.json(
          { error: 'Missing required fields: task, modelEndpointId' },
          { status: 400 }
        );
      }

      const taskFromJson = JSON.parse(taskJson) as TaskSpec;
      const assets: TaskSpec['assets'] = [...(taskFromJson.assets ?? [])];

      if (imageFile && imageFile.size > 0) {
        const buf = await imageFile.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        const mime = imageFile.type || 'image/jpeg';
        assets.push({ type: 'image', url: `data:${mime};base64,${base64}` });
      }

      body = {
        task: { ...taskFromJson, assets: assets.length > 0 ? assets : undefined },
        modelEndpointId: modelEndpointIdRaw.trim(),
      };
    } else {
      try {
        body = await request.json();
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        if (msg.includes('Unterminated string') || msg.includes('JSON')) {
          return NextResponse.json(
            {
              error:
                'Request body is too large or was truncated (Next.js limits request size). For large images or video, use a URL instead of base64, or reduce the file size.',
              code: 'PayloadTooLarge',
            },
            { status: 413 }
          );
        }
        throw parseErr;
      }
    }

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

    // Blok E: Provider capability check — model modality must match provider supports
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

    // Sprint 7: fail fast when required asset is missing (return 400, not background error)
    const taskAssets = task.assets ?? [];
    if (modelSpecNeedsImage(modelSpec)) {
      const hasImage = taskAssets.some((a) => a.type === 'image');
      if (!hasImage) {
        return NextResponse.json(
          { error: 'Image required.', code: 'AssetRequired', required: 'image' },
          { status: 400 }
        );
      }
    }
    if (modelSpecNeedsVideo(modelSpec)) {
      const hasVideo = taskAssets.some((a) => a.type === 'video');
      if (!hasVideo) {
        return NextResponse.json(
          { error: 'Video required.', code: 'AssetRequired', required: 'video' },
          { status: 400 }
        );
      }
    }

    // Always use Gemini for prompt generation (Sprint 3)
    const promptAdapter = getPromptGenerationAdapter();
    const runnerAdapter = getProviderAdapter(targetModel, { apiKey: userApiKey });

    // Generate iteration ID
    const iterationId = generateIterationId();

    // Candidate count
    let candidateCount = 20;
    if (process.env.TEST_CANDIDATE_COUNT) {
      candidateCount = parseInt(process.env.TEST_CANDIDATE_COUNT, 10);
      if (isNaN(candidateCount) || candidateCount < 1) candidateCount = 20;
    } else if (process.env.TEST_MODE === 'true') {
      candidateCount = 5;
    }

    // Create iteration record with task (storage-safe: no base64 in taskJson to avoid Prisma 5MB limit)
    await createIterationRecord({
      id: iterationId,
      modelEndpointId,
      userId: session.user.id,
      taskJson: taskJsonForStorage(task),
    }).catch((err) =>
      console.warn('[Generate] Iteration record create failed:', err)
    );

    // Run Gemini + fal.ai in background; client polls status and gets candidates when ready
    after(async () => {
      try {
        console.log(`[Generate] Background: using candidate count ${candidateCount}`);
        const t0 = Date.now();
        const promptResult = await promptAdapter.generateCandidates(task, targetModel, candidateCount, {
          goal: task.goal,
          modelSpec,
        });
        console.log(`[Generate] Background: Gemini returned ${promptResult.candidates.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

        await updateIterationWithCandidates(
          iterationId,
          promptResult.candidates.map((c) => ({
            id: c.id,
            prompt: c.prompt,
            generator: c.generator,
          }))
        );

        await runnerAdapter.runCandidates(task, targetModel, promptResult.candidates, {
          modelSpec,
          iterationId,
          modelEndpointId: modelEndpoint.id,
          submitOnly: true,
        });
        console.log(`[Generate] Background: jobs submitted for ${iterationId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Generate] Background failed for ${iterationId}:`, msg);
        await updateIterationError(iterationId, msg).catch(() => {});
      }
    });

    return NextResponse.json(
      {
        id: iterationId,
        task,
        targetModel,
        candidates: [],
        results: [],
        status: 'generating',
      },
      { status: 202 }
    );
  } catch (error) {
    return handleApiError(error, '/api/iterations/generate');
  }
}
