/**
 * Unit tests for schema-asset-analyzer (provider-agnostic required_assets + detected_input_fields).
 * Covers: T2I config-only, I2I init_image, mask_image_url, I2V image+video, V2V video_url, optional fallback.
 */

import { analyzeSchemaForAssets } from '../schema-asset-analyzer';

describe('analyzeSchemaForAssets', () => {
  describe('T2I config-only (no asset keys)', () => {
    it('returns none and empty detected_input_fields when only prompt/num_steps/image_size', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'negative_prompt', 'num_inference_steps', 'image_size', 'num_images'],
      });
      expect(result.required_assets).toBe('none');
      expect(result.detected_input_fields).toEqual([]);
    });

    it('returns none for empty propertyKeys', () => {
      const result = analyzeSchemaForAssets({ propertyKeys: [] });
      expect(result.required_assets).toBe('none');
      expect(result.detected_input_fields).toEqual([]);
    });
  });

  describe('I2I (init_image, image_url, mask_image_url)', () => {
    it('returns image and detected_input_fields for init_image', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'init_image', 'num_steps'],
      });
      expect(result.required_assets).toBe('image');
      expect(result.detected_input_fields).toContain('init_image');
      expect(result.detected_input_fields).toHaveLength(1);
    });

    it('returns image for image_url', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'image_url'],
      });
      expect(result.required_assets).toBe('image');
      expect(result.detected_input_fields).toEqual(['image_url']);
    });

    it('returns image for mask_image_url (edit/inpaint)', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'mask_image_url', 'image_url'],
      });
      expect(result.required_assets).toBe('image');
      expect(result.detected_input_fields).toContain('mask_image_url');
      expect(result.detected_input_fields).toContain('image_url');
      expect(result.detected_input_fields).toHaveLength(2);
    });

    it('returns image for control_image', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'control_image'],
      });
      expect(result.required_assets).toBe('image');
      expect(result.detected_input_fields).toEqual(['control_image']);
    });
  });

  describe('I2V (image_url + video output)', () => {
    it('returns image when only image asset key (I2V input)', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'image_url', 'motion_bucket_id'],
      });
      expect(result.required_assets).toBe('image');
      expect(result.detected_input_fields).toEqual(['image_url']);
    });
  });

  describe('V2V (video_url)', () => {
    it('returns video for video_url', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'video_url'],
      });
      expect(result.required_assets).toBe('video');
      expect(result.detected_input_fields).toEqual(['video_url']);
    });

    it('returns video for input_video', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'input_video'],
      });
      expect(result.required_assets).toBe('video');
      expect(result.detected_input_fields).toContain('input_video');
    });
  });

  describe('image+video (both asset types)', () => {
    it('returns image+video when both image and video keys present', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'image_url', 'video_url'],
      });
      expect(result.required_assets).toBe('image+video');
      expect(result.detected_input_fields).toContain('image_url');
      expect(result.detected_input_fields).toContain('video_url');
      expect(result.detected_input_fields).toHaveLength(2);
    });

    it('returns image+video for input_image + input_video', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'input_image', 'input_video'],
      });
      expect(result.required_assets).toBe('image+video');
      expect(result.detected_input_fields.sort()).toEqual(['input_image', 'input_video'].sort());
    });
  });

  describe('optional asset fallback (required array)', () => {
    it('when required has only prompt, fallback to all keys → image', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'image_url', 'num_steps'],
        required: ['prompt'],
      });
      expect(result.required_assets).toBe('image');
      expect(result.detected_input_fields).toEqual(['image_url']);
    });

    it('when required includes image_url → image', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'image_url'],
        required: ['prompt', 'image_url'],
      });
      expect(result.required_assets).toBe('image');
      expect(result.detected_input_fields).toEqual(['image_url']);
    });

    it('when required is empty list → none', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'image_url'],
        required: [],
      });
      expect(result.required_assets).toBe('none');
      expect(result.detected_input_fields).toEqual(['image_url']);
    });

    it('when required has both image and video keys → image+video', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'image_url', 'input_video'],
        required: ['prompt', 'image_url', 'input_video'],
      });
      expect(result.required_assets).toBe('image+video');
      expect(result.detected_input_fields).toContain('image_url');
      expect(result.detected_input_fields).toContain('input_video');
    });
  });

  describe('denylist (T2I stays none)', () => {
    it('image_size and num_images do not count as asset keys', () => {
      const result = analyzeSchemaForAssets({
        propertyKeys: ['prompt', 'image_size', 'num_images'],
      });
      expect(result.required_assets).toBe('none');
      expect(result.detected_input_fields).toEqual([]);
    });
  });
});
