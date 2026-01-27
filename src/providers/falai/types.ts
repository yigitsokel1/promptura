/**
 * Fal.ai provider specific types
 */

export interface FalAIConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FalAIRequest {
  modelId: string;
  prompt: string;
  inputs?: {
    image?: string;
    text?: string;
  };
}

export interface FalAIResponse {
  output: string;
  latencyMs?: number;
  raw?: unknown;
}
