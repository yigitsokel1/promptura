/**
 * ModelSpec types
 * These define the structure of the JSON spec that Gemini generates
 */

export interface ModelInputSpec {
  name: string;
  type: string; // "string" | "number" | "boolean" | "image" | etc.
  required: boolean;
  min?: number;
  max?: number;
  default?: unknown;
  description?: string;
}

export interface ModelOutputSpec {
  type: string; // "text" | "image" | "video" | "audio"
  format: string; // "string" | "url" | "url[]" | "base64" | etc.
  description?: string;
}

export interface RecommendedRange {
  [paramName: string]: [number, number]; // [min, max] tuple
}

export interface ModelSpec {
  inputs: ModelInputSpec[];
  outputs: ModelOutputSpec;
  recommended_ranges?: RecommendedRange;
  prompt_guidelines: string[];
  workflow_steps?: Array<{
    step: number;
    description: string;
    inputs?: string[];
    outputs?: string[];
  }>;
  summary?: string; // How the model works
}
