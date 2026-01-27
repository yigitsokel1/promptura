/**
 * Core domain types for PromptAura
 * These types define the contract between UI, providers, and core logic.
 */

export type Modality = 'text-to-text' | 'text-to-image';

export interface TaskSpec {
  goal: string;
  modality: Modality;
  inputs?: {
    image?: string; // base64 or URL
    text?: string;
  };
}

export interface ModelRef {
  provider: 'falai' | 'google' | 'openai';
  modelId: string;
}

export interface CandidatePrompt {
  id: string;
  prompt: string;
  generator: 'self' | 'gemini-fallback';
}

export interface RunResult {
  candidateId: string;
  outputText: string;
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
