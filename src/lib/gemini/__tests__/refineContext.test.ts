/**
 * Unit tests: refine context builder (Blok F). Sprint 7: no params — only prompt, note, outputSummary.
 */

import { buildRefineContext, type RunWithOutput } from '../refineContext';

describe('buildRefineContext', () => {
  it('output has only prompt, note, outputSummary (no param fields)', () => {
    const selectedFeedback = [{ candidateId: 'c1', selected: true }];
    const selectedPrompts = [{ candidateId: 'c1', prompt: 'P', note: 'N' }];
    const previousRuns: RunWithOutput[] = [{ candidateId: 'c1', outputJson: {} }];
    const result = buildRefineContext(selectedFeedback, selectedPrompts, previousRuns);
    expect(result).toHaveLength(1);
    const keys = Object.keys(result[0]).sort();
    expect(keys).toEqual(['note', 'outputSummary', 'prompt']);
  });

  it('builds one selected item with prompt, note, and output summary', () => {
    const selectedFeedback = [
      { candidateId: 'c1', note: 'Liked this', selected: true },
    ];
    const selectedPrompts = [
      { candidateId: 'c1', prompt: 'The actual prompt text', note: 'Liked this' },
    ];
    const previousRuns: RunWithOutput[] = [
      {
        candidateId: 'c1',
        outputJson: { type: 'image' as const, images: [{ url: 'https://x.com/1.png' }] },
      },
    ];
    const result = buildRefineContext(selectedFeedback, selectedPrompts, previousRuns);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('The actual prompt text');
    expect(result[0].note).toBe('Liked this');
    expect(result[0].outputSummary).toBe('Generated 1 image');
  });

  it('uses fallback prompt when selectedPrompts missing for candidate', () => {
    const selectedFeedback = [{ candidateId: 'c1', selected: true }];
    const result = buildRefineContext(selectedFeedback, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toContain('c1');
    expect(result[0].outputSummary).toBe('No output');
  });

  it('builds multiple selected with text and image summaries', () => {
    const selectedFeedback = [
      { candidateId: 'c1', note: 'n1', selected: true },
      { candidateId: 'c2', selected: true },
    ];
    const selectedPrompts = [
      { candidateId: 'c1', prompt: 'P1', note: 'n1' },
      { candidateId: 'c2', prompt: 'P2' },
    ];
    const previousRuns: RunWithOutput[] = [
      { candidateId: 'c1', outputJson: { type: 'text' as const, text: 'Short' } },
      { candidateId: 'c2', outputJson: { type: 'image' as const, images: [{ url: 'a' }, { url: 'b' }] } },
    ];
    const result = buildRefineContext(selectedFeedback, selectedPrompts, previousRuns);
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe('P1');
    expect(result[0].outputSummary).toBe('Short');
    expect(result[1].prompt).toBe('P2');
    expect(result[1].outputSummary).toBe('Generated 2 images');
  });

  describe('Blok G: refine multi-modal test', () => {
    it('summarizes video output (legacy format)', () => {
      const selectedFeedback = [{ candidateId: 'c1', selected: true }];
      const selectedPrompts = [{ candidateId: 'c1', prompt: 'Animate this' }];
      const previousRuns: RunWithOutput[] = [
        {
          candidateId: 'c1',
          outputJson: { type: 'video' as const, videos: [{ url: 'https://v.mp4' }] },
        },
      ];
      const result = buildRefineContext(selectedFeedback, selectedPrompts, previousRuns);
      expect(result).toHaveLength(1);
      expect(result[0].outputSummary).toBe('Generated 1 video');
    });

    it('summarizes video output (new { assets } format)', () => {
      const selectedFeedback = [{ candidateId: 'c1', selected: true }];
      const selectedPrompts = [{ candidateId: 'c1', prompt: 'Motion blur' }];
      const previousRuns: RunWithOutput[] = [
        {
          candidateId: 'c1',
          outputJson: {
            assets: [
              { type: 'video' as const, url: 'https://out.mp4' },
            ],
          },
        },
      ];
      const result = buildRefineContext(selectedFeedback, selectedPrompts, previousRuns);
      expect(result).toHaveLength(1);
      expect(result[0].outputSummary).toBe('Generated 1 video');
    });

    it('summarizes mixed text + image + video outputs', () => {
      const selectedFeedback = [
        { candidateId: 'c1', selected: true },
        { candidateId: 'c2', selected: true },
        { candidateId: 'c3', selected: true },
      ];
      const selectedPrompts = [
        { candidateId: 'c1', prompt: 'P1' },
        { candidateId: 'c2', prompt: 'P2' },
        { candidateId: 'c3', prompt: 'P3' },
      ];
      const previousRuns: RunWithOutput[] = [
        { candidateId: 'c1', outputJson: { assets: [{ type: 'text' as const, content: 'Caption here' }] } },
        { candidateId: 'c2', outputJson: { assets: [{ type: 'image' as const, url: 'https://i.png' }] } },
        { candidateId: 'c3', outputJson: { assets: [{ type: 'video' as const, url: 'https://v.mp4' }] } },
      ];
      const result = buildRefineContext(selectedFeedback, selectedPrompts, previousRuns);
      expect(result[0].outputSummary).toBe('Caption here');
      expect(result[1].outputSummary).toBe('Generated 1 image');
      expect(result[2].outputSummary).toBe('Generated 1 video');
    });
  });
});
