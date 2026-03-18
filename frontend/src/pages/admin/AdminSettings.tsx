/**
 * AdminSettings — System-level runtime configuration.
 *
 * Sections:
 *   1. Usage stats cards (org-level aggregates, auto-refresh 60s)
 *   2. Org settings (display_name, logo, timezone, retention_days)
 *   3. Email / SMTP (host, port, user, password, from address)
 *   4. AI assistant (provider, API key, model, base URL)
 *
 * All settings follow DB-wins-over-env precedence.
 *   2. Org settings (display_name, logo_url, timezone, retention_days)
 *   3. AI assistant (provider, API key, model, base URL)
 *
 * Settings follow DB-wins-over-env precedence for AI: a value saved here
 * overrides the environment variable; clearing it reverts to the env fallback.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAISettings, testAISettings, updateAISettings, getEmailSettings, updateEmailSettings, testEmailSettings } from '../../api/settings'
import { getOrgSettings, patchOrgSettings, getOrgStats } from '../../api/admin'
import type { AISettingsOut, EmailSettingsOut } from '../../api/settings'
import type { OrgSettingsOut, OrgStatsOut } from '../../api/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 border transition-colors'
const inputSty = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(168,85,247,0.2))', border: '1px solid rgba(99,102,241,0.3)' }}
      >
        {icon}
      </div>
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <p className="text-xs" style={{ color: 'var(--c-muted-3)' }}>{subtitle}</p>
      </div>
    </div>
  )
}

// ── Stats section ─────────────────────────────────────────────────────────────

function StatCard({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}
    >
      {loading ? (
        <div className="h-7 w-12 rounded skeleton" />
      ) : (
        <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--c-text)' }}>
          {value?.toLocaleString() ?? '–'}
        </p>
      )}
      <p className="text-xs" style={{ color: 'var(--c-muted-4)' }}>{label}</p>
    </div>
  )
}

function StatsSection({ stats, loading }: { stats: OrgStatsOut | undefined; loading: boolean }) {
  const cards: { label: string; key: keyof OrgStatsOut }[] = [
    { label: 'Users', key: 'users_total' },
    { label: 'Projects', key: 'projects_total' },
    { label: 'Templates', key: 'templates_total' },
    { label: 'Renders (all)', key: 'renders_total' },
    { label: 'Renders (30d)', key: 'renders_last_30d' },
    { label: 'Renders (7d)', key: 'renders_last_7d' },
    { label: 'Active API keys', key: 'api_keys_active' },
    { label: 'Git templates', key: 'storage_templates_count' },
  ]

  return (
    <section className="space-y-5">
      <SectionHeader
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" style={{ color: '#a5b4fc' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        }
        title="Usage Statistics"
        subtitle="Organisation-wide counts, refreshed every minute."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => (
          <StatCard key={c.key} label={c.label} value={stats?.[c.key]} loading={loading} />
        ))}
      </div>
    </section>
  )
}

// ── Org settings section ──────────────────────────────────────────────────────

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Australia/Sydney',
]

function OrgSection({ current }: { current: OrgSettingsOut }) {
  const qc = useQueryClient()

  const [displayName, setDisplayName] = useState(current.display_name ?? '')
  const [logoUrl, setLogoUrl] = useState(current.logo_url ?? '')
  const [timezone, setTimezone] = useState(current.timezone ?? 'UTC')
  const [retentionDays, setRetentionDays] = useState(
    current.retention_days != null ? String(current.retention_days) : ''
  )

  const saveMut = useMutation({
    mutationFn: () =>
      patchOrgSettings({
        display_name: displayName.trim() || null,
        logo_url: logoUrl.trim() || null,
        timezone,
        retention_days: retentionDays.trim() ? parseInt(retentionDays, 10) : null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-settings'] }),
  })

  return (
    <section className="space-y-5">
      <SectionHeader
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" style={{ color: '#a5b4fc' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
        }
        title="Organisation Settings"
        subtitle="Display preferences and data retention policy."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
            Display name
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={current.name}
            className={inputCls}
            style={inputSty}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
            Shown in the UI instead of the internal slug.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
            Logo URL
          </label>
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…/logo.png"
            className={inputCls}
            style={inputSty}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
            Optional — replaces the Templarc logo in the sidebar.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
            Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputCls}
            style={{ ...inputSty, color: 'var(--c-text)' }}
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz} style={{ backgroundColor: 'var(--c-card)' }}>{tz}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>
            Render history retention (days)
          </label>
          <input
            type="number"
            value={retentionDays}
            onChange={(e) => setRetentionDays(e.target.value)}
            placeholder="∞ keep forever"
            min={1}
            className={inputCls}
            style={inputSty}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
            Leave blank to keep render history forever. Purged nightly.
          </p>
        </div>
      </div>

      {saveMut.isError && (
        <div
          className="rounded-lg px-3 py-2.5 text-xs"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
        >
          {(saveMut.error as Error)?.message ?? 'Save failed'}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => saveMut.mutate()}
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

// ── AI Settings section ───────────────────────────────────────────────────────

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

function AISection({ current }: { current: AISettingsOut }) {
  const qc = useQueryClient()

  const [provider, setProvider] = useState(current.provider)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(current.model)
  const [baseUrl, setBaseUrl] = useState(current.base_url)
  const [clearKey, setClearKey] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const saveMut = useMutation({
    mutationFn: () =>
      updateAISettings({
        provider,
        api_key: clearKey ? '' : (apiKey || null),
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
      <SectionHeader
        icon={
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" style={{ color: '#a5b4fc' }}>
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        }
        title="AI Assistant"
        subtitle="Powers AI template generation in the Template Editor, Features, and Quickpads."
      />

      <div
        className="rounded-lg px-3 py-2.5 text-xs"
        style={{ backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', color: 'var(--c-muted-3)' }}
      >
        Values saved here override environment variables.{' '}
        Clear a field to revert to the env fallback. The <span style={{ color: '#a5b4fc' }}>database</span> badge
        means the value comes from this page; <span style={{ color: 'var(--c-muted-3)' }}>env</span> means it comes from the server environment.
      </div>

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

      {saveMut.isError && (
        <div
          className="rounded-lg px-3 py-2.5 text-xs"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
        >
          {(saveMut.error as Error)?.message ?? 'Save failed'}
        </div>
      )}

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

// ── Email / SMTP section ──────────────────────────────────────────────────────

function EmailSection({ current }: { current: EmailSettingsOut }) {
  const qc = useQueryClient()

  const [host, setHost] = useState(current.host)
  const [port, setPort] = useState(current.port ? String(current.port) : '')
  const [user, setUser] = useState(current.user)
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [from_, setFrom_] = useState(current.from_)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const saveMut = useMutation({
    mutationFn: () =>
      updateEmailSettings({
        host: host || null,
        port: port ? parseInt(port, 10) : null,
        user: user || null,
        password: clearPassword ? '' : (password || null),
        from_: from_ || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-email'] })
      setPassword('')
      setClearPassword(false)
    },
  })

  const testMut = useMutation({
    mutationFn: testEmailSettings,
    onSuccess: (r) => {
      setTestResult(r.success ? { ok: true, msg: 'Test email sent successfully.' } : { ok: false, msg: r.error ?? 'Send failed' })
    },
    onError: (e: Error) => setTestResult({ ok: false, msg: e.message }),
  })

  return (
    <section className="space-y-5">
      <SectionHeader
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" style={{ color: '#a5b4fc' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        }
        title="Email / SMTP"
        subtitle="Outbound mail for password resets and notifications."
      />

      <div
        className="rounded-lg px-3 py-2.5 text-xs"
        style={{ backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', color: 'var(--c-muted-3)' }}
      >
        Values saved here override environment variables.{' '}
        Clear a field to revert to the env fallback. The <span style={{ color: '#a5b4fc' }}>database</span> badge
        means the value comes from this page; <span style={{ color: 'var(--c-muted-3)' }}>env</span> means it comes from the server environment.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>SMTP Host</label>
            <SourceBadge source={current.source.host} />
          </div>
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.example.com"
            className={inputCls}
            style={inputSty}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>SMTP Port</label>
            <SourceBadge source={current.source.port} />
          </div>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="587"
            min={1}
            max={65535}
            className={inputCls}
            style={inputSty}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>587 (STARTTLS) or 465 (SSL)</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>Username</label>
            <SourceBadge source={current.source.user} />
          </div>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="mailuser@example.com"
            className={inputCls}
            style={inputSty}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>Password</label>
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={
                current.password_configured
                  ? { backgroundColor: 'rgba(52,211,153,0.1)', color: '#34d399' }
                  : { backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171' }
              }
            >
              {current.password_configured ? 'configured' : 'not set'}
            </span>
          </div>
          {clearPassword ? (
            <div
              className="rounded-md px-3 py-2 text-xs flex items-center justify-between"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <span style={{ color: '#f87171' }}>Password will be cleared — env fallback will be used</span>
              <button onClick={() => setClearPassword(false)} className="text-xs underline ml-3" style={{ color: 'var(--c-muted-3)' }}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={current.password_configured ? '••••••••  (leave blank to keep existing)' : 'Enter password'}
                className={`${inputCls} flex-1`}
                style={inputSty}
                autoComplete="new-password"
              />
              {current.password_configured && (
                <button
                  onClick={() => setClearPassword(true)}
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

        <div className="sm:col-span-2">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>From address</label>
            <SourceBadge source={current.source.from_} />
          </div>
          <input
            value={from_}
            onChange={(e) => setFrom_(e.target.value)}
            placeholder="Templarc <noreply@example.com>"
            className={inputCls}
            style={inputSty}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
            Envelope "From" for all outbound mail. Supports display name format.
          </p>
        </div>
      </div>

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

      {saveMut.isError && (
        <div
          className="rounded-lg px-3 py-2.5 text-xs"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
        >
          {(saveMut.error as Error)?.message ?? 'Save failed'}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => { setTestResult(null); testMut.mutate() }}
          disabled={testMut.isPending}
          className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
          style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-2)' }}
        >
          {testMut.isPending ? 'Sending…' : 'Send test email'}
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

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <hr style={{ borderColor: 'var(--c-border)' }} />
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminSettings() {
  const { data: aiData, isLoading: aiLoading, error: aiError } = useQuery({
    queryKey: ['settings-ai'],
    queryFn: getAISettings,
  })

  const { data: emailData, isLoading: emailLoading, error: emailError } = useQuery({
    queryKey: ['settings-email'],
    queryFn: getEmailSettings,
  })

  const { data: orgData, isLoading: orgLoading } = useQuery({
    queryKey: ['org-settings'],
    queryFn: getOrgSettings,
  })

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['org-stats'],
    queryFn: getOrgStats,
    staleTime: 60_000,
  })

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold text-slate-100 font-display">Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>
          Runtime configuration stored in the database. Changes take effect immediately without a restart.
        </p>
      </div>

      {/* Stats */}
      <div
        className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <StatsSection stats={statsData} loading={statsLoading} />
      </div>

      {/* Org settings */}
      <div
        className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        {orgLoading && (
          <p className="text-sm italic text-center py-8" style={{ color: 'var(--c-muted-4)' }}>
            Loading…
          </p>
        )}
        {orgData && <OrgSection current={orgData} />}
      </div>

      {/* Email settings */}
      <div
        className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        {emailLoading && (
          <p className="text-sm italic text-center py-8" style={{ color: 'var(--c-muted-4)' }}>
            Loading…
          </p>
        )}
        {emailError && (
          <p className="text-sm text-center py-8" style={{ color: '#f87171' }}>
            Failed to load email settings.
          </p>
        )}
        {emailData && <EmailSection current={emailData} />}
      </div>

      {/* AI settings */}
      <div
        className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        {aiLoading && (
          <p className="text-sm italic text-center py-8" style={{ color: 'var(--c-muted-4)' }}>
            Loading settings…
          </p>
        )}
        {aiError && (
          <p className="text-sm text-center py-8" style={{ color: '#f87171' }}>
            Failed to load AI settings.
          </p>
        )}
        {aiData && <AISection current={aiData} />}
      </div>
    </div>
  )
}
