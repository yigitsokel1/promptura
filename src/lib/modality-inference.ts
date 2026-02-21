/**
 * Domain logic: infer required_assets from schema property keys and build Modality.
 * Shared by fal, eachlabs, and future providers; no provider-specific logic here.
 * Strong match: allowlist + suffix/full-name, denylist to avoid image_size / num_images (T2I stays T2I).
 */

import type { Modality } from '@/src/core/types';
import type { RequiredAssets } from '@/src/core/modelSpec';

const L = (s: string) => s.toLowerCase();

/** Key must contain one of these (for image asset). */
const IMAGE_ALLOWLIST = ['image', 'img', 'mask', 'control', 'init', 'reference', 'ref', 'source'];
/** Key must contain one of these (for video asset). */
const VIDEO_ALLOWLIST = ['video', 'vid'];
/** Key must have one of these as suffix/segment (or be full field name below). */
const ASSET_SUFFIXES = ['url', 'uri', 'file', 'data', 'base64', 'bytes'];
/** If key contains any of these, it is not an asset (e.g. image_size, num_images). */
const DENYLIST = ['size', 'width', 'height', 'count', 'num', 'format', 'quality', 'steps', 'scale'];

/**
 * Strong match: image asset key (init_image, image_url, mask_image_url, control_image).
 * Excludes image_size, num_images, etc.
 */
export function isImageAssetKey(key: string): boolean {
  const k = L(key);
  if (DENYLIST.some((term) => k.includes(term))) return false;
  if (!IMAGE_ALLOWLIST.some((term) => k.includes(term))) return false;
  if (ASSET_SUFFIXES.some((s) => k.includes(s))) return true;
  if (k === 'image' || k === 'img') return true;
  if (k.endsWith('_image') && IMAGE_ALLOWLIST.some((term) => k.includes(term))) return true;
  return false;
}

/**
 * Strong match: video asset key (video_url, input_video, etc.).
 */
export function isVideoAssetKey(key: string): boolean {
  const k = L(key);
  if (DENYLIST.some((term) => k.includes(term))) return false;
  if (!VIDEO_ALLOWLIST.some((term) => k.includes(term))) return false;
  if (ASSET_SUFFIXES.some((s) => k.includes(s))) return true;
  if (k === 'video' || k === 'vid') return true;
  if (k.endsWith('_video') && VIDEO_ALLOWLIST.some((term) => k.includes(term))) return true;
  return false;
}

function setHasStrongMatch(keys: Set<string>): { needsImage: boolean; needsVideo: boolean } {
  let needsImage = false;
  let needsVideo = false;
  for (const key of keys) {
    if (isImageAssetKey(key)) needsImage = true;
    if (isVideoAssetKey(key)) needsVideo = true;
  }
  return { needsImage, needsVideo };
}

export interface InferRequiredAssetsOptions {
  /**
   * When present, only properties in this list count as required.
   * When absent (MVP): any property present counts as required (fewer false-negatives).
   */
  required?: string[];
}

/**
 * Infers required input assets from API/schema property keys.
 * Use when you have request schema property names (e.g. from EachLabs request_schema.properties or Fal OpenAPI).
 *
 * MVP: If options.required is not provided, any image/video property present counts as required.
 * Improvement: If options.required is provided (from schema required array), only keys in that list count.
 * Supports image+video: when both image and video keys are required, returns 'image+video'.
 *
 * @param keys - All property names (e.g. ['prompt', 'image_url', 'num_inference_steps'])
 * @param options - Optional: pass required array from schema to respect optional vs required
 * @returns RequiredAssets
 */
export function inferRequiredAssetsFromPropertyKeys(
  keys: string[],
  options?: InferRequiredAssetsOptions
): RequiredAssets {
  if (!keys.length) return 'none';
  const effectiveKeys =
    options?.required != null && Array.isArray(options.required)
      ? keys.filter((k) => options.required!.includes(k))
      : keys;
  if (!effectiveKeys.length) return 'none';

  const compute = (keyList: string[]) => setHasStrongMatch(new Set(keyList));

  let { needsImage, needsVideo } = compute(effectiveKeys);
  if (!needsImage && !needsVideo && keys.length > 0) {
    const fallback = compute(keys);
    needsImage = fallback.needsImage;
    needsVideo = fallback.needsVideo;
  }

  if (needsImage && needsVideo) return 'image+video';
  if (needsImage) return 'image';
  if (needsVideo) return 'video';
  return 'none';
}

/**
 * Combines output type and required input assets into a full Modality.
 * Use after you know what the model outputs (text/image/video) and what inputs it needs (RequiredAssets).
 *
 * @param output - What the model produces: 'text' | 'image' | 'video'
 * @param assets - Required input assets (from inferRequiredAssetsFromPropertyKeys or metadata)
 * @returns Modality
 */
export function combineOutputAndAssetsToModality(
  output: 'text' | 'image' | 'video',
  assets: RequiredAssets
): Modality {
  if (output === 'text') return 'text-to-text';
  if (output === 'image') {
    if (assets === 'none') return 'text-to-image';
    return 'image-to-image';
  }
  // output === 'video'
  if (assets === 'none') return 'text-to-video';
  if (assets === 'video') return 'video-to-video';
  // assets === 'image' || assets === 'image+video'
  return 'image-to-video';
}
