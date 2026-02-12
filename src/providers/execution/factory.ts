/**
 * Blok C: Factory for execution providers. No if(provider) at call sites.
 */

import type { ExecutionProvider, ExecutionProviderSlug } from './types';
import { FalAIExecutionProvider } from './falai';
import { EachLabsExecutionProvider } from './eachlabs';
import { FalAIClient } from '@/src/providers/falai/client';

export function executionProviderFactory(
  provider: ExecutionProviderSlug,
  apiKey: string
): ExecutionProvider {
  switch (provider) {
    case 'falai': {
      const client = new FalAIClient({ apiKey });
      return new FalAIExecutionProvider(client);
    }
    case 'eachlabs':
      return new EachLabsExecutionProvider(apiKey);
    default: {
      const _: never = provider;
      throw new Error(`Unknown execution provider: ${String(_)}`);
    }
  }
}
