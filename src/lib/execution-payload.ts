/**
 * Single source of truth for execution payload (Sprint 7 — minimal, deterministic).
 *
 * Payload contains only:
 * - prompt
 * - image field (name from detected_input_fields, fallback image_url)
 * - video field (name from detected_input_fields, fallback video_url)
 *
 * No params → providers use their defaults. Missing required asset → clear error.
 */

import type { ModelSpec } from '@/src/core/modelSpec';
import { modelSpecNeedsImage, modelSpecNeedsVideo } from '@/src/core/modelSpec';
import type { TaskAsset } from '@/src/core/types';
import type { CandidatePromptInputAssets } from '@/src/core/types';
import { isImageAssetKey, isVideoAssetKey } from '@/src/lib/modality-inference';

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
 * Find the actual field name for image input from detected_input_fields.
 * Falls back to 'image_url' if no detected field.
 */
function resolveImageFieldName(detectedFields?: string[]): string {
  if (detectedFields?.length) {
    const imageField = detectedFields.find((f) => isImageAssetKey(f));
    if (imageField) return imageField;
  }
  return 'image_url';
}

/**
 * Find the actual field name for video input from detected_input_fields.
 * Falls back to 'video_url' if no detected field.
 */
function resolveVideoFieldName(detectedFields?: string[]): string {
  if (detectedFields?.length) {
    const videoField = detectedFields.find((f) => isVideoAssetKey(f));
    if (videoField) return videoField;
  }
  return 'video_url';
}

/**
 * Determine if a field name expects an array value (e.g. image_urls, video_urls).
 */
function fieldExpectsArray(fieldName: string): boolean {
  return fieldName.endsWith('_urls') || fieldName.endsWith('s_url');
}

/**
 * Build minimal execution payload: prompt + image/video fields using correct field names per model.
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
    const fieldName = resolveImageFieldName(modelSpec.detected_input_fields);
    payload[fieldName] = fieldExpectsArray(fieldName) ? [url] : url;
  }

  if (modelSpecNeedsVideo(modelSpec)) {
    const url = resolveVideoUrl(taskAssets, inputAssets);
    if (url === undefined) {
      throw new Error('Video required.');
    }
    const fieldName = resolveVideoFieldName(modelSpec.detected_input_fields);
    payload[fieldName] = fieldExpectsArray(fieldName) ? [url] : url;
  }

  return payload;
}
