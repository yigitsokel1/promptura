/**
 * Unit tests for modality-inference (required_assets from property keys, combine to Modality).
 */

import {
  inferRequiredAssetsFromPropertyKeys,
  combineOutputAndAssetsToModality,
  isImageAssetKey,
  isVideoAssetKey,
} from '../modality-inference';

describe('inferRequiredAssetsFromPropertyKeys', () => {
  it('returns none for empty keys', () => {
    expect(inferRequiredAssetsFromPropertyKeys([])).toBe('none');
  });

  it('returns none when only prompt-like keys', () => {
    expect(inferRequiredAssetsFromPropertyKeys(['prompt', 'negative_prompt', 'num_steps'])).toBe('none');
  });

  it('returns image when image asset key present (strong match)', () => {
    expect(inferRequiredAssetsFromPropertyKeys(['prompt', 'image_url'])).toBe('image');
    expect(inferRequiredAssetsFromPropertyKeys(['init_image', 'prompt'])).toBe('image');
    expect(inferRequiredAssetsFromPropertyKeys(['ref_image', 'prompt'])).toBe('image');
  });

  it('returns video when video asset key present (strong match)', () => {
    expect(inferRequiredAssetsFromPropertyKeys(['prompt', 'video_url'])).toBe('video');
    expect(inferRequiredAssetsFromPropertyKeys(['input_video'])).toBe('video');
  });

  it('returns image+video when both image and video keys present', () => {
    expect(inferRequiredAssetsFromPropertyKeys(['image_url', 'video_url'])).toBe('image+video');
    expect(inferRequiredAssetsFromPropertyKeys(['prompt', 'input_image', 'input_video'])).toBe('image+video');
  });

  it('matches case-insensitively', () => {
    expect(inferRequiredAssetsFromPropertyKeys(['IMAGE_URL'])).toBe('image');
    expect(inferRequiredAssetsFromPropertyKeys(['Video_Url'])).toBe('video');
  });

  it('strong match: edit-style keys (mask_image_url, control_image, init_image_url)', () => {
    expect(inferRequiredAssetsFromPropertyKeys(['prompt', 'mask_image_url'])).toBe('image');
    expect(inferRequiredAssetsFromPropertyKeys(['control_image'])).toBe('image');
    expect(inferRequiredAssetsFromPropertyKeys(['init_image_url', 'num_steps'])).toBe('image');
    expect(inferRequiredAssetsFromPropertyKeys(['input_video_url'])).toBe('video');
  });

  it('strong match: denylist excludes image_size, num_images (T2I stays none)', () => {
    expect(inferRequiredAssetsFromPropertyKeys(['prompt', 'image_size'])).toBe('none');
    expect(inferRequiredAssetsFromPropertyKeys(['prompt', 'num_images', 'image_size'])).toBe('none');
  });

  describe('when options.required is provided (schema required array)', () => {
    it('image_url optional (not in required) → fallback to all keys → image', () => {
      const keys = ['prompt', 'image_url', 'num_steps'];
      expect(inferRequiredAssetsFromPropertyKeys(keys, { required: ['prompt'] })).toBe('image');
    });

    it('when image_url is in required → image', () => {
      const keys = ['prompt', 'image_url'];
      expect(inferRequiredAssetsFromPropertyKeys(keys, { required: ['prompt', 'image_url'] })).toBe(
        'image'
      );
    });

    it('when both image and video keys in required → image+video', () => {
      const keys = ['prompt', 'image_url', 'input_video'];
      expect(
        inferRequiredAssetsFromPropertyKeys(keys, {
          required: ['prompt', 'image_url', 'input_video'],
        })
      ).toBe('image+video');
    });

    it('empty required list → none', () => {
      expect(
        inferRequiredAssetsFromPropertyKeys(['prompt', 'image_url'], { required: [] })
      ).toBe('none');
    });
  });
});

describe('isImageAssetKey / isVideoAssetKey (strong match)', () => {
  it('isImageAssetKey: accepts image_url, init_image, mask_image_url; rejects image_size, num_images', () => {
    expect(isImageAssetKey('image_url')).toBe(true);
    expect(isImageAssetKey('init_image')).toBe(true);
    expect(isImageAssetKey('mask_image_url')).toBe(true);
    expect(isImageAssetKey('control_image')).toBe(true);
    expect(isImageAssetKey('image_size')).toBe(false);
    expect(isImageAssetKey('num_images')).toBe(false);
  });

  it('isVideoAssetKey: accepts video_url, input_video; rejects video_format', () => {
    expect(isVideoAssetKey('video_url')).toBe(true);
    expect(isVideoAssetKey('input_video')).toBe(true);
    expect(isVideoAssetKey('video_format')).toBe(false);
  });
});

describe('combineOutputAndAssetsToModality', () => {
  it('output text -> text-to-text', () => {
    expect(combineOutputAndAssetsToModality('text', 'none')).toBe('text-to-text');
  });

  it('output image + none -> text-to-image', () => {
    expect(combineOutputAndAssetsToModality('image', 'none')).toBe('text-to-image');
  });

  it('output image + image -> image-to-image', () => {
    expect(combineOutputAndAssetsToModality('image', 'image')).toBe('image-to-image');
  });

  it('output image + image+video -> image-to-image', () => {
    expect(combineOutputAndAssetsToModality('image', 'image+video')).toBe('image-to-image');
  });

  it('output video + none -> text-to-video', () => {
    expect(combineOutputAndAssetsToModality('video', 'none')).toBe('text-to-video');
  });

  it('output video + image -> image-to-video', () => {
    expect(combineOutputAndAssetsToModality('video', 'image')).toBe('image-to-video');
  });

  it('output video + image+video -> image-to-video', () => {
    expect(combineOutputAndAssetsToModality('video', 'image+video')).toBe('image-to-video');
  });

  it('output video + video -> video-to-video', () => {
    expect(combineOutputAndAssetsToModality('video', 'video')).toBe('video-to-video');
  });
});
