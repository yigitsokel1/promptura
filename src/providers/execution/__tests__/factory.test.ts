/**
 * Blok E: Unit tests for execution provider factory
 */
import { executionProviderFactory } from '../factory';
import { FalAIExecutionProvider } from '../falai';
import { EachLabsExecutionProvider } from '../eachlabs';

describe('executionProviderFactory', () => {
  it('returns FalAIExecutionProvider for falai', () => {
    const provider = executionProviderFactory('falai', 'test-fal-key');
    expect(provider).toBeInstanceOf(FalAIExecutionProvider);
    expect(provider.submit).toBeDefined();
    expect(provider.getStatus).toBeDefined();
    expect(provider.getResult).toBeDefined();
    expect(provider.buildPayload).toBeDefined();
    expect(provider.convertToRunOutput).toBeDefined();
  });

  it('returns EachLabsExecutionProvider for eachlabs', () => {
    const provider = executionProviderFactory('eachlabs', 'test-eachlabs-key');
    expect(provider).toBeInstanceOf(EachLabsExecutionProvider);
    expect(provider.submit).toBeDefined();
    expect(provider.getStatus).toBeDefined();
    expect(provider.getResult).toBeDefined();
    expect(provider.buildPayload).toBeDefined();
    expect(provider.convertToRunOutput).toBeDefined();
  });

  it('throws for unknown provider', () => {
    expect(() =>
      executionProviderFactory('unknown' as 'falai', 'key')
    ).toThrow('Unknown execution provider');
  });
});
