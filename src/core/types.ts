/**
 * Core domain types for Promptura
 * These types define the contract between UI, providers, and core logic.
 */

export type Modality =
  | 'text-to-text'
  | 'text-to-image'
  | 'image-to-image'
  | 'image-to-video'
  | 'text-to-video'
  | 'video-to-video';

/** Task input asset (image/video URL or base64) for image-to-image, image-to-video, etc. */
export interface TaskAsset {
  type: 'image' | 'video';
  url: string;
}

export interface TaskSpec {
  goal: string;
  modality: Modality;
  /** Input assets for multi-modal tasks (image-to-image, image-to-video, video-to-video) */
  assets?: TaskAsset[];
  /**
   * @deprecated Use assets instead. Kept for backward compatibility during migration.
   */
  inputs?: {
    image?: string;
    video?: string;
    text?: string;
  };
}

export interface ModelRef {
  provider: 'falai' | 'google' | 'openai' | 'eachlabs';
  modelId: string;
}

/**
 * Input assets for a candidate prompt (images, videos, etc.)
 * Used when the model requires input media (e.g., image-to-image, image-to-video, video-to-video)
 */
export interface CandidatePromptInputAssets {
  image?: string; // base64 or URL
  video?: string; // base64 or URL
  [key: string]: string | undefined; // Allow other asset types
}

/**
 * Candidate prompt (prompt text + optional input assets).
 * Params removed — payload uses ModelSpec defaults.
 * reasoning and tags come from Gemini Contract v2 (optional; used for quality/UX later).
 */
export interface CandidatePrompt {
  id: string;
  prompt: string; // Main prompt text
  inputAssets?: CandidatePromptInputAssets; // Input media assets if needed
  generator: 'self' | 'gemini-fallback';
  /** Why this prompt is effective (Gemini Contract v2; optional) */
  reasoning?: string;
  /** Tags e.g. style, motion, lighting (Gemini Contract v2; optional) */
  tags?: string[];
}

/**
 * Single output asset — modality-agnostic.
 * Run results are arrays of these.
 */
export type OutputAsset =
  | { type: 'text'; content: string }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string };

/**
 * Run result — modality-agnostic.
 * All outputs (text, images, videos) are normalized to assets array.
 */
export interface RunResult {
  candidateId: string;
  assets: OutputAsset[];
  metadata?: {
    latencyMs?: number;
    raw?: unknown;
  };
}

/* --- Legacy types: kept for migration, convert via runOutputToAssets --- */

/** @deprecated Use OutputAsset[] / RunResult.assets instead */
export interface TextOutput {
  type: 'text';
  text: string;
}

/** @deprecated Use OutputAsset[] instead */
export interface ImageOutput {
  type: 'image';
  images: Array<{ url: string }>;
}

/** @deprecated Use OutputAsset[] instead */
export interface VideoOutput {
  type: 'video';
  videos: Array<{ url: string }>;
}

/** @deprecated Use RunResult.assets (OutputAsset[]) instead */
export type RunOutput = TextOutput | ImageOutput | VideoOutput;

/** Convert legacy RunOutput to OutputAsset[] for backward compatibility */
export function runOutputToAssets(output: RunOutput | null | undefined): OutputAsset[] {
  if (!output) return [];
  switch (output.type) {
    case 'text':
      return output.text ? [{ type: 'text', content: output.text }] : [];
    case 'image':
      return (output.images ?? []).map((img) => ({ type: 'image' as const, url: img.url }));
    case 'video':
      return (output.videos ?? []).map((vid) => ({ type: 'video' as const, url: vid.url }));
    default:
      return [];
  }
}

/** Convert OutputAsset[] to legacy RunOutput (for DB/storage migration period) */
export function assetsToRunOutput(assets: OutputAsset[]): RunOutput | null {
  if (assets.length === 0) return null;
  const texts = assets.filter((a): a is OutputAsset & { type: 'text' } => a.type === 'text');
  const images = assets.filter((a): a is OutputAsset & { type: 'image' } => a.type === 'image');
  const videos = assets.filter((a): a is OutputAsset & { type: 'video' } => a.type === 'video');
  if (images.length > 0) return { type: 'image', images: images.map((i) => ({ url: i.url })) };
  if (videos.length > 0) return { type: 'video', videos: videos.map((v) => ({ url: v.url })) };
  if (texts.length > 0) return { type: 'text', text: texts.map((t) => t.content).join('\n') };
  return null;
}

/** Normalize stored outputJson (legacy RunOutput or new { assets }) to OutputAsset[] */
export function normalizeStoredOutputToAssets(outputJson: unknown): OutputAsset[] {
  if (!outputJson || typeof outputJson !== 'object') return [];
  const obj = outputJson as Record<string, unknown>;
  if (Array.isArray(obj.assets)) {
    return obj.assets as OutputAsset[];
  }
  return runOutputToAssets(obj as unknown as RunOutput);
}

export interface Iteration {
  id: string;
  task: TaskSpec;
  targetModel: ModelRef;
  candidates: CandidatePrompt[];
  results: RunResult[]; // RunResult.assets holds OutputAsset[]
}

export interface FeedbackItem {
  candidateId: string;
  note?: string;
  selected: boolean;
}

export interface RefineRequest {
  iterationId: string;
  feedback: FeedbackItem[];
}
