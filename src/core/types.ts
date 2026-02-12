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

export interface TaskSpec {
  goal: string;
  modality: Modality;
  inputs?: {
    image?: string; // base64 or URL
    video?: string; // base64 or URL
    text?: string;
  };
}

export interface ModelRef {
  provider: 'falai' | 'google' | 'openai' | 'eachlabs';
  modelId: string;
}

/**
 * Parameters for a candidate prompt (steps, cfg, seed, etc.)
 * Based on ModelSpec inputs, but flexible for any key-value pairs
 */
export interface CandidatePromptParams {
  [key: string]: string | number | boolean | string[] | undefined;
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
 * Candidate prompt with full parameter support
 * Can carry prompt text, model parameters, and input assets.
 * reasoning and tags come from Gemini Contract v2 (optional; used for quality/UX later).
 */
export interface CandidatePrompt {
  id: string;
  prompt: string; // Main prompt text
  params?: CandidatePromptParams; // Model-specific parameters (steps, cfg, seed, etc.)
  inputAssets?: CandidatePromptInputAssets; // Input media assets if needed
  generator: 'self' | 'gemini-fallback';
  /** Why this prompt is effective (Gemini Contract v2; optional) */
  reasoning?: string;
  /** Tags e.g. style, motion, lighting (Gemini Contract v2; optional) */
  tags?: string[];
}

/**
 * Text output result
 */
export interface TextOutput {
  type: 'text';
  text: string;
}

/**
 * Image output result
 */
export interface ImageOutput {
  type: 'image';
  images: Array<{ url: string }>;
}

/**
 * Video output result
 */
export interface VideoOutput {
  type: 'video';
  videos: Array<{ url: string }>;
}

/**
 * Union type for all possible output types
 */
export type RunOutput = TextOutput | ImageOutput | VideoOutput;

/**
 * Run result with media-ready output
 * Supports text, image, and video outputs based on model capabilities
 */
export interface RunResult {
  candidateId: string;
  output: RunOutput;
  meta?: {
    latencyMs?: number;
    raw?: unknown;
  };
}

export interface Iteration {
  id: string;
  task: TaskSpec;
  targetModel: ModelRef;
  candidates: CandidatePrompt[];
  results: RunResult[];
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
