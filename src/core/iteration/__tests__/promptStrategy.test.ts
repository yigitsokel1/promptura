import { resolvePromptGenerator, resolvePromptGeneratorFromCapabilities } from '../promptStrategy';
import type { ModelRef } from '../../types';

describe('promptStrategy', () => {
  describe('resolvePromptGenerator', () => {
    it('should return "self" for prompt-capable Gemini models', () => {
      const geminiModels: ModelRef[] = [
        { provider: 'google', modelId: 'gemini-2.0-flash-exp' },
        { provider: 'google', modelId: 'gemini-1.5-pro' },
        { provider: 'google', modelId: 'gemini-1.5-flash' },
        { provider: 'google', modelId: 'gemini-nano' },
      ];

      geminiModels.forEach((model) => {
        expect(resolvePromptGenerator(model)).toBe('self');
      });
    });

    it('should return "gemini-fallback" for non-prompt-capable models', () => {
      const nonCapableModels: ModelRef[] = [
        { provider: 'falai', modelId: 'some-model' },
        { provider: 'openai', modelId: 'gpt-4' },
        { provider: 'google', modelId: 'unknown-model' },
      ];

      nonCapableModels.forEach((model) => {
        expect(resolvePromptGenerator(model)).toBe('gemini-fallback');
      });
    });

    it('should handle different provider and model combinations', () => {
      const testCases: Array<{ model: ModelRef; expected: 'self' | 'gemini-fallback' }> = [
        { model: { provider: 'google', modelId: 'gemini-nano' }, expected: 'self' },
        { model: { provider: 'google', modelId: 'other-model' }, expected: 'gemini-fallback' },
        { model: { provider: 'falai', modelId: 'any-model' }, expected: 'gemini-fallback' },
      ];

      testCases.forEach(({ model, expected }) => {
        expect(resolvePromptGenerator(model)).toBe(expected);
      });
    });
  });

  describe('resolvePromptGeneratorFromCapabilities', () => {
    it('should return "self" when model supports prompt generation', () => {
      expect(
        resolvePromptGeneratorFromCapabilities({ supportsPromptGeneration: true })
      ).toBe('self');
    });

    it('should return "gemini-fallback" when model does not support prompt generation', () => {
      expect(
        resolvePromptGeneratorFromCapabilities({ supportsPromptGeneration: false })
      ).toBe('gemini-fallback');
    });
  });
});
