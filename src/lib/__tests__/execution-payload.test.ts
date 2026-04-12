/**
 * Blok G: Task asset mapping unit test (Sprint 7 — minimal payload from required_assets).
 */

import { buildExecutionPayload } from '../execution-payload';
import type { TaskAsset } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';

const IMAGE_URL = 'https://example.com/in.png';
const VIDEO_URL = 'https://example.com/in.mp4';

function spec(overrides: Partial<ModelSpec>): ModelSpec {
  return {
    modality: 'text-to-image',
    required_assets: 'none',
    prompt_guidelines: [],
    ...overrides,
  };
}

describe('Task asset mapping (buildExecutionPayload)', () => {
  it('maps task asset image to image_url when spec requires image (default field)', () => {
    const taskAssets: TaskAsset[] = [{ type: 'image', url: IMAGE_URL }];
    const payload = buildExecutionPayload({
      modelSpec: spec({ modality: 'image-to-image', required_assets: 'image' }),
      prompt: 'watercolor style',
      taskAssets,
    });
    expect(payload.prompt).toBe('watercolor style');
    expect(payload.image_url).toBe(IMAGE_URL);
  });

  it('uses detected_input_fields to determine image field name', () => {
    const taskAssets: TaskAsset[] = [{ type: 'image', url: IMAGE_URL }];
    const payload = buildExecutionPayload({
      modelSpec: spec({
        modality: 'image-to-image',
        required_assets: 'image',
        detected_input_fields: ['image_urls'],
      }),
      prompt: 'edit background',
      taskAssets,
    });
    expect(payload.prompt).toBe('edit background');
    expect(payload.image_urls).toEqual([IMAGE_URL]);
    expect(payload).not.toHaveProperty('image_url');
  });

  it('sends array for field names ending with _urls', () => {
    const taskAssets: TaskAsset[] = [{ type: 'image', url: IMAGE_URL }];
    const payload = buildExecutionPayload({
      modelSpec: spec({
        modality: 'image-to-image',
        required_assets: 'image',
        detected_input_fields: ['image_urls'],
      }),
      prompt: 'test',
      taskAssets,
    });
    expect(Array.isArray(payload.image_urls)).toBe(true);
    expect(payload.image_urls).toEqual([IMAGE_URL]);
  });

  it('sends string for singular field names like image_url', () => {
    const taskAssets: TaskAsset[] = [{ type: 'image', url: IMAGE_URL }];
    const payload = buildExecutionPayload({
      modelSpec: spec({
        modality: 'image-to-image',
        required_assets: 'image',
        detected_input_fields: ['image_url'],
      }),
      prompt: 'test',
      taskAssets,
    });
    expect(typeof payload.image_url).toBe('string');
    expect(payload.image_url).toBe(IMAGE_URL);
  });

  it('falls back to image_url when no detected_input_fields', () => {
    const taskAssets: TaskAsset[] = [{ type: 'image', url: IMAGE_URL }];
    const payload = buildExecutionPayload({
      modelSpec: spec({
        modality: 'image-to-image',
        required_assets: 'image',
        // no detected_input_fields
      }),
      prompt: 'test',
      taskAssets,
    });
    expect(payload.image_url).toBe(IMAGE_URL);
  });

  it('maps task asset video to video_url when spec requires video', () => {
    const taskAssets: TaskAsset[] = [{ type: 'video', url: VIDEO_URL }];
    const payload = buildExecutionPayload({
      modelSpec: spec({ modality: 'text-to-video', required_assets: 'video' }),
      prompt: 'slow motion',
      taskAssets,
    });
    expect(payload.prompt).toBe('slow motion');
    expect(payload.video_url).toBe(VIDEO_URL);
  });

  it('prefers candidate inputAssets over task assets for image', () => {
    const taskAssets: TaskAsset[] = [{ type: 'image', url: 'https://task.png' }];
    const inputAssets = { image_url: 'https://candidate.png' };
    const payload = buildExecutionPayload({
      modelSpec: spec({ modality: 'image-to-image', required_assets: 'image' }),
      prompt: 'transform',
      taskAssets,
      inputAssets,
    });
    expect(payload.image_url).toBe('https://candidate.png');
  });

  it('prefers candidate inputAssets image when keyed by image', () => {
    const taskAssets: TaskAsset[] = [{ type: 'image', url: IMAGE_URL }];
    const inputAssets = { image: 'https://candidate-img.png' };
    const payload = buildExecutionPayload({
      modelSpec: spec({ modality: 'image-to-image', required_assets: 'image' }),
      prompt: 'style',
      taskAssets,
      inputAssets,
    });
    expect(payload.image_url).toBe('https://candidate-img.png');
  });

  it('throws when required image is missing', () => {
    expect(() =>
      buildExecutionPayload({
        modelSpec: spec({ modality: 'image-to-image', required_assets: 'image' }),
        prompt: 'fail',
        taskAssets: [],
      })
    ).toThrow('Image required.');
  });

  it('minimal payload: only prompt when required_assets is none', () => {
    const payload = buildExecutionPayload({
      modelSpec: spec({ modality: 'text-to-image', required_assets: 'none' }),
      prompt: 'a cat',
    });
    expect(payload.prompt).toBe('a cat');
    expect(payload).not.toHaveProperty('image_url');
    expect(payload).not.toHaveProperty('image_urls');
    expect(payload).not.toHaveProperty('video_url');
  });
});
