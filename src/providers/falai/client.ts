/**
 * Fal.ai API client
 * Handles HTTP communication with Fal.ai API
 */

import type {
  FalAIConfig,
  FalAIRequest,
  FalAIResponse,
  FalAIModelMetadata,
  FalAIModelSearchResponse,
  FalAIQueueStatus,
  FalAIQueueStatusResponse,
  FalAIQueueSubmitResponse,
  FalAIQueueResultResponse,
} from './types';

export class FalAIClient {
  private apiKey: string;
  private baseUrl: string;
  private readonly platformApiUrl: string;
  private readonly queueApiUrl: string;

  constructor(config: FalAIConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://fal.run';
    this.platformApiUrl = 'https://api.fal.ai';
    this.queueApiUrl = 'https://queue.fal.run';
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
          Authorization: `Key ${this.apiKey}`,
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
      // Queue API uses https://queue.fal.run/{model_id} format
      const url = `${this.queueApiUrl}/${endpointId}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Fal.ai Queue API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: FalAIQueueSubmitResponse = await response.json();
      return data.request_id;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to submit queue job: ${String(error)}`);
    }
  }

  /**
   * Extract base model ID from endpoint ID (removes subpath for status/result endpoints)
   * Example: "fal-ai/imagen4/preview" -> "fal-ai/imagen4"
   * @param endpointId - Full endpoint ID with optional subpath
   * @returns Base model ID without subpath
   */
  private extractBaseModelId(endpointId: string): string {
    // Split by '/' and take first two parts (namespace/model)
    // Example: "fal-ai/imagen4/preview" -> ["fal-ai", "imagen4", "preview"] -> "fal-ai/imagen4"
    const parts = endpointId.split('/');
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return endpointId; // Fallback if format is unexpected
  }

  /**
   * Check the status of a queue job
   * @param modelId - The model endpoint ID (e.g., "fal-ai/imagen4/preview")
   * @param requestId - The request ID from submitQueueJob
   * @returns Status response with queue position info
   * @note For status/result endpoints, subpath must be removed (e.g., "fal-ai/imagen4/preview" -> "fal-ai/imagen4")
   */
  async getQueueJobStatus(modelId: string, requestId: string): Promise<FalAIQueueStatusResponse> {
    try {
      // Remove subpath for status endpoint (e.g., "fal-ai/imagen4/preview" -> "fal-ai/imagen4")
      const baseModelId = this.extractBaseModelId(modelId);
      // Queue API format: https://queue.fal.run/{model_id}/requests/{request_id}/status
      const url = `${this.queueApiUrl}/${baseModelId}/requests/${requestId}/status`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Fal.ai Queue API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: FalAIQueueStatusResponse = await response.json();
      return data;
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
   * @note For status/result endpoints, subpath must be removed (e.g., "fal-ai/imagen4/preview" -> "fal-ai/imagen4")
   */
  async getQueueJobResult(modelId: string, requestId: string): Promise<{
    output?: unknown;
    error?: string;
    status: FalAIQueueStatus;
  }> {
    try {
      // Remove subpath for result endpoint (e.g., "fal-ai/imagen4/preview" -> "fal-ai/imagen4")
      const baseModelId = this.extractBaseModelId(modelId);
      // Queue API format: https://queue.fal.run/{model_id}/requests/{request_id}
      const url = `${this.queueApiUrl}/${baseModelId}/requests/${requestId}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Fal.ai Queue API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      
      // Fal.ai Queue API result endpoint returns the result directly
      // The response can be:
      // 1. Direct result object (e.g., { images: [...], timings: {...}, ... })
      // 2. Wrapped in a response object with status/request_id/error fields
      // 3. Nested in 'data' or 'output' fields
      
      // Check if response has status/request_id (wrapped response format)
      const isWrappedResponse = data && typeof data === 'object' && 'status' in data && 'request_id' in data;
      
      let resultOutput: unknown;
      let error: string | undefined;
      let status: FalAIQueueStatus;
      
      if (isWrappedResponse) {
        // Wrapped response format: { status, request_id, output?, error?, data? }
        const wrapped = data as FalAIQueueResultResponse & { data?: unknown };
        status = wrapped.status;
        error = wrapped.error;
        resultOutput = wrapped.data ?? wrapped.output;
      } else {
        // Direct result format: the entire response is the result
        // Check if it looks like a result (has images, videos, text, etc.)
        const hasResultFields = data && typeof data === 'object' && (
          'images' in data || 
          'videos' in data || 
          'text' in data ||
          'output' in data
        );
        
        if (hasResultFields) {
          // Entire response is the result
          resultOutput = data;
          status = 'COMPLETED';
          error = undefined;
        } else {
          // Fallback: try to extract from common fields
          const fallback = data as { data?: unknown; output?: unknown; error?: string };
          resultOutput = fallback.data ?? fallback.output;
          status = 'COMPLETED';
          error = fallback.error;
        }
      }
      
      return {
        output: resultOutput,
        error,
        status,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to get queue job result: ${String(error)}`);
    }
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

      const url = `${this.platformApiUrl}/v1/files`;

      // Extract base64 data and content type from data URI
      if (!file.startsWith('data:')) {
        throw new Error('File must be a data URI (data:...) or URL');
      }

      const [header, base64Data] = file.split(',');
      const mimeMatch = header.match(/data:([^;]+)/);
      const detectedContentType = mimeMatch ? mimeMatch[1] : contentType || 'image/png';

      // Convert base64 to Buffer (Node.js environment)
      const buffer = Buffer.from(base64Data, 'base64');

      // Create multipart/form-data body manually (Node.js compatible)
      const boundary = `----WebKitFormBoundary${Date.now()}`;
      const formDataParts: string[] = [];
      
      formDataParts.push(`--${boundary}`);
      formDataParts.push(`Content-Disposition: form-data; name="file"; filename="upload"`);
      formDataParts.push(`Content-Type: ${detectedContentType}`);
      formDataParts.push('');
      formDataParts.push(buffer.toString('binary'));
      formDataParts.push(`--${boundary}--`);

      const formDataBody = formDataParts.join('\r\n');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: Buffer.from(formDataBody, 'binary'),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Fal.ai Upload API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: { url: string } = await response.json();
      return data.url;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to upload file: ${String(error)}`);
    }
  }
}
