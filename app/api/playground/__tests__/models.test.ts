/**
 * Blok E: Integration tests — login → protected route
 * GET /api/playground/models requires auth; without session returns 401.
 */
import { GET } from '../models/route';
import { NextRequest } from 'next/server';
import { requireAuth } from '@/src/lib/auth';

jest.mock('@/src/lib/auth', () => ({
  requireAuth: jest.fn(),
  unauthorizedResponse: jest.fn(() =>
    new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

jest.mock('@/src/db/queries', () => ({
  findManyModelEndpointsWithSpecs: jest.fn(() => Promise.resolve([])),
}));

describe('GET /api/playground/models (protected route)', () => {
  it('returns 401 when not logged in', async () => {
    (requireAuth as jest.Mock).mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost/api/playground/models');
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 200 with models when logged in', async () => {
    (requireAuth as jest.Mock).mockResolvedValueOnce({
      user: { id: 'user-1', email: 'u@example.com' },
    });

    const request = new NextRequest('http://localhost/api/playground/models');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('models');
    expect(Array.isArray(data.models)).toBe(true);
  });
});
