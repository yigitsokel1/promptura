/**
 * Blok G: OutputAsset union parse test
 * Validates normalizeStoredOutputToAssets and runOutputToAssets handle all output formats.
 */

import {
  normalizeStoredOutputToAssets,
  runOutputToAssets,
  assetsToRunOutput,
  type OutputAsset,
} from '../types';

describe('OutputAsset union parse', () => {
  describe('normalizeStoredOutputToAssets', () => {
    it('parses new format { assets: OutputAsset[] }', () => {
      const stored = {
        assets: [
          { type: 'text', content: 'Hello' },
          { type: 'image', url: 'https://a.png' },
          { type: 'video', url: 'https://b.mp4' },
        ],
      };
      const result = normalizeStoredOutputToAssets(stored);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'text', content: 'Hello' });
      expect(result[1]).toEqual({ type: 'image', url: 'https://a.png' });
      expect(result[2]).toEqual({ type: 'video', url: 'https://b.mp4' });
    });

    it('parses legacy text output', () => {
      const stored = { type: 'text', text: 'Legacy text' };
      const result = normalizeStoredOutputToAssets(stored);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: 'text', content: 'Legacy text' });
    });

    it('parses legacy image output', () => {
      const stored = { type: 'image', images: [{ url: 'https://x.png' }, { url: 'https://y.png' }] };
      const result = normalizeStoredOutputToAssets(stored);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'image', url: 'https://x.png' });
      expect(result[1]).toEqual({ type: 'image', url: 'https://y.png' });
    });

    it('parses legacy video output', () => {
      const stored = { type: 'video', videos: [{ url: 'https://v.mp4' }] };
      const result = normalizeStoredOutputToAssets(stored);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: 'video', url: 'https://v.mp4' });
    });

    it('returns empty array for null/undefined', () => {
      expect(normalizeStoredOutputToAssets(null)).toEqual([]);
      expect(normalizeStoredOutputToAssets(undefined)).toEqual([]);
    });

    it('returns empty array for non-object', () => {
      expect(normalizeStoredOutputToAssets('string')).toEqual([]);
      expect(normalizeStoredOutputToAssets(123)).toEqual([]);
    });

    it('returns empty array for legacy type with empty arrays', () => {
      const stored = { type: 'image', images: [] };
      const result = normalizeStoredOutputToAssets(stored);
      expect(result).toEqual([]);
    });
  });

  describe('runOutputToAssets', () => {
    it('converts text RunOutput', () => {
      const result = runOutputToAssets({ type: 'text', text: 'Hi' });
      expect(result).toEqual([{ type: 'text', content: 'Hi' }]);
    });

    it('converts image RunOutput', () => {
      const result = runOutputToAssets({ type: 'image', images: [{ url: 'https://i.png' }] });
      expect(result).toEqual([{ type: 'image', url: 'https://i.png' }]);
    });

    it('converts video RunOutput', () => {
      const result = runOutputToAssets({ type: 'video', videos: [{ url: 'https://v.mp4' }] });
      expect(result).toEqual([{ type: 'video', url: 'https://v.mp4' }]);
    });

    it('returns [] for null/undefined', () => {
      expect(runOutputToAssets(null)).toEqual([]);
      expect(runOutputToAssets(undefined)).toEqual([]);
    });
  });

  describe('assetsToRunOutput round-trip', () => {
    it('round-trips text assets', () => {
      const assets: OutputAsset[] = [{ type: 'text', content: 'Round' }];
      const run = assetsToRunOutput(assets);
      expect(run).toEqual({ type: 'text', text: 'Round' });
      expect(runOutputToAssets(run)).toEqual(assets);
    });

    it('round-trips image assets', () => {
      const assets: OutputAsset[] = [{ type: 'image', url: 'https://r.png' }];
      const run = assetsToRunOutput(assets);
      expect(run).toEqual({ type: 'image', images: [{ url: 'https://r.png' }] });
      expect(runOutputToAssets(run)).toEqual(assets);
    });

    it('round-trips video assets', () => {
      const assets: OutputAsset[] = [{ type: 'video', url: 'https://r.mp4' }];
      const run = assetsToRunOutput(assets);
      expect(run).toEqual({ type: 'video', videos: [{ url: 'https://r.mp4' }] });
      expect(runOutputToAssets(run)).toEqual(assets);
    });
  });
});
