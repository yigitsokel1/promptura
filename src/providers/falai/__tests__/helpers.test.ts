/**
 * Unit tests for fal.ai helpers (OpenAPI schema parsing, etc.).
 */

import type { FalAIClient } from '../client';
import { falQueueModelBasePath, normalizeFalQueueStatus } from '../client';
import { buildFalAIPayload, convertFalAIOutputToOutputAssets, getFalOpenApiInputPropertyKeys } from '../helpers';
import type { CandidatePrompt } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';

describe('getFalOpenApiInputPropertyKeys', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns property keys from requestBody schema (inline properties)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        paths: {
          '/fal-ai/test': {
            post: {
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        prompt: { type: 'string' },
                        image_url: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    });

    const result = await getFalOpenApiInputPropertyKeys('fal-ai/test');
    expect(result.keys).toEqual(['prompt', 'image_url']);
    expect(result.required).toBeUndefined();
  });

  it('resolves $ref to components/schemas and returns property keys', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        paths: {
          '/fal-ai/flux/dev': {
            post: {
              requestBody: {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/FluxDevInput' },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            FluxDevInput: {
              type: 'object',
              properties: {
                prompt: { type: 'string' },
                num_images: { type: 'integer' },
                image_size: { type: 'string' },
              },
            },
          },
        },
      }),
    });

    const result = await getFalOpenApiInputPropertyKeys('fal-ai/flux/dev');
    expect(result.keys).toEqual(['prompt', 'num_images', 'image_size']);
    expect(result.required).toBeUndefined();
  });

  it('returns required array when schema has required', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        paths: {
          '/fal-ai/image-edit': {
            post: {
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        prompt: { type: 'string' },
                        image_url: { type: 'string' },
                      },
                      required: ['prompt', 'image_url'],
                    },
                  },
                },
              },
            },
          },
        },
      }),
    });

    const result = await getFalOpenApiInputPropertyKeys('fal-ai/image-edit');
    expect(result.keys).toEqual(['prompt', 'image_url']);
    expect(result.required).toEqual(['prompt', 'image_url']);
  });

  it('returns { keys: [] } when response is not ok', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
    const result = await getFalOpenApiInputPropertyKeys('fal-ai/missing');
    expect(result.keys).toEqual([]);
  });

  it('returns { keys: [] } when no POST path has requestBody schema', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        paths: {
          '/status': { get: {} },
        },
      }),
    });
    const result = await getFalOpenApiInputPropertyKeys('fal-ai/any');
    expect(result.keys).toEqual([]);
  });

  it('returns { keys: [] } on fetch error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const result = await getFalOpenApiInputPropertyKeys('fal-ai/any');
    expect(result.keys).toEqual([]);
  });
});

describe('falQueueModelBasePath / normalizeFalQueueStatus', () => {
  it('matches @fal-ai/client queue base path (drops path segment after alias)', () => {
    expect(falQueueModelBasePath('fal-ai/imagen4/preview')).toBe('fal-ai/imagen4');
    expect(falQueueModelBasePath('fal-ai/flux/dev')).toBe('fal-ai/flux');
  });

  it('keeps two-segment endpoints unchanged', () => {
    expect(falQueueModelBasePath('fal-ai/firered-image-edit')).toBe('fal-ai/firered-image-edit');
  });

  it('normalizes status strings', () => {
    expect(normalizeFalQueueStatus('completed')).toBe('COMPLETED');
    expect(normalizeFalQueueStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(normalizeFalQueueStatus('in-progress')).toBe('IN_PROGRESS');
    expect(normalizeFalQueueStatus('error')).toBe('FAILED');
    expect(normalizeFalQueueStatus('done')).toBe('COMPLETED');
    expect(normalizeFalQueueStatus('success')).toBe('COMPLETED');
    expect(normalizeFalQueueStatus('complete')).toBe('COMPLETED');
  });
});

describe('convertFalAIOutputToOutputAssets', () => {
  const imageSpec: ModelSpec = {
    modality: 'image-to-image',
    required_assets: 'image',
    prompt_guidelines: [],
  };

  it('unwraps nested output.images (common fal response shape)', () => {
    const assets = convertFalAIOutputToOutputAssets(
      { output: { images: [{ url: 'https://cdn.example/out.png' }] } },
      imageSpec
    );
    expect(assets).toEqual([{ type: 'image', url: 'https://cdn.example/out.png' }]);
  });
});

describe('buildFalAIPayload', () => {
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const modelSpec: ModelSpec = {
    modality: 'image-to-image',
    required_assets: 'image',
    prompt_guidelines: [],
    required_input_defaults: {},
  };

  const candidate: CandidatePrompt = {
    id: 'c1',
    prompt: 'edit background',
    generator: 'self',
  };

  it('uploads data-URI image to fal once per cache and uses hosted URL in payload', async () => {
    const uploadFile = jest.fn().mockResolvedValue('https://fal.media/files/test.png');
    const client = { uploadFile } as unknown as FalAIClient;
    const cache = new Map<string, string>();

    const payload1 = await buildFalAIPayload(
      candidate,
      modelSpec,
      {
        assets: [{ type: 'image', url: tinyPng }],
        _uploadCache: cache,
      },
      client
    );

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(payload1.image_url).toBe('https://fal.media/files/test.png');

    const payload2 = await buildFalAIPayload(
      candidate,
      modelSpec,
      {
        assets: [{ type: 'image', url: tinyPng }],
        _uploadCache: cache,
      },
      client
    );

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(payload2.image_url).toBe('https://fal.media/files/test.png');
  });

  it('without client, keeps data URI in payload (legacy / tests)', async () => {
    const payload = await buildFalAIPayload(
      candidate,
      modelSpec,
      { assets: [{ type: 'image', url: tinyPng }] }
    );
    expect(payload.image_url).toBe(tinyPng);
  });
});
