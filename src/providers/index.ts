/**
 * Provider registry and factory
 * Central entry point for getting provider adapters
 */

import type { ProviderAdapter } from './types';
import type { ModelRef } from '@/src/core/types';
import { FalAIAdapter, createFalAIAdapter } from './falai';
import { GeminiAdapter, createGeminiAdapter } from './gemini';
import { MockProviderAdapter } from './mock';

/**
 * Get provider adapter for a given model
 */
export function getProviderAdapter(model: ModelRef): ProviderAdapter {
  // Default to mock if not explicitly set to false
  const useMock = process.env.USE_MOCK_PROVIDERS !== 'false';

  if (useMock) {
    return new MockProviderAdapter();
  }

  switch (model.provider) {
    case 'falai':
      return createFalAIAdapter();
    case 'google':
      return createGeminiAdapter();
    case 'openai':
      // TODO: Implement OpenAI adapter
      throw new Error('OpenAI adapter not yet implemented');
    default:
      throw new Error(`Unknown provider: ${model.provider}`);
  }
}

/**
 * Get prompt generation adapter (for fallback scenarios)
 */
export function getPromptGenerationAdapter(): ProviderAdapter {
  // Default to mock if not explicitly set to false
  const useMock = process.env.USE_MOCK_PROVIDERS !== 'false';

  if (useMock) {
    return new MockProviderAdapter();
  }

  // Default to Gemini for prompt generation fallback
  return createGeminiAdapter();
}
