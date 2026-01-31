/**
 * Provider registry and factory
 * Central entry point for getting provider adapters
 */

import type { ProviderAdapter } from './types';
import type { ModelRef } from '@/src/core/types';
import { createFalAIAdapter } from './falai';
import { createGeminiAdapter } from './gemini';
import { MockProviderAdapter } from './mock';

/**
 * Get provider adapter for a given model
 */
export function getProviderAdapter(model: ModelRef): ProviderAdapter {
  // Sprint 3: Default to real providers (mock only for explicit testing)
  const useMock = process.env.USE_MOCK_PROVIDERS === 'true';

  if (useMock) {
    console.warn('[Provider] Using MockProviderAdapter. Set USE_MOCK_PROVIDERS=false to use real fal.ai');
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
 * Get prompt generation adapter
 * Sprint 3: Always use Gemini for prompt generation (no mock, no fallback)
 */
export function getPromptGenerationAdapter(): ProviderAdapter {
  // Sprint 3: Prompt generation is always done by Gemini
  // No mock support - Gemini is required
  return createGeminiAdapter();
}
