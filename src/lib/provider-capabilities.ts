/**
 * Blok E: Provider Capability Matrix
 * Safety layer: ensure ModelSpec.modality is supported by the provider before execution.
 */

import type { Modality } from '@/src/core/types';
import type { ExecutionProviderSlug } from '@/src/providers/execution';

export interface ProviderCapability {
  supports: {
    textToText: boolean;
    textToImage: boolean;
    imageToImage: boolean;
    imageToVideo: boolean;
    textToVideo: boolean;
    videoToVideo: boolean;
  };
}

const FALAI_CAPABILITY: ProviderCapability = {
  supports: {
    textToText: true,
    textToImage: true,
    imageToImage: true,
    imageToVideo: false,
    textToVideo: true,
    videoToVideo: false,
  },
};

const EACHLABS_CAPABILITY: ProviderCapability = {
  supports: {
    textToText: true,
    textToImage: true,
    imageToImage: true,
    imageToVideo: false,
    textToVideo: true,
    videoToVideo: false,
  },
};

const CAPABILITY_MAP: Record<ExecutionProviderSlug, ProviderCapability> = {
  falai: FALAI_CAPABILITY,
  eachlabs: EACHLABS_CAPABILITY,
};

const EMPTY_CAPABILITY: ProviderCapability = {
  supports: {
    textToText: false,
    textToImage: false,
    imageToImage: false,
    imageToVideo: false,
    textToVideo: false,
    videoToVideo: false,
  },
};

/**
 * Get capability matrix for a provider.
 */
export function getProviderCapability(provider: ExecutionProviderSlug): ProviderCapability {
  return CAPABILITY_MAP[provider] ?? EMPTY_CAPABILITY;
}

/** Map Modality to capability key */
const MODALITY_TO_KEY: Record<Modality, keyof ProviderCapability['supports']> = {
  'text-to-text': 'textToText',
  'text-to-image': 'textToImage',
  'image-to-image': 'imageToImage',
  'image-to-video': 'imageToVideo',
  'text-to-video': 'textToVideo',
  'video-to-video': 'videoToVideo',
};

/**
 * Check if provider supports the given modality.
 */
export function supportsModality(
  provider: ExecutionProviderSlug,
  modality: Modality
): boolean {
  const capability = getProviderCapability(provider);
  const key = MODALITY_TO_KEY[modality];
  if (!key) return false;
  return capability.supports[key] ?? false;
}
