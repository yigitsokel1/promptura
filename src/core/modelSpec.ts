/**
 * ModelSpec types (Sprint 7 — mostly param-free).
 * Spec holds modality/required_assets/guidelines plus minimal safe execution hints
 * (e.g. required_input_defaults, optional aspect ratio options/default).
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
  /** Asset-related schema property names that contributed to required_assets (e.g. ['image_urls']). Used at execution to send the correct field name. */
  detected_input_fields?: string[];
  /**
   * Provider-specific defaults for required input params (e.g. EachLabs quality, duration).
   * Filled at research from provider request_schema; only that provider uses these at execution.
   */
  required_input_defaults?: Record<string, unknown>;
  /** Optional aspect ratio options parsed from provider schema for text-to-video UX. */
  aspect_ratio_options?: string[];
  /** Optional provider/default aspect ratio (e.g. 16:9). */
  aspect_ratio_default?: string;
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
