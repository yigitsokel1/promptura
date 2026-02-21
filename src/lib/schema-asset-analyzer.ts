/**
 * Single authority for required_assets from request schema (provider-agnostic).
 * Input: schema property keys + optional required array (fal.ai OpenAPI or eachlabs request_schema).
 * Output: required_assets + detected_input_fields (allowlist + denylist in modality-inference).
 * T2I config fields (image_size, num_images, width, height) are denylisted → required_assets=none.
 */

import type { RequiredAssets } from '@/src/core/modelSpec';
import {
  inferRequiredAssetsFromPropertyKeys,
  isImageAssetKey,
  isVideoAssetKey,
} from '@/src/lib/modality-inference';

export interface SchemaAssetAnalyzerInput {
  /** All request body property names (e.g. from schema.properties keys). */
  propertyKeys: string[];
  /** When present, only these keys count as required for asset inference. */
  required?: string[];
}

export interface SchemaAssetAnalyzerResult {
  required_assets: RequiredAssets;
  /** Asset-related property names that contributed to the result (debug). */
  detected_input_fields: string[];
}

/**
 * Analyze schema property keys and optional required array to derive required_assets
 * and which input fields were detected as asset fields. Deterministic; no provider logic.
 *
 * @param input - propertyKeys (all property names) and optional required array
 * @returns required_assets and detected_input_fields for debug/logging
 */
export function analyzeSchemaForAssets(
  input: SchemaAssetAnalyzerInput
): SchemaAssetAnalyzerResult {
  const { propertyKeys, required } = input;
  const required_assets = inferRequiredAssetsFromPropertyKeys(propertyKeys, {
    required: required ?? undefined,
  });
  const detected_input_fields = propertyKeys.filter(
    (k) => isImageAssetKey(k) || isVideoAssetKey(k)
  );
  return { required_assets, detected_input_fields };
}
