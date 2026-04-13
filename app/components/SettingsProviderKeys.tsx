'use client';

import { useState, useEffect, useCallback } from 'react';

type ProviderSlug = 'falai' | 'eachlabs' | 'gemini';

const LABELS: Record<ProviderSlug, string> = {
  falai: 'fal.ai',
  eachlabs: 'EachLabs',
  gemini: 'Gemini',
};

export function SettingsProviderKeys() {
  const [configured, setConfigured] = useState<Record<ProviderSlug, boolean>>({
    falai: false,
    eachlabs: false,
    gemini: false,
  });
  const [falaiKey, setFalaiKey] = useState('');
  const [eachlabsKey, setEachlabsKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ProviderSlug | null>(null);
  const [testing, setTesting] = useState<ProviderSlug | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/settings/providers')
      .then((r) => r.json())
      .then((data) => {
        if (data.providers) setConfigured(data.providers);
        if (data.error) setMessage({ type: 'err', text: data.error });
      })
      .catch(() => setMessage({ type: 'err', text: 'Failed to load provider status' }))
      .finally(() => setLoading(false));
  }, []);

  const fetchConfigured = useCallback(async () => {
    const res = await fetch('/api/settings/providers');
    const data = await res.json();
    if (data.providers) setConfigured(data.providers);
  }, []);

  const saveKey = async (provider: ProviderSlug) => {
    const value = (provider === 'falai' ? falaiKey : provider === 'eachlabs' ? eachlabsKey : geminiKey).trim();
    if (!value) {
      setMessage({ type: 'err', text: 'Enter an API key first.' });
      return;
    }
    setSaving(provider);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setMessage({ type: 'ok', text: `${LABELS[provider]} key saved. Stored encrypted, never shown.` });
      if (provider === 'falai') setFalaiKey('');
      if (provider === 'eachlabs') setEachlabsKey('');
      if (provider === 'gemini') setGeminiKey('');
      await fetchConfigured();
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(null);
    }
  };

  const testConnection = async (provider: ProviderSlug) => {
    const value = provider === 'falai' ? falaiKey : provider === 'eachlabs' ? eachlabsKey : geminiKey;
    setTesting(provider);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: value || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage({ type: 'ok', text: `${LABELS[provider]} connection OK.` });
      } else {
        setMessage({ type: 'err', text: data.error || 'Connection failed' });
      }
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading provider status…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
          Provider API keys
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Keys are encrypted and never sent to the client. Required for running models in the Playground.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200'
          }`}
        >
          <p>{message.text}</p>
        </div>
      )}

      <div className="space-y-6">
        {(['falai', 'eachlabs', 'gemini'] as const).map((provider) => (
          <section
            key={provider}
            className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <h3 className="font-medium text-zinc-900 dark:text-white">
              {LABELS[provider]}
              {configured[provider] && (
                <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">
                  configured
                </span>
              )}
            </h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {provider === 'falai'
                ? 'Used for fal.ai image/video models in the Playground.'
                : provider === 'eachlabs'
                  ? 'Used for EachLabs models in the Playground.'
                  : 'Used for prompt generation in the Playground (Generate/Refine).'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                type="password"
                placeholder={configured[provider] ? '•••••••• (leave blank to keep)' : 'Paste API key'}
                value={provider === 'falai' ? falaiKey : provider === 'eachlabs' ? eachlabsKey : geminiKey}
                onChange={(e) =>
                  provider === 'falai'
                    ? setFalaiKey(e.target.value)
                    : provider === 'eachlabs'
                      ? setEachlabsKey(e.target.value)
                      : setGeminiKey(e.target.value)
                }
                className="min-w-[220px] rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
              <button
                type="button"
                onClick={() => saveKey(provider)}
                disabled={saving === provider}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                {saving === provider ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => testConnection(provider)}
                disabled={testing === provider}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {testing === provider ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
