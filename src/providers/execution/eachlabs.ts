/**
 * Blok C: EachLabs execution provider (ExecutionProvider implementation).
 * API: POST /v1/prediction (model, version, input) -> predictionID; GET /v1/prediction/{id} -> status, output.
 */

import type {
  ExecutionJobStatus,
  ExecutionProvider,
  ExecutionResult,
  TaskInputs,
} from './types';
import type { CandidatePrompt, OutputAsset } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { buildExecutionPayload } from '@/src/lib/execution-payload';
import { taskInputsToAssets } from '@/src/lib/task-assets';
import { convertFalAIOutputToOutputAssets } from '@/src/providers/falai/helpers';

const EACHLABS_BASE = 'https://api.eachlabs.ai';
const EACHLABS_PREDICTION_URL = `${EACHLABS_BASE}/v1/prediction`;

const LOG_MAX_BODY_CHARS = 500;

/** Truncate string for logging to avoid huge base64 in terminal. */
function truncateForLog(s: string, max = LOG_MAX_BODY_CHARS): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `... (truncated, total ${s.length} chars)`;
}

/** Summarize request body for error logs without dumping base64. */
function summarizeBody(body: Record<string, unknown>): string {
  const keys = Object.keys(body);
  let size = 0;
  try {
    size = JSON.stringify(body).length;
  } catch {
    size = -1;
  }
  return `keys: [${keys.join(', ')}], size: ${size} chars`;
}

/** Fetch model version from EachLabs (GET /v1/model?slug=). Uses given apiKey. Returns version or '1.0'. */
async function fetchEachLabsModelVersion(slug: string, apiKey: string): Promise<string> {
  try {
    const url = new URL(`${EACHLABS_BASE}/v1/model`);
    url.searchParams.set('slug', slug);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return '1.0';
    const data = (await res.json()) as { version?: string };
    return data.version && String(data.version).trim() ? String(data.version).trim() : '1.0';
  } catch {
    return '1.0';
  }
}

/** Remove null/undefined from input so we don't send invalid values (can cause 500). */
function cleanInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Apply defaults from research (request_schema) when present; else legacy fallback for known EachLabs params.
 * Only used in this provider.
 */
function applyEachLabsInputDefaults(
  input: Record<string, unknown>,
  requiredInputDefaults?: Record<string, unknown>
): void {
  if (requiredInputDefaults && Object.keys(requiredInputDefaults).length > 0) {
    for (const [key, value] of Object.entries(requiredInputDefaults)) {
      if (input[key] === undefined) input[key] = value;
    }
    return;
  }
  if (input.quality === undefined) input.quality = 'high';
  if (input.duration === undefined) input.duration = 5;
}

function mapStatus(
  apiStatus: string
): 'queued' | 'running' | 'completed' | 'failed' {
  switch (apiStatus) {
    case 'success':
      return 'completed';
    case 'error':
    case 'cancelled':
      return 'failed';
    case 'pending':
    case 'processing':
      return 'running';
    default:
      return 'running';
  }
}

/**
 * User-friendly EachLabs error message. 5xx can be server error or wrong request format.
 * Detects 413 (payload too large) in response details and suggests using a URL instead of inline data.
 */
function formatEachLabsError(
  status: number,
  statusText: string,
  body: string,
  _context: 'submit' | 'get'
): string {
  const trimmed = body.trim();
  const hasDetail = trimmed.length > 0 && trimmed !== '{}';
  const is5xx = status >= 500;
  const is413 = status === 413 || /413|Request Entity Too Large|payload.*too large|SQS.*413/i.test(trimmed);

  if (is413) {
    return 'Request too large (413). The provider limits request size. Use a short video or a video URL instead of uploading a large file; large inline video may fail.';
  }
  if (is5xx && !hasDetail) {
    return `EachLabs API ${status} ${statusText}. Server response body is empty. Check [EachLabs] logs in the terminal for the request. EachLabs sometimes returns 500 for accounts with balance; retry or contact EachLabs support.`;
  }
  if (is5xx && hasDetail) {
    return `EachLabs API ${status} ${statusText}: ${trimmed.slice(0, 400)}`;
  }
  return `EachLabs API error: ${status} ${statusText}${hasDetail ? ` - ${trimmed}` : ''}`;
}

export class EachLabsExecutionProvider implements ExecutionProvider {
  constructor(private apiKey: string) {}

  async buildPayload(
    candidate: CandidatePrompt,
    modelSpec: ModelSpec,
    taskInputs?: TaskInputs
  ): Promise<Record<string, unknown>> {
    const taskAssets = taskInputsToAssets(taskInputs);
    return buildExecutionPayload({
      modelSpec,
      prompt: candidate.prompt,
      taskAssets,
      inputAssets: candidate.inputAssets,
    });
  }

  /**
   * Max request body size (chars). The limit is EachLabs' infrastructure: they enqueue jobs to
   * the underlying model (e.g. pixverse) via SQS, and that step returns 413 for larger payloads.
   * So it's not the model's API limit — it's EachLabs' queue/message size limit. We use 1 MB
   * so requests succeed or fail fast. Use a video URL instead of inline base64 to avoid the limit.
   */
  private static readonly MAX_BODY_CHARS = 1_000_000;

  async submit(
    endpointId: string,
    payload: Record<string, unknown>,
    options?: { requiredInputDefaults?: Record<string, unknown> }
  ): Promise<string> {
    const version = await fetchEachLabsModelVersion(endpointId, this.apiKey);
    const input = cleanInput(payload);
    applyEachLabsInputDefaults(input, options?.requiredInputDefaults);
    const body = {
      model: endpointId,
      version,
      input,
    };

    const bodyJson = JSON.stringify(body);
    if (bodyJson.length > EachLabsExecutionProvider.MAX_BODY_CHARS) {
      throw new Error(
        'Request too large (413). The provider limits request size. Use a short video or a video URL instead of uploading a large file; large inline video may fail.'
      );
    }

    const res = await fetch(`${EACHLABS_PREDICTION_URL}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: bodyJson,
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('[EachLabs] POST /v1/prediction/ failed', res.status, res.statusText, '| request:', summarizeBody(body), '| response:', truncateForLog(text || '(empty)'));
      throw new Error(formatEachLabsError(res.status, res.statusText, text, 'submit'));
    }

    const data = JSON.parse(text) as {
      predictionID?: string;
      prediction_id?: string;
      status?: string;
      message?: string;
    };
    const id = data.predictionID ?? data.prediction_id;
    if (!id) {
      throw new Error(
        `EachLabs API did not return prediction ID: ${JSON.stringify(data)}`
      );
    }
    return String(id);
  }

  async getStatus(
    _endpointId: string,
    requestId: string
  ): Promise<ExecutionJobStatus> {
    const result = await this.fetchPrediction(requestId);
    return mapStatus(result.status);
  }

  async getResult(
    _endpointId: string,
    requestId: string
  ): Promise<ExecutionResult & { status: ExecutionJobStatus }> {
    const result = await this.fetchPrediction(requestId);
    const status = mapStatus(result.status);
    return {
      status,
      output: result.output,
      error: result.error,
    };
  }

  convertToOutputAssets(rawOutput: unknown, modelSpec: ModelSpec): OutputAsset[] {
    return convertFalAIOutputToOutputAssets(rawOutput, modelSpec);
  }

  private async fetchPrediction(
    predictionId: string
  ): Promise<{
    status: string;
    output?: unknown;
    error?: string;
  }> {
    const res = await fetch(
      `${EACHLABS_PREDICTION_URL}/${encodeURIComponent(predictionId)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-Key': this.apiKey,
        },
      }
    );

    const MAX_BODY_PARSE_BYTES = 1024 * 1024; // 1MB – larger responses are often truncated at ~10MB and break JSON
    const contentLength = res.headers.get('Content-Length');
    const contentLengthNum = contentLength ? parseInt(contentLength, 10) : NaN;
    if (!Number.isNaN(contentLengthNum) && contentLengthNum > MAX_BODY_PARSE_BYTES) {
      console.error('[EachLabs] GET /v1/prediction/{id} response too large (Content-Length)', { predictionId, contentLength: contentLengthNum });
      throw new Error(
        `EachLabs response too large (${(contentLengthNum / 1024 / 1024).toFixed(1)}MB). The API may be returning inline video/data. We do not parse responses over 1MB. Try a different model or contact EachLabs.`
      );
    }

    const text = await res.text();
    if (!res.ok) {
      console.error('[EachLabs] GET /v1/prediction/{id} failed', { predictionId, status: res.status, statusText: res.statusText, body: truncateForLog(text || '(empty)') });
      throw new Error(formatEachLabsError(res.status, res.statusText, text, 'get'));
    }

    if (text.length > MAX_BODY_PARSE_BYTES) {
      console.error('[EachLabs] GET /v1/prediction/{id} response too large', { predictionId, length: text.length });
      throw new Error(
        `EachLabs response too large (${(text.length / 1024 / 1024).toFixed(1)}MB). The API may be returning inline video/data or the response was truncated. We do not parse responses over 1MB to avoid JSON errors. Try a different model or contact EachLabs.`
      );
    }

    let data: {
      status?: string;
      output?: unknown;
      error?: string;
      message?: string;
      detail?: string;
      reason?: string;
    };
    try {
      data = JSON.parse(text) as typeof data;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      const positionMatch = msg.match(/position\s+(\d+)/i);
      const position = positionMatch ? parseInt(positionMatch[1], 10) : 0;
      const truncatedAt10MB = position >= 10 * 1024 * 1024 - 1000 || text.length >= 10 * 1024 * 1024 - 1000;
      console.error('[EachLabs] GET /v1/prediction/{id} JSON parse failed', { predictionId, length: text.length, error: msg });
      if (truncatedAt10MB) {
        throw new Error(
          'EachLabs returned a very large response (~10MB) that was likely truncated, causing invalid JSON. This often happens with video-to-video outputs. Try a different model or contact EachLabs; we do not parse responses over 1MB to avoid this error.'
        );
      }
      throw new Error(
        `EachLabs returned invalid JSON (${(text.length / 1024).toFixed(0)}KB). This often happens with large video outputs (truncated or malformed response). Error: ${msg}`
      );
    }

    const status = data.status ?? 'running';
    const failed = status === 'error' || status === 'cancelled';
    const errorText =
      data.error ??
      data.message ??
      data.detail ??
      data.reason ??
      (failed
        ? 'Job failed (no details from EachLabs). Often due to request size limit — use a video URL or a shorter clip.'
        : undefined);
    return {
      status,
      output: data.output,
      error: errorText,
    };
  }
}
