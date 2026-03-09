/**
 * AdminSettings — System-level runtime configuration.
 *
 * Currently covers the AI assistant section (provider, API key, model, base URL).
 * Settings follow DB-wins-over-env precedence: a value saved here overrides the
 * environment variable; clearing it reverts to the env fallback.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAISettings, testAISettings, updateAISettings } from '../../api/settings'
import type { AISettingsOut } from '../../api/settings'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 border transition-colors'
const inputSty = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }

function SourceBadge({ source }: { source: string }) {
  if (source === 'db') {
    return (
      <span
        className="text-xs px-1.5 py-0.5 rounded font-medium"
        style={{ backgroundColor: 'rgba(99,102,241,0.12)', color: '#818cf8' }}
      >
        database
      </span>
    )
  }
  if (source === 'env') {
    return (
      <span
        className="text-xs px-1.5 py-0.5 rounded font-medium"
        style={{ backgroundColor: 'rgba(100,116,139,0.15)', color: 'var(--c-muted-3)' }}
      >
        env
      </span>
    )
  }
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-medium"
      style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171' }}
    >
      not set
    </span>
  )
}

// ── AI Settings section ───────────────────────────────────────────────────────

function AISection({ current }: { current: AISettingsOut }) {
  const qc = useQueryClient()

  const [provider, setProvider] = useState(current.provider)
  const [apiKey, setApiKey] = useState('')          // empty = keep existing
  const [model, setModel] = useState(current.model)
  const [baseUrl, setBaseUrl] = useState(current.base_url)
  const [clearKey, setClearKey] = useState(false)   // explicit "remove" toggle
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const saveMut = useMutation({
    mutationFn: () =>
      updateAISettings({
        provider,
        api_key: clearKey ? '' : (apiKey || null),  // null = keep existing
        model,
        base_url: baseUrl,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-ai'] })
      setApiKey('')
      setClearKey(false)
    },
  })

  const testMut = useMutation({
    mutationFn: testAISettings,
    onSuccess: (r) => {
      setTestResult(
        r.enabled
          ? { ok: true, msg: `Connected — ${r.provider} / ${r.model}` }
          : { ok: false, msg: r.error ?? 'Provider disabled' },
      )
    },
    onError: (e: Error) => {
      setTestResult({ ok: false, msg: e.message })
    },
  })

  const isOpenAI = provider === 'openai'

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(168,85,247,0.2))', border: '1px solid rgba(99,102,241,0.3)' }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" style={{ color: '#a5b4fc' }}>
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-100">AI Assistant</h2>
          <p className="text-xs" style={{ color: 'var(--c-muted-3)' }}>
            Powers the AI template generation feature in the Template Editor, Features, and Quickpads.
          </p>
        </div>
      </div>

      {/* Precedence note */}
      <div
        className="rounded-lg px-3 py-2.5 text-xs"
        style={{ backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', color: 'var(--c-muted-3)' }}
      >
        Values saved here override environment variables.{' '}
        Clear a field to revert to the env fallback. The <span style={{ color: '#a5b4fc' }}>database</span> badge
        means the value comes from this page; <span style={{ color: 'var(--c-muted-3)' }}>env</span> means it comes from the server environment.
      </div>

      {/* Provider */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>Provider</label>
          <SourceBadge source={current.source.provider} />
        </div>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className={inputCls}
          style={{ ...inputSty, color: 'var(--c-text)' }}
        >
          <option value="" style={{ backgroundColor: 'var(--c-card)' }}>Disabled</option>
          <option value="anthropic" style={{ backgroundColor: 'var(--c-card)' }}>Anthropic (Claude)</option>
          <option value="openai" style={{ backgroundColor: 'var(--c-card)' }}>OpenAI-compatible</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
          "OpenAI-compatible" works with OpenAI, Azure OpenAI, Ollama, LM Studio, and similar APIs.
        </p>
      </div>

      {/* API Key */}
      {provider && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>API Key</label>
            <SourceBadge source={current.source.api_key} />
          </div>

          {clearKey ? (
            <div
              className="rounded-md px-3 py-2 text-xs flex items-center justify-between"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <span style={{ color: '#f87171' }}>API key will be cleared — env fallback will be used</span>
              <button
                onClick={() => setClearKey(false)}
                className="text-xs underline ml-3"
                style={{ color: 'var(--c-muted-3)' }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={current.api_key_configured ? '••••••••  (leave blank to keep existing)' : 'Enter API key'}
                className={`${inputCls} flex-1`}
                style={inputSty}
                autoComplete="new-password"
              />
              {current.source.api_key === 'db' && (
                <button
                  onClick={() => setClearKey(true)}
                  title="Remove DB override — revert to env"
                  className="px-2.5 rounded-md text-xs shrink-0 transition-colors"
                  style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted-4)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#f87171' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-4)' }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Model */}
      {provider && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>Model</label>
            <SourceBadge source={current.source.model} />
          </div>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o'}
            className={inputCls}
            style={inputSty}
          />
        </div>
      )}

      {/* Base URL — OpenAI only */}
      {isOpenAI && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>Base URL</label>
            <SourceBadge source={current.source.base_url} />
          </div>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className={inputCls}
            style={inputSty}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
            Must end with <code>/v1</code> — do <strong>not</strong> include <code>/chat/completions</code>.
          </p>
          {/* Quick-fill presets */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[
              { label: 'OpenAI', url: 'https://api.openai.com/v1' },
              { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
              { label: 'Ollama', url: 'http://localhost:11434/v1' },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setBaseUrl(p.url)}
                className="text-xs px-2 py-0.5 rounded transition-colors"
                style={{ border: '1px solid var(--c-border)', color: 'var(--c-muted-3)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#a5b4fc'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.4)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border)' }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {baseUrl.includes('openrouter') && (
            <div
              className="mt-2 rounded px-2.5 py-2 text-xs"
              style={{ backgroundColor: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', color: '#fbbf24' }}
            >
              OpenRouter models use the format <code>provider/model-name</code>, e.g.{' '}
              <code>anthropic/claude-sonnet-4-6</code> or <code>openai/gpt-4o</code>.
              Set the Model field above accordingly.
            </div>
          )}
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div
          className="rounded-lg px-3 py-2.5 text-xs flex items-center gap-2"
          style={{
            backgroundColor: testResult.ok ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${testResult.ok ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)'}`,
            color: testResult.ok ? '#34d399' : '#f87171',
          }}
        >
          <span>{testResult.ok ? '✓' : '✗'}</span>
          <span>{testResult.msg}</span>
        </div>
      )}

      {/* Errors */}
      {saveMut.isError && (
        <div
          className="rounded-lg px-3 py-2.5 text-xs"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
        >
          {(saveMut.error as Error)?.message ?? 'Save failed'}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => { setTestResult(null); testMut.mutate() }}
          disabled={testMut.isPending || !provider}
          className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
          style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-2)' }}
        >
          {testMut.isPending ? 'Testing…' : 'Test connection'}
        </button>
        <button
          onClick={() => { setTestResult(null); saveMut.mutate() }}
          disabled={saveMut.isPending}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-all"
          style={{ background: 'linear-gradient(135deg,#6366f1,#818cf8)', boxShadow: '0 4px 14px rgba(99,102,241,0.25)' }}
        >
          {saveMut.isPending ? 'Saving…' : saveMut.isSuccess ? '✓ Saved' : 'Save settings'}
        </button>
      </div>
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminSettings() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['settings-ai'],
    queryFn: getAISettings,
  })

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold text-slate-100 font-display">Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>
          Runtime configuration stored in the database. Changes take effect immediately without a restart.
        </p>
      </div>

      <div
        className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        {isLoading && (
          <p className="text-sm italic text-center py-8" style={{ color: 'var(--c-muted-4)' }}>
            Loading settings…
          </p>
        )}
        {error && (
          <p className="text-sm text-center py-8" style={{ color: '#f87171' }}>
            Failed to load settings.
          </p>
        )}
        {data && <AISection current={data} />}
      </div>
    </div>
  )
}
