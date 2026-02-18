/**
 * Single source of truth for execution payload (Sprint 7 — minimal, deterministic).
 *
 * Payload contains only:
 * - prompt
 * - image_url (when required_assets needs image)
 * - video_url (when required_assets needs video)
 *
 * No params → providers use their defaults. Missing required asset → clear error.
 */

import type { ModelSpec } from '@/src/core/modelSpec';
import { modelSpecNeedsImage, modelSpecNeedsVideo } from '@/src/core/modelSpec';
import type { TaskAsset } from '@/src/core/types';
import type { CandidatePromptInputAssets } from '@/src/core/types';

export interface BuildExecutionPayloadInput {
  modelSpec: ModelSpec;
  prompt: string;
  taskAssets?: TaskAsset[];
  inputAssets?: CandidatePromptInputAssets;
}

/**
 * Resolve image URL from taskAssets or inputAssets (candidate overrides task).
 */
function resolveImageUrl(
  taskAssets: TaskAsset[],
  inputAssets: CandidatePromptInputAssets | undefined
): string | undefined {
  if (inputAssets?.image ?? inputAssets?.image_url ?? inputAssets?.input_image) {
    return (inputAssets.image ?? inputAssets.image_url ?? inputAssets.input_image) as string;
  }
  const img = taskAssets.find((a) => a.type === 'image');
  return img?.url;
}

/**
 * Resolve video URL from taskAssets or inputAssets.
 */
function resolveVideoUrl(
  taskAssets: TaskAsset[],
  inputAssets: CandidatePromptInputAssets | undefined
): string | undefined {
  if (inputAssets?.video ?? inputAssets?.video_url ?? inputAssets?.input_video) {
    return (inputAssets.video ?? inputAssets.video_url ?? inputAssets.input_video) as string;
  }
  const vid = taskAssets.find((a) => a.type === 'video');
  return vid?.url;
}

/**
 * Build minimal execution payload: prompt + image_url/video_url only when required_assets needs them.
 */
export function buildExecutionPayload(
  input: BuildExecutionPayloadInput
): Record<string, unknown> {
  const { modelSpec, prompt, taskAssets = [], inputAssets = {} } = input;
  const payload: Record<string, unknown> = { prompt };

  if (modelSpecNeedsImage(modelSpec)) {
    const url = resolveImageUrl(taskAssets, inputAssets);
    if (url === undefined) {
      throw new Error('Image required.');
    }
    payload.image_url = url;
  }

  if (modelSpecNeedsVideo(modelSpec)) {
    const url = resolveVideoUrl(taskAssets, inputAssets);
    if (url === undefined) {
      throw new Error('Video required.');
    }
    payload.video_url = url;
  }

  return payload;
}
