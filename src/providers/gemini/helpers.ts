/**
 * Helper functions for Gemini operations
 * Reduces code duplication across API routes
 */

import { createGeminiAdapter } from './index';
import type { FalAIModelMetadata } from '../falai/types';
import type { ResearchGuidelinesResult } from '@/src/core/modelSpec';

/**
 * Research prompt guidelines only (Sprint 7).
 * Returns prompt_guidelines + optional summary. Modality/required_assets come from schema or endpoint.
 */
export async function researchModelWithGemini(
  modelMetadata: FalAIModelMetadata,
  kind: 'model' | 'workflow',
  modality: string
): Promise<ResearchGuidelinesResult> {
  const geminiAdapter = createGeminiAdapter();

  const result = await (
    geminiAdapter as unknown as {
      researchModel: (
        metadata: FalAIModelMetadata,
        kind: 'model' | 'workflow',
        modality: string
      ) => Promise<ResearchGuidelinesResult>;
    }
  ).researchModel(modelMetadata, kind, modality);

  return result;
}
