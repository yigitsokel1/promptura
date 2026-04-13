import type { Modality } from '@/src/core/types';

/**
 * Phase-1 rollout policy for video modalities.
 * We currently run only text-to-video; image/video conditioned video is deferred.
 */
const DEFERRED_VIDEO_MODALITIES: ReadonlySet<Modality> = new Set([
  'image-to-video',
  'video-to-video',
]);

export function isDeferredVideoModality(modality: Modality): boolean {
  return DEFERRED_VIDEO_MODALITIES.has(modality);
}

export function videoRolloutErrorMessage(modality: Modality): string {
  return `Modality "${modality}" is not enabled yet. This phase supports only text-to-video for video generation models.`;
}
