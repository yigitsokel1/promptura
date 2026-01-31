/**
 * Helper functions for Gemini operations
 * Reduces code duplication across API routes
 */

import { createGeminiAdapter } from './index';
import type { FalAIModelMetadata } from '../falai/types';
import type { ModelSpec } from '@/src/core/modelSpec';

/**
 * Research a model using Gemini adapter
 * Handles type assertion internally
 */
export async function researchModelWithGemini(
  modelMetadata: FalAIModelMetadata,
  kind: 'model' | 'workflow',
  modality: string
): Promise<ModelSpec> {
  const geminiAdapter = createGeminiAdapter();
  
  // Type assertion needed because researchModel is not in ProviderAdapter interface
  const modelSpec = await (
    geminiAdapter as unknown as {
      researchModel: (
        metadata: FalAIModelMetadata,
        kind: 'model' | 'workflow',
        modality: string
      ) => Promise<ModelSpec>;
    }
  ).researchModel(modelMetadata, kind, modality);

  return modelSpec;
}
