/**
 * Prompt Strategy Resolver
 * Determines which generator to use based on target model capabilities.
 * Rule: If target model supports prompt-generation → 'self', otherwise → 'gemini-fallback'
 */

import type { ModelRef } from '../types';

export type PromptGenerator = 'self' | 'gemini-fallback';

/**
 * Models that support prompt generation natively
 * Format: "provider:modelId"
 */
const PROMPT_CAPABLE_MODELS = new Set<string>([
  // Gemini models that can generate prompts
  'google:gemini-2.0-flash-exp',
  'google:gemini-1.5-pro',
  'google:gemini-1.5-flash',
  'google:gemini-nano',
  // Add other prompt-capable models as needed
  // 'falai:fal-ai/model-name',
  // 'openai:gpt-4',
]);

/**
 * Checks if a model supports prompt generation
 */
function isPromptCapable(model: ModelRef): boolean {
  const key = `${model.provider}:${model.modelId}`;
  return PROMPT_CAPABLE_MODELS.has(key);
}

/**
 * Resolves the prompt generator strategy for a given model
 * 
 * @param targetModel - The model reference to check
 * @returns 'self' if model supports prompt generation, 'gemini-fallback' otherwise
 */
export function resolvePromptGenerator(targetModel: ModelRef): PromptGenerator {
  if (isPromptCapable(targetModel)) {
    return 'self';
  }
  return 'gemini-fallback';
}

/**
 * Future: Resolve generator from provider adapter capabilities
 * This allows dynamic capability checking when provider adapters are implemented
 */
export interface ModelCapabilities {
  supportsPromptGeneration: boolean;
}

/**
 * Resolves generator from explicit capabilities (for future use with provider adapters)
 */
export function resolvePromptGeneratorFromCapabilities(
  capabilities: ModelCapabilities
): PromptGenerator {
  if (capabilities.supportsPromptGeneration) {
    return 'self';
  }
  return 'gemini-fallback';
}
