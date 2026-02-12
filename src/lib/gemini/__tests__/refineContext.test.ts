/**
 * Unit tests: refine context builder (Blok F)
 */

import { buildRefineContext, type RunWithOutput } from '../refineContext';

describe('buildRefineContext', () => {
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
});
