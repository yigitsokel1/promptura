/**
 * Unit tests for EachLabs helpers (modality, required_assets from request_schema).
 */

import { eachLabsRequiredAssets, eachLabsModality, eachLabsRequiredInputDefaults } from '../helpers';
import type { EachLabsModelDetail } from '../types';

function detail(overrides: Partial<EachLabsModelDetail> = {}): EachLabsModelDetail {
  return {
    title: 'Test Model',
    slug: 'test-slug',
    ...overrides,
  };
}

describe('eachLabsRequiredAssets', () => {
  it('returns none when no request_schema', () => {
    expect(eachLabsRequiredAssets(detail())).toBe('none');
  });

  it('returns none when request_schema has no properties', () => {
    expect(eachLabsRequiredAssets(detail({ request_schema: {} }))).toBe('none');
  });

  it('returns none when only prompt-like properties', () => {
    expect(
      eachLabsRequiredAssets(
        detail({
          request_schema: {
            properties: {
              prompt: { type: 'string' },
              negative_prompt: { type: 'string' },
            },
          },
        })
      )
    ).toBe('none');
  });

  it('returns image when image-related property present (image_url, init_image, input_image)', () => {
    expect(
      eachLabsRequiredAssets(
        detail({
          request_schema: {
            properties: {
              prompt: { type: 'string' },
              image_url: { type: 'string' },
            },
          },
        })
      )
    ).toBe('image');
    expect(
      eachLabsRequiredAssets(
        detail({
          request_schema: {
            properties: {
              prompt: { type: 'string' },
              init_image: { type: 'string' },
              input_image: { type: 'string' },
            },
          },
        })
      )
    ).toBe('image');
  });

  it('returns video when video-related property present', () => {
    expect(
      eachLabsRequiredAssets(
        detail({
          request_schema: {
            properties: {
              prompt: { type: 'string' },
              video_url: { type: 'string' },
            },
          },
        })
      )
    ).toBe('video');
  });

  it('returns image+video when both image and video properties present', () => {
    expect(
      eachLabsRequiredAssets(
        detail({
          request_schema: {
            properties: {
              prompt: { type: 'string' },
              image_url: { type: 'string' },
              input_video: { type: 'string' },
            },
          },
        })
      )
    ).toBe('image+video');
  });

  it('when required array exists: image_url optional (not in required) → fallback to all keys → image', () => {
    expect(
      eachLabsRequiredAssets(
        detail({
          request_schema: {
            properties: {
              prompt: { type: 'string' },
              image_url: { type: 'string' },
            },
            required: ['prompt'],
          },
        })
      )
    ).toBe('image');
  });

  it('when required array exists: image_url in required → image', () => {
    expect(
      eachLabsRequiredAssets(
        detail({
          request_schema: {
            properties: {
              prompt: { type: 'string' },
              image_url: { type: 'string' },
            },
            required: ['prompt', 'image_url'],
          },
        })
      )
    ).toBe('image');
  });
});

describe('eachLabsModality', () => {
  it('returns image for output_type array or image', () => {
    expect(eachLabsModality(detail({ output_type: 'array' }))).toBe('image');
    expect(eachLabsModality(detail({ output_type: 'image' }))).toBe('image');
  });

  it('returns video for output_type video', () => {
    expect(eachLabsModality(detail({ output_type: 'video' }))).toBe('video');
  });

  it('returns text when output_type is text or missing', () => {
    expect(eachLabsModality(detail({ output_type: 'text' }))).toBe('text');
    expect(eachLabsModality(detail())).toBe('text');
  });
});

describe('eachLabsRequiredInputDefaults', () => {
  it('returns empty when no request_schema or no required', () => {
    expect(eachLabsRequiredInputDefaults(detail())).toEqual({});
    expect(eachLabsRequiredInputDefaults(detail({ request_schema: {} }))).toEqual({});
    expect(eachLabsRequiredInputDefaults(detail({ request_schema: { required: [] } }))).toEqual({});
  });

  it('uses schema default when present', () => {
    expect(
      eachLabsRequiredInputDefaults(
        detail({
          request_schema: {
            required: ['quality'],
            properties: { quality: { type: 'string', default: 'medium' } },
          },
        })
      )
    ).toEqual({ quality: 'medium' });
  });

  it('uses known fallback for quality and duration when no schema default', () => {
    expect(
      eachLabsRequiredInputDefaults(
        detail({
          request_schema: {
            required: ['quality', 'duration'],
            properties: { quality: { type: 'string' }, duration: { type: 'number' } },
          },
        })
      )
    ).toEqual({ quality: 'high', duration: 5 });
  });

  it('includes only required keys we have a default for', () => {
    expect(
      eachLabsRequiredInputDefaults(
        detail({
          request_schema: {
            required: ['quality', 'unknown_param'],
            properties: { quality: { type: 'string' } },
          },
        })
      )
    ).toEqual({ quality: 'high' });
  });
});
