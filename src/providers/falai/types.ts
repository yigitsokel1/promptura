/**
 * Fal.ai provider specific types
 */

export interface FalAIConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FalAIRequest {
  modelId: string;
  prompt: string;
  inputs?: {
    image?: string;
    text?: string;
  };
}

export interface FalAIResponse {
  output: string;
  latencyMs?: number;
  raw?: unknown;
}

/**
 * Model metadata from fal.ai API
 */
export interface FalAIModelMetadata {
  endpoint_id: string;
  metadata: {
    display_name?: string;
    category?: string;
    description?: string;
    status?: 'active' | 'deprecated';
    tags?: string[];
    updated_at?: string;
    is_favorited?: boolean;
    thumbnail_url?: string;
    model_url?: string;
    date?: string;
    highlighted?: boolean;
    pinned?: boolean;
  };
}

export interface FalAIModelSearchResponse {
  models: FalAIModelMetadata[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Queue API types for fal.ai
 */
export interface FalAIQueueSubmitRequest {
  endpointId: string;
  payload: Record<string, unknown>;
}

export interface FalAIQueueSubmitResponse {
  request_id: string;
}

export type FalAIQueueStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface FalAIQueueStatusResponse {
  status: FalAIQueueStatus;
  request_id: string;
  queue_position?: number;
  response_url?: string;
}

export interface FalAIQueueResultResponse {
  request_id: string;
  status: FalAIQueueStatus;
  output?: unknown;
  error?: string;
}
