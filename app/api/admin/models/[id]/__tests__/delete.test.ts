/**
 * DELETE /api/admin/models/[id] — ADMIN only; 204, 401, 404
 */
import { Prisma } from '@prisma/client';
import { DELETE } from '../route';
import { NextRequest } from 'next/server';
import { prisma } from '@/src/db/client';
import { requireAdmin } from '@/src/lib/auth';

jest.mock('@/src/lib/auth', () => ({
  requireAdmin: jest.fn(),
  unauthorizedResponse: jest.fn(() =>
    new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

jest.mock('@/src/db/client', () => ({
  prisma: {
    modelEndpoint: {
      delete: jest.fn(),
    },
  },
}));

describe('DELETE /api/admin/models/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when not admin', async () => {
    (requireAdmin as jest.Mock).mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost/api/admin/models/m1');
    const response = await DELETE(request, { params: Promise.resolve({ id: 'm1' }) });

    expect(response.status).toBe(401);
    expect(prisma.modelEndpoint.delete).not.toHaveBeenCalled();
  });

  it('returns 204 when delete succeeds', async () => {
    (requireAdmin as jest.Mock).mockResolvedValueOnce({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (prisma.modelEndpoint.delete as jest.Mock).mockResolvedValueOnce({});

    const request = new NextRequest('http://localhost/api/admin/models/m1');
    const response = await DELETE(request, { params: Promise.resolve({ id: 'm1' }) });

    expect(response.status).toBe(204);
    expect(prisma.modelEndpoint.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(await response.text()).toBe('');
  });

  it('returns 404 when model does not exist', async () => {
    (requireAdmin as jest.Mock).mockResolvedValueOnce({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    const notFound = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    (prisma.modelEndpoint.delete as jest.Mock).mockRejectedValueOnce(notFound);

    const request = new NextRequest('http://localhost/api/admin/models/missing');
    const response = await DELETE(request, { params: Promise.resolve({ id: 'missing' }) });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('Model not found');
  });
});
