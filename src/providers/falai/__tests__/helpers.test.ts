/**
 * Unit tests for fal.ai helpers (OpenAPI schema parsing, etc.).
 */

import { getFalOpenApiInputPropertyKeys } from '../helpers';

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
