/**
 * Provider registry and factory
 * Central entry point for getting provider adapters
 */

import type { ProviderAdapter } from './types';
import type { ModelRef } from '@/src/core/types';
import { createGeminiAdapter } from './gemini';
import { MockProviderAdapter } from './mock';
import { executionProviderFactory } from './execution';
import type { ExecutionProviderSlug } from './execution';
import { ExecutionRunnerAdapter } from './execution-runner';

/**
 * Get provider adapter for a given model.
 * options.apiKey: Blok B — user's key for falai/eachlabs; required for execution providers.
 */
export function getProviderAdapter(
  model: ModelRef,
  options?: { apiKey?: string }
): ProviderAdapter {
  const useMock = process.env.USE_MOCK_PROVIDERS === 'true';

  if (useMock) {
    console.warn('[Provider] Using MockProviderAdapter. Set USE_MOCK_PROVIDERS=false to use real providers');
    return new MockProviderAdapter();
  }

  switch (model.provider) {
    case 'falai':
    case 'eachlabs': {
      const apiKey =
        options?.apiKey ??
        (model.provider === 'falai' ? process.env.FAL_AI_API_KEY : process.env.EACHLABS_API_KEY);
      if (!apiKey) {
        throw new Error(
          'API key for this provider is required. Add your key in Settings → Provider keys.'
        );
      }
      const executionProvider = executionProviderFactory(
        model.provider as ExecutionProviderSlug,
        apiKey
      );
      return new ExecutionRunnerAdapter(executionProvider);
    }
    case 'google':
      return createGeminiAdapter();
    case 'openai':
      throw new Error('OpenAI adapter not yet implemented');
    default:
      throw new Error(`Unknown provider: ${model.provider}`);
  }
}

/**
 * Get prompt generation adapter
 * Sprint 3: Always use Gemini for prompt generation (no mock, no fallback)
 */
export function getPromptGenerationAdapter(options?: { apiKey?: string }): ProviderAdapter {
  // Sprint 3: Prompt generation is always done by Gemini
  // No mock support - Gemini is required
  return createGeminiAdapter(options);
}
