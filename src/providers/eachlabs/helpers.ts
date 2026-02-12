/**
 * EachLabs helpers for Admin: validate model, research (via Gemini).
 * Same pattern as fal.ai: key from env for Admin; user key for Playground.
 */

import type { EachLabsModelDetail } from './types';
import type { FalAIModelMetadata } from '@/src/providers/falai/types';

const EACHLABS_BASE = 'https://api.eachlabs.ai';

/**
 * Get EachLabs API key from environment. Throws if not set.
 * Use for Admin flows (validate, research, refresh).
 */
export function getEachLabsApiKeyFromEnv(): string {
  const apiKey = process.env.EACHLABS_API_KEY;
  if (!apiKey) {
    throw new Error('EACHLABS_API_KEY environment variable is required for Admin operations');
  }
  return apiKey;
}

/**
 * Find a model by slug (GET /v1/model?slug=...).
 * Returns null if not found (404).
 */
export async function findEachLabsModel(slug: string): Promise<EachLabsModelDetail | null> {
  const apiKey = getEachLabsApiKeyFromEnv();
  const url = new URL(`${EACHLABS_BASE}/v1/model`);
  url.searchParams.set('slug', slug);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EachLabs API error: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<EachLabsModelDetail>;
}

/**
 * Map EachLabs model detail to FalAIModelMetadata shape so Gemini research can reuse the same flow.
 */
export function eachLabsDetailToFalMetadata(detail: EachLabsModelDetail): FalAIModelMetadata {
  const category = detail.output_type === 'array' ? 'image' : (detail.output_type ?? 'text');
  return {
    endpoint_id: detail.slug,
    metadata: {
      display_name: detail.title,
      category,
      description: detail.title,
      status: 'active',
      tags: detail.version ? [detail.version] : [],
    },
  };
}

/**
 * Derive modality from EachLabs output_type (and optionally request_schema).
 */
export function eachLabsModality(detail: EachLabsModelDetail): 'text' | 'image' | 'video' {
  const ot = (detail.output_type || '').toLowerCase();
  if (ot.includes('image') || ot === 'array') return 'image';
  if (ot.includes('video')) return 'video';
  return 'text';
}
