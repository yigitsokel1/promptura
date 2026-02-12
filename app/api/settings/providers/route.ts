/**
 * Blok B: User provider keys API. Keys never returned to client.
 * GET: list which providers are configured (booleans)
 * POST: save key for a provider (body: { provider, apiKey })
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';
import {
  listUserProviderKeys,
  setUserProviderKey,
  getSupportedProviders,
  type ProviderSlug,
} from '@/src/lib/provider-keys';

const VALID_PROVIDERS = getSupportedProviders();

function isValidProvider(p: string): p is ProviderSlug {
  return VALID_PROVIDERS.includes(p as ProviderSlug);
}

export async function GET() {
  const session = await requireAuth();
  if (!session) return unauthorizedResponse();
  try {
    const configured = await listUserProviderKeys(session.user.id);
    return NextResponse.json({
      providers: configured,
      supported: VALID_PROVIDERS,
    });
  } catch (error) {
    console.error('GET /api/settings/providers:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list keys' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return unauthorizedResponse();
  try {
    const body = await request.json();
    const { provider, apiKey } = body as { provider?: string; apiKey?: string };
    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json(
        { error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` },
        { status: 400 }
      );
    }
    const value = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!value) {
      return NextResponse.json(
        { error: 'API key cannot be empty. Enter a key to save.' },
        { status: 400 }
      );
    }
    await setUserProviderKey(session.user.id, provider, value);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save key';
    console.error('POST /api/settings/providers:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
