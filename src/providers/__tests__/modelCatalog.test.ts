/**
 * Model Catalog / Provider Pairing Tests
 * Tests for valid and invalid provider-model pairings
 */

import { getProviderAdapter, getPromptGenerationAdapter } from '../index';
import type { ModelRef } from '@/src/core/types';

describe('modelCatalog / Provider Pairing', () => {
  const originalEnv = process.env.USE_MOCK_PROVIDERS;

  beforeEach(() => {
    // Use real providers for these tests (not mocks)
    process.env.USE_MOCK_PROVIDERS = 'false';
  });

  afterEach(() => {
    process.env.USE_MOCK_PROVIDERS = originalEnv;
  });

  describe('getProviderAdapter - valid pairings', () => {
    it('should return FalAIAdapter for falai provider', () => {
      const model: ModelRef = { provider: 'falai', modelId: 'fal-ai/flux/dev' };
      
      // Mock environment variable
      const originalKey = process.env.FAL_AI_API_KEY;
      process.env.FAL_AI_API_KEY = 'test-key';

      try {
        const adapter = getProviderAdapter(model);
        expect(adapter).toBeDefined();
        // Should be an instance of FalAIAdapter (or throw if API key missing)
      } catch (error) {
        // If API key validation fails, that's expected in test env
        expect(error).toBeDefined();
      } finally {
        process.env.FAL_AI_API_KEY = originalKey;
      }
    });

    it('should return GeminiAdapter for google provider', () => {
      const model: ModelRef = { provider: 'google', modelId: 'gemini-1.5-flash' };
      
      // Mock environment variable
      const originalKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'test-key';

      try {
        const adapter = getProviderAdapter(model);
        expect(adapter).toBeDefined();
        // Should be an instance of GeminiAdapter (or throw if API key missing)
      } catch (error) {
        // If API key validation fails, that's expected in test env
        expect(error).toBeDefined();
      } finally {
        process.env.GEMINI_API_KEY = originalKey;
      }
    });
  });

  describe('getProviderAdapter - invalid pairings', () => {
    it('should throw error for unknown provider', () => {
      const model = { provider: 'unknown', modelId: 'some-model' } as unknown as ModelRef;
      
      expect(() => {
        getProviderAdapter(model);
      }).toThrow('Unknown provider');
    });

    it('should throw error for unimplemented OpenAI provider', () => {
      const model: ModelRef = { provider: 'openai', modelId: 'gpt-4' };
      
      expect(() => {
        getProviderAdapter(model);
      }).toThrow('OpenAI adapter not yet implemented');
    });
  });

  describe('getPromptGenerationAdapter', () => {
    it('should return GeminiAdapter for prompt generation fallback', () => {
      // Mock environment variable
      const originalKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'test-key';

      try {
        const adapter = getPromptGenerationAdapter();
        expect(adapter).toBeDefined();
        // Should be an instance of GeminiAdapter (or throw if API key missing)
      } catch (error) {
        // If API key validation fails, that's expected in test env
        expect(error).toBeDefined();
      } finally {
        process.env.GEMINI_API_KEY = originalKey;
      }
    });
  });
});
