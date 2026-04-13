import { EachLabsExecutionProvider } from '../eachlabs';

function mockFetchResponse(body: unknown, ok = true, status = 200, statusText = 'OK') {
  return {
    ok,
    status,
    statusText,
    headers: {
      get: jest.fn().mockReturnValue(null),
    },
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  };
}

describe('EachLabsExecutionProvider', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('extracts nested error message from object payload', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      mockFetchResponse({
        status: 'error',
        error: { message: 'insufficient balance for this model' },
      }) as unknown as Response
    );
    const provider = new EachLabsExecutionProvider('test-key');
    const result = await provider.getResult('eachlabs/model', 'pred-1');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('insufficient balance');
  });

  it('includes prediction id when provider gives no details', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      mockFetchResponse({
        status: 'error',
      }) as unknown as Response
    );
    const provider = new EachLabsExecutionProvider('test-key');
    const result = await provider.getResult('eachlabs/model', 'pred-xyz');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('predictionId: pred-xyz');
  });

  it('adds default aspect_ratio for text-to-video payloads without media inputs', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        mockFetchResponse({ version: '1.0' }) as unknown as Response
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ predictionID: 'pred-123' }) as unknown as Response
      );
    const provider = new EachLabsExecutionProvider('test-key');
    await provider.submit('kling-o3-pro-text-to-video', { prompt: 'a cinematic city timelapse' });

    const postCall = fetchSpy.mock.calls[1];
    const postBody = JSON.parse(String((postCall[1] as RequestInit).body)) as {
      input: Record<string, unknown>;
    };
    expect(postBody.input.aspect_ratio).toBe('16:9');
  });

  it('does not inject aspect_ratio for unrelated endpoints', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        mockFetchResponse({ version: '1.0' }) as unknown as Response
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ predictionID: 'pred-456' }) as unknown as Response
      );
    const provider = new EachLabsExecutionProvider('test-key');
    await provider.submit('haiper-video-2', { prompt: 'sunset drone shot' });

    const postCall = fetchSpy.mock.calls[1];
    const postBody = JSON.parse(String((postCall[1] as RequestInit).body)) as {
      input: Record<string, unknown>;
    };
    expect(postBody.input.aspect_ratio).toBeUndefined();
  });
});
