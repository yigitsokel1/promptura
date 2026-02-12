/**
 * Helper functions for fal.ai operations
 * Reduces code duplication across API routes
 */

import { FalAIClient } from './client';
import type { FalAIModelMetadata } from './types';
import type { ModelSpec } from '@/src/core/modelSpec';
import type { CandidatePrompt, RunOutput } from '@/src/core/types';

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
 * Build fal.ai Queue API payload from CandidatePrompt and ModelSpec
 * Maps CandidatePrompt params and inputAssets to ModelSpec input names
 * Handles image/video uploads (base64 → URL) via fal.ai upload API
 */
export async function buildFalAIPayload(
  candidate: CandidatePrompt,
  modelSpec: ModelSpec,
  taskInputs?: { image?: string; video?: string; text?: string },
  client?: FalAIClient
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};

  // Process each input from ModelSpec
  for (const inputSpec of modelSpec.inputs) {
    const inputName = inputSpec.name;
    const inputType = inputSpec.type.toLowerCase();

    // Check if candidate has this param
    if (candidate.params && inputName in candidate.params) {
      const value = candidate.params[inputName];

      // Enum params (e.g. image_size): fal.ai expects a string from the enum, not an object
      if (inputSpec.enum && Array.isArray(inputSpec.enum) && inputSpec.enum.length > 0) {
        const allowed = new Set(inputSpec.enum);
        let strVal: string | null = null;
        if (typeof value === 'string') {
          strVal = value;
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'value' in value) {
          strVal = String((value as unknown as { value: unknown }).value);
        }
        if (strVal != null && allowed.has(strVal)) {
          payload[inputName] = strVal;
        } else {
          payload[inputName] = (inputSpec.default != null && allowed.has(String(inputSpec.default)))
            ? String(inputSpec.default)
            : inputSpec.enum[0];
        }
      }
      // Type conversion based on ModelSpec
      else if (inputType === 'number' && typeof value === 'string') {
        payload[inputName] = parseFloat(value);
      } else if (inputType === 'boolean' && typeof value === 'string') {
        payload[inputName] = value === 'true' || value === '1';
      } else if (!inputSpec.enum) {
        // Only pass through primitive values; if it's an object and API expects string (e.g. image_size), skip or use default
        if (typeof value === 'object' && value !== null && inputType === 'string') {
          payload[inputName] = inputSpec.default !== undefined ? inputSpec.default : undefined;
        } else {
          payload[inputName] = value;
        }
      }
    }
    // Check if it's a prompt field (common name)
    else if (inputName === 'prompt' || inputName === 'text' || inputName === 'message') {
      payload[inputName] = candidate.prompt;
    }
    // Check if it's an image input (exclude param names like image_size, image_quality)
    else if (inputType === 'image' || (inputName.toLowerCase().includes('image') && !/^image_(size|quality|format)$/.test(inputName.toLowerCase()))) {
      // Try candidate inputAssets first, then task inputs
      const imageData = candidate.inputAssets?.image || taskInputs?.image;
      if (imageData) {
        // Upload base64 to fal.ai if needed, otherwise use URL as-is
        if (client && (imageData.startsWith('data:') || (!imageData.startsWith('http://') && !imageData.startsWith('https://')))) {
          payload[inputName] = await uploadFileToFalAI(client, imageData, 'image/png');
        } else {
          payload[inputName] = imageData;
        }
      } else if (inputSpec.required) {
        throw new Error(`Required image input '${inputName}' is missing`);
      }
    }
    // Check if it's a video input
    else if (inputType === 'video' || inputName.toLowerCase().includes('video')) {
      const videoData = candidate.inputAssets?.video || taskInputs?.video;
      if (videoData) {
        // Upload base64 to fal.ai if needed, otherwise use URL as-is
        if (client && (videoData.startsWith('data:') || (!videoData.startsWith('http://') && !videoData.startsWith('https://')))) {
          payload[inputName] = await uploadFileToFalAI(client, videoData, 'video/mp4');
        } else {
          payload[inputName] = videoData;
        }
      } else if (inputSpec.required) {
        throw new Error(`Required video input '${inputName}' is missing`);
      }
    }
    // Check task inputs for text
    else if (inputType === 'string' && taskInputs?.text && !payload[inputName]) {
      payload[inputName] = taskInputs.text;
    }
    // Use default value if available and required
    else if (inputSpec.required && inputSpec.default !== undefined) {
      payload[inputName] = inputSpec.default;
    }
    // fal.ai image_size: must be an enum string; avoid sending object or invalid value
    else if (inputName === 'image_size' && payload[inputName] === undefined) {
      const allowed = inputSpec.enum?.length ? inputSpec.enum : ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'];
      payload[inputName] = (inputSpec.default != null && allowed.includes(String(inputSpec.default))) ? String(inputSpec.default) : allowed[0];
    }
    // Throw error if required but not provided
    else if (inputSpec.required) {
      throw new Error(`Required input '${inputName}' is missing`);
    }
  }

  return payload;
}

/**
 * Convert fal.ai output to RunOutput format based on ModelSpec
 * Handles different output types (text, image, video) and formats (url, url[], etc.)
 * This is used both in FalAIAdapter and status endpoint
 */
export function convertFalAIOutputToRunOutput(
  falOutput: unknown,
  modelSpec: ModelSpec
): RunOutput {
  const outputType = modelSpec.outputs.type.toLowerCase();
  const outputFormat = modelSpec.outputs.format.toLowerCase();

  // Handle different output formats
  if (outputType === 'text') {
    if (typeof falOutput === 'string') {
      return { type: 'text', text: falOutput };
    }
    // Try to extract text from object
    if (typeof falOutput === 'object' && falOutput !== null) {
      const outputObj = falOutput as Record<string, unknown>;
      if ('text' in outputObj && typeof outputObj.text === 'string') {
        return { type: 'text', text: outputObj.text };
      }
      if ('output' in outputObj && typeof outputObj.output === 'string') {
        return { type: 'text', text: outputObj.output };
      }
      // Fallback: stringify the object
      return { type: 'text', text: JSON.stringify(falOutput) };
    }
    return { type: 'text', text: String(falOutput) };
  } else if (outputType === 'image') {
    // Handle image outputs
    if (outputFormat.includes('url[]') || outputFormat === 'url[]') {
      // Single URL string (e.g. EachLabs returns one URL)
      if (typeof falOutput === 'string' && falOutput.trim().startsWith('http')) {
        return { type: 'image', images: [{ url: falOutput.trim() }] };
      }
      // Array of URLs
      if (Array.isArray(falOutput)) {
        return {
          type: 'image',
          images: falOutput.map((img) => {
            // Handle both string URLs and objects with url property
            if (typeof img === 'string') {
              return { url: img };
            }
            if (typeof img === 'object' && img !== null && 'url' in img) {
              return { url: String((img as { url: unknown }).url) };
            }
            return { url: String(img) };
          }),
        };
      }
        // Try to extract images array from object
        if (typeof falOutput === 'object' && falOutput !== null) {
          const outputObj = falOutput as Record<string, unknown>;
          if ('images' in outputObj && Array.isArray(outputObj.images)) {
            return {
              type: 'image',
              images: outputObj.images.map((img) => {
                // Handle both string URLs and objects with url property
                if (typeof img === 'string') {
                  return { url: img };
                }
                if (typeof img === 'object' && img !== null && 'url' in img) {
                  return { url: String((img as { url: unknown }).url) };
                }
                return { url: String(img) };
              }),
            };
          }
        if ('urls' in outputObj && Array.isArray(outputObj.urls)) {
          return {
            type: 'image',
            images: outputObj.urls.map((url) => ({ url: String(url) })),
          };
        }
        if ('image' in outputObj && typeof outputObj.image === 'string') {
          return {
            type: 'image',
            images: [{ url: outputObj.image }],
          };
        }
      }
    } else {
      // Single URL
      const url = typeof falOutput === 'string' 
        ? falOutput 
        : (typeof falOutput === 'object' && falOutput !== null && 'url' in falOutput)
          ? String((falOutput as { url: unknown }).url)
          : String(falOutput);
      
      return {
        type: 'image',
        images: [{ url }],
      };
    }
  } else if (outputType === 'video') {
    // Handle video outputs
    if (outputFormat.includes('url[]') || outputFormat === 'url[]') {
      // Array of URLs
      if (Array.isArray(falOutput)) {
        return {
          type: 'video',
          videos: falOutput.map((vid) => {
            // Handle both string URLs and objects with url property
            if (typeof vid === 'string') {
              return { url: vid };
            }
            if (typeof vid === 'object' && vid !== null && 'url' in vid) {
              return { url: String((vid as { url: unknown }).url) };
            }
            return { url: String(vid) };
          }),
        };
      }
        // Try to extract videos array from object
        if (typeof falOutput === 'object' && falOutput !== null) {
          const outputObj = falOutput as Record<string, unknown>;
          if ('videos' in outputObj && Array.isArray(outputObj.videos)) {
            return {
              type: 'video',
              videos: outputObj.videos.map((vid) => {
                // Handle both string URLs and objects with url property
                if (typeof vid === 'string') {
                  return { url: vid };
                }
                if (typeof vid === 'object' && vid !== null && 'url' in vid) {
                  return { url: String((vid as { url: unknown }).url) };
                }
                return { url: String(vid) };
              }),
            };
          }
        if ('urls' in outputObj && Array.isArray(outputObj.urls)) {
          return {
            type: 'video',
            videos: outputObj.urls.map((url) => ({ url: String(url) })),
          };
        }
        if ('video' in outputObj && typeof outputObj.video === 'string') {
          return {
            type: 'video',
            videos: [{ url: outputObj.video }],
          };
        }
      }
    } else {
      // Single URL
      const url = typeof falOutput === 'string' 
        ? falOutput 
        : (typeof falOutput === 'object' && falOutput !== null && 'url' in falOutput)
          ? String((falOutput as { url: unknown }).url)
          : String(falOutput);
      
      return {
        type: 'video',
        videos: [{ url }],
      };
    }
  }

  // Fallback to text
  return {
    type: 'text',
    text: typeof falOutput === 'string' ? falOutput : JSON.stringify(falOutput),
  };
}
