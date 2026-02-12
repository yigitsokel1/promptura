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
import type { CandidatePrompt, RunOutput } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { convertFalAIOutputToRunOutput } from '@/src/providers/falai/helpers';

const EACHLABS_BASE = 'https://api.eachlabs.ai';
const EACHLABS_PREDICTION_URL = `${EACHLABS_BASE}/v1/prediction`;

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

  if (is5xx && !hasDetail) {
    return `EachLabs API ${status} ${statusText}. Server response body is empty. Check [EachLabs] logs in the terminal for the request. EachLabs sometimes returns 500 for accounts with balance; retry or contact EachLabs support.`;
  }
  if (is5xx && hasDetail) {
    return `EachLabs API ${status} ${statusText}: ${trimmed.slice(0, 400)}`;
  }
  return `EachLabs API error: ${status} ${statusText}${hasDetail ? ` - ${trimmed}` : ''}`;
}

/**
 * Build EachLabs "input" object from candidate + modelSpec + taskInputs.
 * No file upload; image/video must be URLs (or base64 if API supports later).
 */
function buildInput(
  candidate: CandidatePrompt,
  modelSpec: ModelSpec,
  taskInputs?: TaskInputs
): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  for (const inputSpec of modelSpec.inputs) {
    const name = inputSpec.name;
    const type = (inputSpec.type || 'string').toLowerCase();

    if (candidate.params && name in candidate.params) {
      const v = candidate.params[name];
      if (type === 'number' && typeof v === 'string') {
        input[name] = parseFloat(v);
      } else if (type === 'boolean' && typeof v === 'string') {
        input[name] = v === 'true' || v === '1';
      } else {
        input[name] = v;
      }
      continue;
    }

    if (
      name === 'prompt' ||
      name === 'text' ||
      name === 'message' ||
      type === 'string'
    ) {
      input[name] = candidate.prompt;
      continue;
    }

    if (
      type === 'image' ||
      name.toLowerCase().includes('image')
    ) {
      const data = candidate.inputAssets?.image || taskInputs?.image;
      if (data) input[name] = data;
      else if (inputSpec.required) {
        throw new Error(`Required image input '${name}' is missing`);
      }
      continue;
    }

    if (
      type === 'video' ||
      name.toLowerCase().includes('video')
    ) {
      const data = candidate.inputAssets?.video || taskInputs?.video;
      if (data) input[name] = data;
      else if (inputSpec.required) {
        throw new Error(`Required video input '${name}' is missing`);
      }
      continue;
    }

    if (inputSpec.required && inputSpec.default !== undefined) {
      input[name] = inputSpec.default;
    } else if (inputSpec.required) {
      throw new Error(`Required input '${name}' is missing`);
    }
  }

  return input;
}

export class EachLabsExecutionProvider implements ExecutionProvider {
  constructor(private apiKey: string) {}

  async buildPayload(
    candidate: CandidatePrompt,
    modelSpec: ModelSpec,
    taskInputs?: TaskInputs
  ): Promise<Record<string, unknown>> {
    return buildInput(candidate, modelSpec, taskInputs);
  }

  async submit(endpointId: string, payload: Record<string, unknown>): Promise<string> {
    const version = await fetchEachLabsModelVersion(endpointId, this.apiKey);
    const input = cleanInput(payload);
    const body = {
      model: endpointId,
      version,
      input,
    };

    const res = await fetch(`${EACHLABS_PREDICTION_URL}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('[EachLabs] POST /v1/prediction/ failed');
      console.error('[EachLabs] Request body:', JSON.stringify(body, null, 2));
      console.error('[EachLabs] Response:', res.status, res.statusText, '| body:', text || '(empty)');
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

  convertToRunOutput(rawOutput: unknown, modelSpec: ModelSpec): RunOutput {
    return convertFalAIOutputToRunOutput(rawOutput, modelSpec);
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

    const text = await res.text();
    if (!res.ok) {
      console.error('[EachLabs] GET /v1/prediction/{id} failed', { predictionId, status: res.status, statusText: res.statusText, body: text || '(empty)' });
      throw new Error(formatEachLabsError(res.status, res.statusText, text, 'get'));
    }

    const data = JSON.parse(text) as {
      status?: string;
      output?: unknown;
      error?: string;
      message?: string;
    };
    return {
      status: data.status ?? 'running',
      output: data.output,
      error: data.error ?? data.message,
    };
  }
}
