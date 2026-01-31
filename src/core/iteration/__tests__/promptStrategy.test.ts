import { resolvePromptGenerator } from '../promptStrategy';

describe('promptStrategy', () => {
  describe('resolvePromptGenerator', () => {
    it('should always return "gemini-fallback" (Sprint 3: Gemini-only prompt generation)', () => {
      // Sprint 3: All prompt generation is done by Gemini, regardless of target model
      expect(resolvePromptGenerator()).toBe('gemini-fallback');
    });
  });
});
