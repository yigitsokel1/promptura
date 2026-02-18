/**
 * Blok F: Real Modality Test Matrix
 * Validates that each provider+modality combo exercises correct payload building and output conversion.
 * Sprint 7: param-free ModelSpec (modality + required_assets).
 */

import { buildExecutionPayload } from '../execution-payload';
import { convertFalAIOutputToOutputAssets } from '@/src/providers/falai/helpers';
import { executionProviderFactory } from '@/src/providers/execution';
import { supportsModality } from '../provider-capabilities';
import type { TaskAsset } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';

/** ModelSpec for text-to-image (prompt only) */
const TEXT_TO_IMAGE_SPEC: ModelSpec = {
  modality: 'text-to-image',
  required_assets: 'none',
  prompt_guidelines: [],
};

/** ModelSpec for image-to-image (prompt + image) */
const IMAGE_TO_IMAGE_SPEC: ModelSpec = {
  modality: 'image-to-image',
  required_assets: 'image',
  prompt_guidelines: [],
};

/** ModelSpec for image-to-video (image + motion text) */
const IMAGE_TO_VIDEO_SPEC: ModelSpec = {
  modality: 'image-to-video',
  required_assets: 'image',
  prompt_guidelines: [],
};

/** ModelSpec for text-to-video (prompt only) */
const TEXT_TO_VIDEO_SPEC: ModelSpec = {
  modality: 'text-to-video',
  required_assets: 'none',
  prompt_guidelines: [],
};

const TEST_IMAGE_URL = 'https://example.com/input.png';

describe('Modality Test Matrix', () => {
  describe('buildExecutionPayload', () => {
    it('fal.ai text-to-image: prompt only, no image', () => {
      const payload = buildExecutionPayload({
        modelSpec: TEXT_TO_IMAGE_SPEC,
        prompt: 'a cat in a hat',
        taskAssets: [],
      });
      expect(payload.prompt).toBe('a cat in a hat');
      expect(payload.image_url).toBeUndefined();
    });

    it('fal.ai image-to-image: prompt + image from taskAssets', () => {
      const taskAssets: TaskAsset[] = [{ type: 'image', url: TEST_IMAGE_URL }];
      const payload = buildExecutionPayload({
        modelSpec: IMAGE_TO_IMAGE_SPEC,
        prompt: 'make it watercolor',
        taskAssets,
      });
      expect(payload.prompt).toBe('make it watercolor');
      expect(payload.image_url).toBe(TEST_IMAGE_URL);
    });

    it('eachlabs image-to-video: image + motion prompt', () => {
      const taskAssets: TaskAsset[] = [{ type: 'image', url: TEST_IMAGE_URL }];
      const payload = buildExecutionPayload({
        modelSpec: IMAGE_TO_VIDEO_SPEC,
        prompt: 'smooth camera pan',
        taskAssets,
      });
      expect(payload.prompt).toBe('smooth camera pan');
      expect(payload.image_url).toBe(TEST_IMAGE_URL);
    });

    it('text-to-video: prompt only', () => {
      const payload = buildExecutionPayload({
        modelSpec: TEXT_TO_VIDEO_SPEC,
        prompt: 'a dog running on the beach',
        taskAssets: [],
      });
      expect(payload.prompt).toBe('a dog running on the beach');
      expect(payload.image_url).toBeUndefined();
    });
  });

  describe('convertFalAIOutputToOutputAssets', () => {
    it('fal.ai text-to-image: image output → OutputAsset[]', () => {
      const raw = { images: [{ url: 'https://out.com/1.png' }] };
      const assets = convertFalAIOutputToOutputAssets(raw, TEXT_TO_IMAGE_SPEC);
      expect(assets).toHaveLength(1);
      expect(assets[0].type).toBe('image');
      expect((assets[0] as { url: string }).url).toBe('https://out.com/1.png');
    });

    it('fal.ai image-to-image: image output → OutputAsset[]', () => {
      const raw = ['https://out.com/img.png'];
      const assets = convertFalAIOutputToOutputAssets(raw, IMAGE_TO_IMAGE_SPEC);
      expect(assets).toHaveLength(1);
      expect(assets[0].type).toBe('image');
      expect((assets[0] as { url: string }).url).toBe('https://out.com/img.png');
    });

    it('image-to-video: video output → OutputAsset[]', () => {
      const raw = { videos: [{ url: 'https://out.com/vid.mp4' }] };
      const assets = convertFalAIOutputToOutputAssets(raw, IMAGE_TO_VIDEO_SPEC);
      expect(assets).toHaveLength(1);
      expect(assets[0].type).toBe('video');
      expect((assets[0] as { url: string }).url).toBe('https://out.com/vid.mp4');
    });

    it('text-to-video: video output → OutputAsset[]', () => {
      const raw = { urls: ['https://out.com/v.mp4'] };
      const assets = convertFalAIOutputToOutputAssets(raw, TEXT_TO_VIDEO_SPEC);
      expect(assets).toHaveLength(1);
      expect(assets[0].type).toBe('video');
      expect((assets[0] as { url: string }).url).toBe('https://out.com/v.mp4');
    });
  });

  describe('EachLabs convertToOutputAssets (image-to-video)', () => {
    it('eachlabs image-to-video: builds payload with image + prompt', async () => {
      const provider = executionProviderFactory('eachlabs', 'test-key');
      const candidate = {
        id: 'c1',
        prompt: 'motion: zoom in',
        generator: 'gemini-fallback' as const,
        inputAssets: undefined,
      };
      const taskAssets: TaskAsset[] = [{ type: 'image', url: TEST_IMAGE_URL }];
      const payload = await provider.buildPayload(candidate, IMAGE_TO_VIDEO_SPEC, {
        assets: taskAssets,
      });
      expect(payload.prompt).toBe('motion: zoom in');
      expect(payload.image_url).toBe(TEST_IMAGE_URL);
    });

    it('eachlabs image-to-video: converts output to OutputAsset[]', () => {
      const provider = executionProviderFactory('eachlabs', 'test-key');
      const raw = { urls: ['https://eachlabs.out/video.mp4'] };
      const assets = provider.convertToOutputAssets(raw, IMAGE_TO_VIDEO_SPEC);
      expect(assets).toHaveLength(1);
      expect(assets[0].type).toBe('video');
      expect((assets[0] as { url: string }).url).toBe('https://eachlabs.out/video.mp4');
    });
  });

  describe('Provider capability + modality (safety)', () => {
    it('fal.ai supports text-to-image, image-to-image, text-to-video', () => {
      expect(supportsModality('falai', 'text-to-image')).toBe(true);
      expect(supportsModality('falai', 'image-to-image')).toBe(true);
      expect(supportsModality('falai', 'text-to-video')).toBe(true);
    });

    it('eachlabs supports image-to-video', () => {
      expect(supportsModality('eachlabs', 'image-to-video')).toBe(true);
    });
  });
});
