/**
 * Fal.ai API client
 * Handles HTTP communication with Fal.ai API
 */

import { createFalClient, parseEndpointId } from '@fal-ai/client';
import type {
  FalAIConfig,
  FalAIRequest,
  FalAIResponse,
  FalAIModelMetadata,
  FalAIModelSearchResponse,
  FalAIQueueStatus,
  FalAIQueueStatusResponse,
  FalAIQueueResultResponse,
} from './types';

/**
 * Queue base path for status/result URLs — aligned with @fal-ai/client queue (owner/alias only; workflows/… supported).
 */
export function falQueueModelBasePath(endpointId: string): string {
  const appId = parseEndpointId(endpointId);
  const prefix = appId.namespace ? `${appId.namespace}/` : '';
  return `${prefix}${appId.owner}/${appId.alias}`;
}

/** Normalize queue status strings from the API (case / hyphen variants). */
export function normalizeFalQueueStatus(raw: unknown): FalAIQueueStatus | undefined {
  if (typeof raw !== 'string') return undefined;
  const u = raw.trim().toUpperCase().replace(/[-\s]+/g, '_');
  if (u === 'IN_QUEUE' || u === 'IN_PROGRESS' || u === 'COMPLETED' || u === 'FAILED') {
    return u;
  }
  if (u === 'ERROR' || u === 'CANCELLED' || u === 'CANCELED' || u === 'FAILURE') {
    return 'FAILED';
  }
  if (u === 'DONE' || u === 'SUCCESS' || u === 'COMPLETE') {
    return 'COMPLETED';
  }
  return undefined;
}

/** Hint when fal returns bare 403 / Forbidden (docs: queue needs `Authorization: Key <FAL_KEY>`). */
function enhanceFalAccessDeniedMessage(message: string): string {
  const m = message.trim();
  if (m === 'Forbidden' || m.includes('403') || m.toLowerCase().includes('forbidden')) {
    return `${m} — fal.ai: use a valid API key with Model API access (https://fal.ai/dashboard/keys). The same key must be used for submit, status, and result. If this persists, try fetching via the queue \`response_url\` from the status response (already attempted by the app).`;
  }
  return m;
}

/** Public CDN file URLs must not use `Authorization: Key …` — many edge configs return 403 Forbidden. */
function isFalPublicMediaUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'fal.media' || hostname.endsWith('.fal.media');
  } catch {
    return false;
  }
}

function parseQueueResultPayload(data: unknown): {
  output?: unknown;
  error?: string;
  status: FalAIQueueStatus;
} {
  if (data === null || data === undefined) {
    return { status: 'COMPLETED', error: 'Empty result body' };
  }

  if (typeof data !== 'object') {
    return { output: data, status: 'COMPLETED' };
  }

  const o = data as Record<string, unknown>;

  if ('status' in o && 'request_id' in o) {
    const wrapped = o as unknown as FalAIQueueResultResponse & { data?: unknown };
    const st = normalizeFalQueueStatus(wrapped.status as unknown) ?? (wrapped.status as FalAIQueueStatus);
    return {
      status: st,
      error: wrapped.error,
      output: wrapped.data ?? wrapped.output,
    };
  }

  const tryData = o.data;
  if (tryData !== undefined && tryData !== null && typeof tryData === 'object') {
    const inner = tryData as Record<string, unknown>;
    if (
      'images' in inner ||
      'videos' in inner ||
      'text' in inner ||
      'output' in inner ||
      'image' in inner ||
      'video' in inner
    ) {
      return { output: tryData, status: 'COMPLETED' };
    }
  }

  if (
    'images' in o ||
    'videos' in o ||
    'text' in o ||
    'output' in o ||
    'image' in o ||
    'video' in o
  ) {
    return { output: data, status: 'COMPLETED' };
  }

  if ('result' in o) {
    return { output: o.result, status: 'COMPLETED' };
  }

  const fallback = o.data ?? o.output;
  const err = typeof o.error === 'string' ? o.error : undefined;
  return {
    output: fallback,
    error: err,
    status: 'COMPLETED',
  };
}

export class FalAIClient {
  private apiKey: string;
  private baseUrl: string;
  private readonly platformApiUrl: string;
  /** Lazy SDK client — same URL/auth/retry rules as fal docs. */
  private falSdk: ReturnType<typeof createFalClient> | null = null;

  constructor(config: FalAIConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://fal.run';
    this.platformApiUrl = 'https://api.fal.ai';
  }

  /** API key without a duplicate `Key ` prefix (fal expects `Authorization: Key <secret>`). */
  private falKeyCredentials(): string {
    return this.apiKey.replace(/^\s*Key\s+/i, '').trim();
  }

  private getFalSdk(): ReturnType<typeof createFalClient> {
    if (!this.falSdk) {
      this.falSdk = createFalClient({ credentials: this.falKeyCredentials() });
    }
    return this.falSdk;
  }

  /**
   * Find a model by endpoint_id
   * Returns the model metadata if found, null otherwise
   */
  async findModel(endpointId: string): Promise<FalAIModelMetadata | null> {
    try {
      const url = new URL(`${this.platformApiUrl}/v1/models`);
      url.searchParams.set('endpoint_id', endpointId);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Key ${this.falKeyCredentials()}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Fal.ai API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: FalAIModelSearchResponse = await response.json();

      if (data.models && data.models.length > 0) {
        return data.models[0];
      }

      return null;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to search for model: ${String(error)}`);
    }
  }

  /**
   * Generate text output from a prompt
   * @deprecated Not yet implemented - will be used in future sprint for actual model execution
   */
  async generateText(_request: FalAIRequest): Promise<FalAIResponse> {
    throw new Error('Fal.ai text generation not yet implemented');
  }

  /**
   * Generate image output from a prompt
   * @deprecated Not yet implemented - will be used in future sprint for actual model execution
   */
  async generateImage(_request: FalAIRequest): Promise<FalAIResponse> {
    throw new Error('Fal.ai image generation not yet implemented');
  }

  /**
   * Batch generate outputs
   * @deprecated Not yet implemented - will be used in future sprint for batch execution
   */
  async batchGenerate(_requests: FalAIRequest[]): Promise<FalAIResponse[]> {
    throw new Error('Fal.ai batch generation not yet implemented');
  }

  /**
   * Submit a job to fal.ai Queue API
   * @param endpointId - The fal.ai endpoint ID (e.g., "fal-ai/flux/dev")
   * @param payload - The request payload matching the model's input spec
   * @returns Request ID for tracking the job
   */
  async submitQueueJob(
    endpointId: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    try {
      console.log(`[FalAI] submitQueueJob endpoint=${endpointId} payload keys=[${Object.keys(payload).join(', ')}]`);
      const q = this.getFalSdk().queue;
      const submitted = await q.submit(endpointId as never, { input: payload as never });
      console.log(`[FalAI] submitQueueJob endpoint=${endpointId} requestId=${submitted.request_id}`);
      return submitted.request_id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[FalAI] submitQueueJob endpoint=${endpointId} FAILED:`, msg);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to submit queue job: ${msg}`);
    }
  }

  /**
   * Check the status of a queue job
   * @param modelId - The model endpoint ID (e.g., "fal-ai/imagen4/preview")
   * @param requestId - The request ID from submitQueueJob
   * @returns Status response with queue position info
   * @note Queue path matches @fal-ai/client (falQueueModelBasePath).
   */
  async getQueueJobStatus(modelId: string, requestId: string): Promise<FalAIQueueStatusResponse> {
    try {
      const st = await this.getFalSdk().queue.status(modelId as never, { requestId });
      const rawStatus = st.status as string;
      const normalized = normalizeFalQueueStatus(rawStatus);
      if (normalized === undefined && typeof rawStatus === 'string' && rawStatus.length > 0) {
        console.warn(
          `[FalAI] Unknown queue status from API endpoint=${modelId} requestId=${requestId} raw=${rawStatus}`
        );
      }
      return {
        status: normalized ?? (rawStatus as FalAIQueueStatus),
        request_id: st.request_id,
        queue_position: 'queue_position' in st ? st.queue_position : undefined,
        response_url: st.response_url,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to get queue job status: ${String(error)}`);
    }
  }

  /**
   * Get the result of a completed queue job
   * @param modelId - The model endpoint ID (e.g., "fal-ai/imagen4/preview")
   * @param requestId - The request ID from submitQueueJob
   * @returns The result output or error
   * @param options.responseUrl — When present (from status.response_url), use this URL; fal may move result payloads here.
   */
  async getQueueJobResult(
    modelId: string,
    requestId: string,
    options?: { responseUrl?: string | null }
  ): Promise<{
    output?: unknown;
    error?: string;
    status: FalAIQueueStatus;
  }> {
    const explicitUrl = options?.responseUrl?.trim();

    const trySdkResult = async () => {
      const res = await this.getFalSdk().queue.result(modelId as never, { requestId });
      return {
        output: res.data,
        error: undefined,
        status: 'COMPLETED' as const,
      };
    };

    /**
     * fal docs: completed status includes `response_url` (often `.../requests/{id}/response`).
     * Prefer that URL first — some setups differ from the SDK’s `.../requests/{id}` GET.
     */
    if (explicitUrl?.length) {
      try {
        return await this.fetchQueueResultFromUrl(explicitUrl);
      } catch (fromUrlErr) {
        try {
          return await trySdkResult();
        } catch (sdkErr) {
          const a = fromUrlErr instanceof Error ? fromUrlErr.message : String(fromUrlErr);
          const b = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
          return {
            output: undefined,
            error: enhanceFalAccessDeniedMessage(`${a} | SDK: ${b}`),
            status: 'FAILED',
          };
        }
      }
    }

    try {
      return await trySdkResult();
    } catch (sdkErr) {
      const msg = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
      return {
        output: undefined,
        error: enhanceFalAccessDeniedMessage(msg),
        status: 'FAILED',
      };
    }
  }

  /** Manual GET when `queue.result` fails but status provided `response_url`. */
  private async fetchQueueResultFromUrl(url: string): Promise<{
    output?: unknown;
    error?: string;
    status: FalAIQueueStatus;
  }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!isFalPublicMediaUrl(url)) {
      headers.Authorization = `Key ${this.falKeyCredentials()}`;
    }
    let response = await fetch(url, { method: 'GET', headers });
    if (!response.ok && isFalPublicMediaUrl(url) && response.status === 403) {
      const retryHeaders: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Key ${this.falKeyCredentials()}`,
      };
      response = await fetch(url, { method: 'GET', headers: retryHeaders });
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Fal.ai result URL error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }
    const data = await response.json();
    const parsed = parseQueueResultPayload(data);
    return {
      output: parsed.output,
      error: parsed.error,
      status: parsed.status,
    };
  }

  /**
   * Upload a file (image/video) to fal.ai and get a URL
   * Supports base64 data URIs
   * Note: This runs on the server side (Next.js API routes), so we can use Buffer
   * @param file - Base64 data URI string
   * @param contentType - Optional MIME type (extracted from data URI if not provided)
   * @returns URL to the uploaded file
   */
  async uploadFile(
    file: string,
    contentType?: string
  ): Promise<string> {
    try {
      // If it's already a URL, return as-is
      if (file.startsWith('http://') || file.startsWith('https://')) {
        return file;
      }

      // Extract base64 data and content type from data URI
      if (!file.startsWith('data:')) {
        throw new Error('File must be a data URI (data:...) or URL');
      }

      const [header, base64Data] = file.split(',');
      const mimeMatch = header.match(/data:([^;]+)/);
      const detectedContentType = mimeMatch ? mimeMatch[1] : contentType || 'image/png';

      const buffer = Buffer.from(base64Data, 'base64');
      const credentials = this.falKeyCredentials();

      // fal CDN upload (replaces removed POST /v1/files on api.fal.ai)
      const fal = createFalClient({ credentials });
      const blob = new Blob([new Uint8Array(buffer)], { type: detectedContentType });
      return await fal.storage.upload(blob);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to upload file: ${String(error)}`);
    }
  }
}
