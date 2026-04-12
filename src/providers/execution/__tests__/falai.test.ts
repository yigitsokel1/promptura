/**
 * FalAIExecutionProvider: queue status mapping and edge cases.
 */
import { FalAIExecutionProvider } from '../falai';
import type { FalAIClient } from '@/src/providers/falai/client';

function createMockClient(partial: {
  getQueueJobStatus?: FalAIClient['getQueueJobStatus'];
  getQueueJobResult?: FalAIClient['getQueueJobResult'];
}): FalAIClient {
  return {
    getQueueJobStatus: partial.getQueueJobStatus ?? jest.fn(),
    getQueueJobResult: partial.getQueueJobResult ?? jest.fn(),
    submitQueueJob: jest.fn(),
    uploadFile: jest.fn(),
  } as unknown as FalAIClient;
}

describe('FalAIExecutionProvider', () => {
  const endpointId = 'fal-ai/test-model';
  const requestId = 'req-123';

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getStatus', () => {
    it('maps IN_PROGRESS to running', async () => {
      const client = createMockClient({
        getQueueJobStatus: jest.fn().mockResolvedValue({
          status: 'IN_PROGRESS',
          request_id: requestId,
          response_url: undefined,
        }),
      });
      const provider = new FalAIExecutionProvider(client);
      await expect(provider.getStatus(endpointId, requestId)).resolves.toBe('running');
    });

    it('returns failed for unmapped queue status (not infinite running)', async () => {
      const client = createMockClient({
        getQueueJobStatus: jest.fn().mockResolvedValue({
          status: 'MYSTERY_STATE',
          request_id: requestId,
          response_url: undefined,
        }),
      });
      const provider = new FalAIExecutionProvider(client);
      await expect(provider.getStatus(endpointId, requestId)).resolves.toBe('failed');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unmapped queue status')
      );
    });

    it('returns failed for empty status string', async () => {
      const client = createMockClient({
        getQueueJobStatus: jest.fn().mockResolvedValue({
          status: '',
          request_id: requestId,
          response_url: undefined,
        }),
      });
      const provider = new FalAIExecutionProvider(client);
      await expect(provider.getStatus(endpointId, requestId)).resolves.toBe('failed');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Empty queue status'));
    });
  });

  describe('getResult', () => {
    it('returns failed execution status when result payload has unmapped status', async () => {
      const client = createMockClient({
        getQueueJobResult: jest.fn().mockResolvedValue({
          output: undefined,
          error: undefined,
          status: 'WEIRD',
        }),
      });
      const provider = new FalAIExecutionProvider(client);
      const out = await provider.getResult(endpointId, requestId);
      expect(out.status).toBe('failed');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unmapped queue status')
      );
    });
  });
});
