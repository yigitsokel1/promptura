/**
 * Unit tests: prompt template parsing and refine context (Blok F)
 */

import {
  generatePrompts,
  refinePrompts,
  summarizeRunOutput,
  type GeminiPromptsResponse,
  type SelectedWithNote,
} from '../promptTemplates';
import type { TaskSpec } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';

const minimalModelSpec: ModelSpec = {
  modality: 'text-to-image',
  required_assets: 'none',
  prompt_guidelines: ['Use clear descriptions', 'Prefer present tense'],
};

describe('promptTemplates', () => {
  describe('generatePrompts', () => {
    it('includes task goal and modality in output', () => {
      const task: TaskSpec = { goal: 'A cat in a hat', modality: 'text-to-image' };
      const out = generatePrompts(task, minimalModelSpec, 5);
      expect(out).toContain('A cat in a hat');
      expect(out).toContain('text-to-image');
    });

    it('includes prompt_guidelines in output', () => {
      const task: TaskSpec = { goal: 'Test', modality: 'text-to-text' };
      const out = generatePrompts(task, minimalModelSpec, 3);
      expect(out).toContain('Use clear descriptions');
      expect(out).toContain('Prefer present tense');
    });

    it('describes required JSON shape with prompts array', () => {
      const task: TaskSpec = { goal: 'Test', modality: 'text-to-text' };
      const out = generatePrompts(task, minimalModelSpec, 2);
      expect(out).toContain('"prompts":');
      expect(out).toContain('"prompt":');
      expect(out).toContain('"reasoning":');
      expect(out).toContain('"tags":');
    });

    it('contract JSON shape is parseable', () => {
      const sample: GeminiPromptsResponse = {
        prompts: [
          {
            prompt: 'A scene description',
            reasoning: 'Clear and specific',
            tags: ['style', 'lighting'],
          },
        ],
      };
      expect(sample.prompts).toHaveLength(1);
      expect(sample.prompts[0].prompt).toBe('A scene description');
      expect(sample.prompts[0].reasoning).toBeDefined();
      expect(Array.isArray(sample.prompts[0].tags)).toBe(true);
    });
  });

  describe('refinePrompts', () => {
    it('includes task and selected prompts in output', () => {
      const task: TaskSpec = { goal: 'Refine this', modality: 'text-to-image' };
      const selected: SelectedWithNote[] = [
        { prompt: 'Selected prompt one', note: 'Good result' },
      ];
      const out = refinePrompts(task, minimalModelSpec, selected, 10);
      expect(out).toContain('Refine this');
      expect(out).toContain('Selected prompt one');
      expect(out).toContain('User note: Good result');
    });

    it('includes Model output (summary) when outputSummary is provided', () => {
      const task: TaskSpec = { goal: 'G', modality: 'text-to-image' };
      const selected: SelectedWithNote[] = [
        { prompt: 'P1', outputSummary: 'Generated 1 image' },
      ];
      const out = refinePrompts(task, minimalModelSpec, selected, 10);
      expect(out).toContain('Model output (summary):');
      expect(out).toContain('Generated 1 image');
    });

    it('describes required JSON shape with prompts array', () => {
      const task: TaskSpec = { goal: 'G', modality: 'text-to-text' };
      const selected: SelectedWithNote[] = [{ prompt: 'P' }];
      const out = refinePrompts(task, minimalModelSpec, selected, 5);
      expect(out).toContain('"prompts":');
      expect(out).toContain('"reasoning":');
      expect(out).toContain('"tags":');
    });
  });

  describe('summarizeRunOutput', () => {
    it('returns "No output" for null/undefined', () => {
      expect(summarizeRunOutput(null)).toBe('No output');
      expect(summarizeRunOutput(undefined)).toBe('No output');
    });

    it('truncates long text and adds ellipsis', () => {
      const long = 'a'.repeat(300);
      expect(summarizeRunOutput({ type: 'text', text: long })).toBe('a'.repeat(280) + '…');
    });

    it('returns short text as-is', () => {
      expect(summarizeRunOutput({ type: 'text', text: 'Hello' })).toBe('Hello');
    });

    it('returns "Generated 1 image" or "Generated N images"', () => {
      expect(summarizeRunOutput({ type: 'image', images: [{ url: 'x' }] })).toBe('Generated 1 image');
      expect(summarizeRunOutput({ type: 'image', images: [{ url: 'a' }, { url: 'b' }] })).toBe('Generated 2 images');
    });

    it('returns "Generated 1 video" or "Generated N videos"', () => {
      expect(summarizeRunOutput({ type: 'video', videos: [{ url: 'x' }] })).toBe('Generated 1 video');
      expect(summarizeRunOutput({ type: 'video', videos: [{ url: 'a' }, { url: 'b' }] })).toBe('Generated 2 videos');
    });
  });
});
