/**
 * EachLabs helpers for Admin: validate model, research (via Gemini).
 * Same pattern as fal.ai: key from env for Admin; user key for Playground.
 */

import type { EachLabsModelDetail } from './types';
import type { FalAIModelMetadata } from '@/src/providers/falai/types';
import type { RequiredAssets } from '@/src/core/modelSpec';
import { analyzeSchemaForAssets } from '@/src/lib/schema-asset-analyzer';

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

/**
 * Required input assets from EachLabs request_schema — thin wrapper only.
 * Single authority: schema-asset-analyzer (allowlist + denylist); no provider-specific heuristic.
 * Ensures T2I stays required_assets=none (image_size, num_images etc. are denylisted).
 */
export function eachLabsRequiredAssets(detail: EachLabsModelDetail): RequiredAssets {
  const schema = detail.request_schema;
  const propertyKeys =
    schema?.properties && typeof schema.properties === 'object'
      ? Object.keys(schema.properties)
      : [];
  const required =
    Array.isArray(schema?.required) && schema.required.length > 0 ? schema.required : undefined;
  return analyzeSchemaForAssets({ propertyKeys, required }).required_assets;
}

/** Known EachLabs API required params and defaults when schema has no default. Only for params we know. */
const EACHLABS_KNOWN_INPUT_DEFAULTS: Record<string, unknown> = {
  quality: 'high',
  duration: 5,
};

/**
 * Build required_input_defaults from EachLabs request_schema (validate/research time).
 * For each required key: use schema.properties[key].default if set, else known fallback.
 * Only includes keys we have a default for; other providers never use this.
 */
export function eachLabsRequiredInputDefaults(detail: EachLabsModelDetail): Record<string, unknown> {
  const schema = detail.request_schema;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const out: Record<string, unknown> = {};
  for (const key of required) {
    const prop = properties[key];
    const defaultVal = prop && typeof prop === 'object' && 'default' in prop ? prop.default : undefined;
    const fallback = EACHLABS_KNOWN_INPUT_DEFAULTS[key];
    if (defaultVal !== undefined && defaultVal !== null) {
      out[key] = defaultVal;
    } else if (fallback !== undefined) {
      out[key] = fallback;
    }
  }
  return out;
}
