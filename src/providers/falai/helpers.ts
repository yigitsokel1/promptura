/**
 * Helper functions for fal.ai operations
 * Reduces code duplication across API routes
 */

import { FalAIClient } from './client';
import type { FalAIModelMetadata } from './types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { modelSpecOutputType } from '@/src/core/modelSpec';
import type { CandidatePrompt, CandidatePromptInputAssets, OutputAsset, TaskAsset } from '@/src/core/types';
import { buildExecutionPayload } from '@/src/lib/execution-payload';
import { taskInputsToAssets } from '@/src/lib/task-assets';

/**
 * Upload image/video to fal.ai and convert to URL
 * Handles base64 data URIs by uploading them to fal.ai
 * @param client - FalAIClient instance
 * @param fileData - Base64 data URI or URL string
 * @param contentType - Optional MIME type
 * @returns URL string (either uploaded URL or original URL if already a URL)
 */
export async function uploadFileToFalAI(
  client: FalAIClient,
  fileData: string,
  contentType?: string
): Promise<string> {
  // If it's already a URL, return as-is
  if (fileData.startsWith('http://') || fileData.startsWith('https://')) {
    return fileData;
  }

  // If it's a base64 data URI, upload it
  if (fileData.startsWith('data:')) {
    return await client.uploadFile(fileData, contentType);
  }

  // Otherwise, assume it's a base64 string without data: prefix
  // Convert to data URI and upload
  const dataUri = contentType
    ? `data:${contentType};base64,${fileData}`
    : `data:image/png;base64,${fileData}`;
  return await client.uploadFile(dataUri, contentType);
}

/**
 * If URL is already https, return as-is. Otherwise upload to fal (data URI / raw base64) and cache by source string.
 */
async function ensureFalHostedMediaUrl(
  url: string,
  client: FalAIClient,
  cache: Map<string, string>
): Promise<string> {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const cached = cache.get(url);
  if (cached) return cached;
  const hosted = await uploadFileToFalAI(client, url);
  cache.set(url, hosted);
  return hosted;
}

async function resolveTaskAssetsToFalUrls(
  assets: TaskAsset[],
  client: FalAIClient,
  cache: Map<string, string>
): Promise<TaskAsset[]> {
  return Promise.all(
    assets.map(async (a) => ({
      ...a,
      url: await ensureFalHostedMediaUrl(a.url, client, cache),
    }))
  );
}

async function resolveInputAssetsToFalUrls(
  input: CandidatePromptInputAssets | undefined,
  client: FalAIClient,
  cache: Map<string, string>
): Promise<CandidatePromptInputAssets | undefined> {
  if (!input) return undefined;
  const out: CandidatePromptInputAssets = { ...input };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (typeof v !== 'string' || v.length === 0) continue;
    if (v.startsWith('http://') || v.startsWith('https://')) continue;
    out[key] = await ensureFalHostedMediaUrl(v, client, cache);
  }
  return out;
}

/**
 * Create a FalAIClient instance from environment variables
 * Throws if FAL_AI_API_KEY is not set
 */
export function createFalAIClientFromEnv(): FalAIClient {
  const apiKey = process.env.FAL_AI_API_KEY;
  if (!apiKey) {
    throw new Error('FAL_AI_API_KEY environment variable is required');
  }

  return new FalAIClient({
    apiKey,
    baseUrl: process.env.FAL_AI_BASE_URL,
  });
}

/**
 * Determine modality from model metadata category
 */
export function determineModalityFromCategory(
  category: string | undefined
): 'text' | 'image' | 'video' {
  if (!category) {
    return 'text';
  }

  if (category.includes('image')) {
    return 'image';
  }

  if (category.includes('video')) {
    return 'video';
  }

  return 'text';
}

/**
 * Determine kind (model vs workflow) from endpoint ID
 */
export function determineKindFromEndpointId(endpointId: string): 'model' | 'workflow' {
  return endpointId.includes('/workflow/') ? 'workflow' : 'model';
}

/**
 * Derive modality from endpoint ID when metadata is unavailable (e.g. schema-only validation)
 */
export function determineModalityFromEndpointId(endpointId: string): 'text' | 'image' | 'video' {
  const id = endpointId.toLowerCase();
  if (id.includes('video')) return 'video';
  if (id.includes('image') || id.includes('flux') || id.includes('imagen')) return 'image';
  return 'text';
}

const FAL_OPENAPI_SCHEMA_URL = 'https://fal.ai/api/openapi/queue/openapi.json';

/** OpenAPI 3 requestBody content schema (may have $ref or inline properties). */
type OpenApiSchema = {
  $ref?: string;
  properties?: Record<string, { default?: unknown }>;
  required?: string[];
};

/** Resolve schema from $ref (#/components/schemas/Name) or return schema with properties. */
function resolveRequestSchema(
  schema: OpenApiSchema | undefined,
  components: { schemas?: Record<string, OpenApiSchema> } | undefined
): OpenApiSchema | undefined {
  if (!schema) return undefined;
  if (schema.properties) return schema;
  const ref = schema.$ref;
  if (!ref || typeof ref !== 'string') return undefined;
  const name = ref.replace(/^#\/components\/schemas\//, '');
  const resolved = components?.schemas?.[name];
  return resolved ?? undefined;
}

export interface FalOpenApiInputSchema {
  keys: string[];
  /** When schema has a required array, only these count as required for asset inference. */
  required?: string[];
}

/**
 * Fetch Fal.ai OpenAPI schema for the endpoint and return request body input property keys + required array.
 * Uses the same queue OpenAPI URL as validate fallback; standard OpenAPI 3 requestBody pattern.
 * Use with inferRequiredAssetsFromPropertyKeys(keys, required ? { required } : undefined) for required_assets.
 *
 * @param endpointId - e.g. "fal-ai/flux/dev"
 * @returns { keys, required? }; keys = all property names; required = schema.required when present
 */
export async function getFalOpenApiInputPropertyKeys(
  endpointId: string
): Promise<FalOpenApiInputSchema> {
  try {
    const url = `${FAL_OPENAPI_SCHEMA_URL}?endpoint_id=${encodeURIComponent(endpointId)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { keys: [] };
    const json = (await res.json()) as {
      paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> } } }>;
      components?: { schemas?: Record<string, OpenApiSchema> };
    };
    const paths = json?.paths ?? {};
    const components = json?.components;

    for (const pathItem of Object.values(paths)) {
      const post = pathItem?.post;
      if (!post?.requestBody?.content) continue;
      const content = post.requestBody.content;
      const jsonContent = content['application/json'];
      const schema = jsonContent?.schema;
      if (!schema) continue;
      const resolved = resolveRequestSchema(schema, components);
      if (resolved?.properties && typeof resolved.properties === 'object') {
        const keys = Object.keys(resolved.properties);
        const required =
          Array.isArray(resolved.required) && resolved.required.length > 0
            ? resolved.required
            : undefined;
        return { keys, required };
      }
    }
    return { keys: [] };
  } catch {
    return { keys: [] };
  }
}

/**
 * Build required_input_defaults from Fal.ai OpenAPI schema (research time).
 * For each required key: use schema property default when present.
 * Only includes keys that have a default in schema; used so execution can fill missing required params.
 */
export async function getFalRequiredInputDefaults(endpointId: string): Promise<Record<string, unknown>> {
  try {
    const url = `${FAL_OPENAPI_SCHEMA_URL}?endpoint_id=${encodeURIComponent(endpointId)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return {};
    const json = (await res.json()) as {
      paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> } } }>;
      components?: { schemas?: Record<string, OpenApiSchema> };
    };
    const paths = json?.paths ?? {};
    const components = json?.components;
    for (const pathItem of Object.values(paths)) {
      const post = pathItem?.post;
      if (!post?.requestBody?.content) continue;
      const schema = post.requestBody.content['application/json']?.schema;
      const resolved = resolveRequestSchema(schema, components);
      const required = Array.isArray(resolved?.required) && resolved.required.length > 0 ? resolved.required : [];
      if (required.length === 0 || !resolved?.properties || typeof resolved.properties !== 'object') continue;
      const out: Record<string, unknown> = {};
      for (const key of required) {
        const prop = resolved.properties[key];
        const defaultVal = prop && typeof prop === 'object' && 'default' in prop ? prop.default : undefined;
        if (defaultVal !== undefined && defaultVal !== null) out[key] = defaultVal;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Validate model exists via Fal.ai OpenAPI schema (no auth).
 * Fallback when Platform API (v1/models) returns 5xx.
 */
export async function validateFalModelViaSchema(endpointId: string): Promise<{
  valid: boolean;
  kind?: 'model' | 'workflow';
  modality?: 'text' | 'image' | 'video';
}> {
  try {
    const url = `${FAL_OPENAPI_SCHEMA_URL}?endpoint_id=${encodeURIComponent(endpointId)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { valid: false };
    const json = (await res.json()) as { paths?: Record<string, unknown> };
    const paths = json?.paths ?? {};
    const hasPostPath = Object.values(paths).some(
      (p) => p && typeof p === 'object' && 'post' in p && (p as { post?: unknown }).post
    );
    if (!hasPostPath) return { valid: false };
    return {
      valid: true,
      kind: determineKindFromEndpointId(endpointId),
      modality: determineModalityFromEndpointId(endpointId),
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Extract modality and kind from model metadata
 */
export function extractModelMetadata(
  modelMetadata: FalAIModelMetadata
): {
  modality: 'text' | 'image' | 'video';
  kind: 'model' | 'workflow';
} {
  const category = modelMetadata.metadata.category || '';
  return {
    modality: determineModalityFromCategory(category),
    kind: determineKindFromEndpointId(modelMetadata.endpoint_id),
  };
}

/**
 * Build fal.ai payload — delegates to execution-payload (single source of truth).
 * No param mapping; payload is prompt + image_url/video_url when required.
 */
export async function buildFalAIPayload(
  candidate: CandidatePrompt,
  modelSpec: ModelSpec,
  taskInputs?: {
    image?: string;
    video?: string;
    text?: string;
    assets?: Array<{ type: 'image' | 'video'; url: string }>;
    _uploadCache?: Map<string, string>;
  },
  client?: FalAIClient
): Promise<Record<string, unknown>> {
  const cache = taskInputs?._uploadCache ?? new Map<string, string>();
  let taskAssets = taskInputsToAssets(taskInputs);
  let inputAssets = candidate.inputAssets;

  if (client) {
    taskAssets = await resolveTaskAssetsToFalUrls(taskAssets, client, cache);
    inputAssets = await resolveInputAssetsToFalUrls(inputAssets, client, cache);
  }

  const payload = buildExecutionPayload({
    modelSpec,
    prompt: candidate.prompt,
    taskAssets,
    inputAssets,
  });
  const defaults = modelSpec.required_input_defaults;
  if (defaults && Object.keys(defaults).length > 0) {
    for (const [key, value] of Object.entries(defaults)) {
      if (payload[key] === undefined) payload[key] = value;
    }
  }
  return payload;
}

/**
 * Convert fal.ai output to OutputAsset[] based on ModelSpec.
 * Modality-agnostic: all outputs normalized to assets array.
 */
export function convertFalAIOutputToOutputAssets(
  falOutput: unknown,
  modelSpec: ModelSpec
): OutputAsset[] {
  const outputType = modelSpecOutputType(modelSpec);
  const outputFormat = outputType === 'video' ? 'url[]' : outputType === 'image' ? 'url[]' : 'string';

  const toTextAsset = (s: string): OutputAsset => ({ type: 'text', content: s });

  if (outputType === 'text') {
    if (typeof falOutput === 'string') {
      return [toTextAsset(falOutput)];
    }
    if (typeof falOutput === 'object' && falOutput !== null) {
      const outputObj = falOutput as Record<string, unknown>;
      if ('text' in outputObj && typeof outputObj.text === 'string') {
        return [toTextAsset(outputObj.text)];
      }
      if ('output' in outputObj && typeof outputObj.output === 'string') {
        return [toTextAsset(outputObj.output)];
      }
      return [toTextAsset(JSON.stringify(falOutput))];
    }
    return [toTextAsset(String(falOutput))];
  }

  if (outputType === 'image') {
    const toImageAssets = (urls: string[]): OutputAsset[] =>
      urls.map((url) => ({ type: 'image' as const, url }));

    if (typeof falOutput === 'object' && falOutput !== null && !Array.isArray(falOutput)) {
      const top = falOutput as Record<string, unknown>;
      const hasDirectImageFields =
        'images' in top ||
        'urls' in top ||
        typeof top.image === 'string' ||
        typeof top.url === 'string';
      if (!hasDirectImageFields && top.output !== undefined && top.output !== null) {
        return convertFalAIOutputToOutputAssets(top.output, modelSpec);
      }
    }

    const extractUrls = (): string[] | null => {
      if (typeof falOutput === 'string' && falOutput.trim().startsWith('http')) {
        return [falOutput.trim()];
      }
      if (Array.isArray(falOutput)) {
        return falOutput.map((img) =>
          typeof img === 'string' ? img : String((img as { url?: unknown })?.url ?? img)
        );
      }
      if (typeof falOutput === 'object' && falOutput !== null) {
        const obj = falOutput as Record<string, unknown>;
        if (Array.isArray(obj.images)) {
          return obj.images.map((img: unknown) =>
            typeof img === 'string' ? img : String((img as { url?: unknown })?.url ?? img)
          );
        }
        if (Array.isArray(obj.urls)) {
          return obj.urls.map((u) => String(u));
        }
        if (typeof obj.image === 'string') return [obj.image];
        if (typeof obj.url === 'string') return [obj.url];
      }
      return null;
    };

    const urls = extractUrls();
    if (urls && urls.length > 0) {
      return toImageAssets(urls);
    }
    return [{ type: 'text' as const, content: `No image URLs in output: ${JSON.stringify(falOutput).slice(0, 200)}` }];
  }

  if (outputType === 'video') {
    const toVideoAssets = (urls: string[]): OutputAsset[] =>
      urls.map((url) => ({ type: 'video' as const, url }));

    if (outputFormat.includes('url[]') || outputFormat === 'url[]') {
      if (Array.isArray(falOutput)) {
        return toVideoAssets(
          falOutput.map((vid) =>
            typeof vid === 'string' ? vid : String((vid as { url?: unknown })?.url ?? vid)
          )
        );
      }
      if (typeof falOutput === 'object' && falOutput !== null) {
        const outputObj = falOutput as Record<string, unknown>;
        if ('videos' in outputObj && Array.isArray(outputObj.videos)) {
          return toVideoAssets(
            outputObj.videos.map((vid) =>
              typeof vid === 'string' ? vid : String((vid as { url?: unknown })?.url ?? vid)
            )
          );
        }
        if ('urls' in outputObj && Array.isArray(outputObj.urls)) {
          return toVideoAssets(outputObj.urls.map((u) => String(u)));
        }
        if ('video' in outputObj && typeof outputObj.video === 'string') {
          return toVideoAssets([outputObj.video]);
        }
      }
    }
    const url =
      typeof falOutput === 'string'
        ? falOutput
        : typeof falOutput === 'object' && falOutput !== null && 'url' in falOutput
          ? String((falOutput as { url: unknown }).url)
          : String(falOutput);
    return toVideoAssets([url]);
  }

  return [toTextAsset(typeof falOutput === 'string' ? falOutput : JSON.stringify(falOutput))];
}
