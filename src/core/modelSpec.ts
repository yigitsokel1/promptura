/**
 * ModelSpec types (Sprint 7 — param-free).
 * Spec holds only: modality, required_assets, prompt_guidelines, optional summary.
 * No inputs[], outputs, enums, min/max, or default.
 */

import type { Modality } from '@/src/core/types';

/** What input assets the model needs. Drives minimal payload (prompt + assets only). */
export type RequiredAssets = 'none' | 'image' | 'video' | 'image+video';

export interface ModelSpec {
  /** e.g. text-to-image, image-to-image, image-to-video, text-to-video, video-to-video */
  modality: Modality;
  /** Required input assets; "none" = prompt only */
  required_assets: RequiredAssets;
  /** Prompt writing guidelines for Gemini */
  prompt_guidelines: string[];
  /** Optional summary of how the model works */
  summary?: string;
}

/**
 * Result of Gemini research (Sprint 7 — guidelines only).
 * Research pipeline merges this with schema-derived modality + required_assets.
 */
export interface ResearchGuidelinesResult {
  prompt_guidelines: string[];
  summary?: string;
}

/** Output type implied by modality (for prompt text and output conversion). */
export function modelSpecOutputType(spec: ModelSpec): 'text' | 'image' | 'video' {
  switch (spec.modality) {
    case 'text-to-image':
    case 'image-to-image':
      return 'image';
    case 'image-to-video':
    case 'text-to-video':
    case 'video-to-video':
      return 'video';
    case 'text-to-text':
    default:
      return 'text';
  }
}

export function modelSpecNeedsImage(spec: ModelSpec): boolean {
  const r = spec.required_assets;
  return r === 'image' || r === 'image+video';
}

export function modelSpecNeedsVideo(spec: ModelSpec): boolean {
  const r = spec.required_assets;
  return r === 'video' || r === 'image+video';
}
