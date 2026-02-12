/**
 * Blok B: Test provider connection. Uses stored key or body.apiKey (not stored).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, unauthorizedResponse } from '@/src/lib/auth';
import { getUserProviderKey, type ProviderSlug } from '@/src/lib/provider-keys';
import { FalAIClient } from '@/src/providers/falai/client';

export async function POST(request: NextRequest) {
  const session = await requireAuth();
  if (!session) return unauthorizedResponse();
  try {
    const body = await request.json();
    const { provider, apiKey: bodyKey } = body as { provider?: string; apiKey?: string };
    if (provider !== 'falai' && provider !== 'eachlabs') {
      return NextResponse.json(
        { error: 'provider must be "falai" or "eachlabs"', ok: false },
        { status: 400 }
      );
    }
    const key = typeof bodyKey === 'string' && bodyKey.trim()
      ? bodyKey.trim()
      : await getUserProviderKey(session.user.id, provider as ProviderSlug);
    if (!key) {
      return NextResponse.json({
        ok: false,
        error: `No API key for ${provider}. Enter a key and try again.`,
      });
    }
    if (provider === 'falai') {
      const client = new FalAIClient({ apiKey: key });
      await client.findModel('fal-ai/flux/dev');
      return NextResponse.json({ ok: true });
    }
    if (provider === 'eachlabs') {
      // Text-to-image model (no image input). Edit models need image → 500 with only prompt.
      const requestBody = {
        model: 'sdxl',
        version: '1.0',
        input: { prompt: 'A small red apple on white background.' }, // valid prompt, no image
      };
      const res = await fetch('https://api.eachlabs.ai/v1/prediction/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify(requestBody),
      });
      const text = await res.text();
      // Debug: on 4xx/5xx log request and response (visible in terminal)
      if (!res.ok) {
        console.error('[EachLabs Test] Request:', JSON.stringify(requestBody, null, 2));
        console.error('[EachLabs Test] Response status:', res.status, res.statusText);
        console.error('[EachLabs Test] Response body:', text || '(empty)');
      }
      if (res.status === 401) {
        return NextResponse.json({ ok: false, error: 'Invalid API key.' });
      }
      if (res.status === 400 || res.status === 200) {
        return NextResponse.json({ ok: true });
      }
      if (res.status === 422 || (res.status >= 500 && res.status <= 599)) {
        return NextResponse.json({ ok: true });
      }
      if (!res.ok) {
        return NextResponse.json({
          ok: false,
          error: res.status === 401 ? 'Invalid API key.' : `Connection failed (${res.status}).`,
        });
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: 'Unknown provider' });
  } catch {
    return NextResponse.json({ ok: false, error: 'Connection failed.' });
  }
}
