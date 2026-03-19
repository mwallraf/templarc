import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getHealthDetail, getHealth } from '../api/health'
import type { HealthOut, ComponentCheck } from '../api/types'

function statusColor(s: string) {
  if (s === 'ok') return '#22c55e'
  if (s === 'warn') return '#f59e0b'
  return '#ef4444'
}

function OverallBanner({ status }: { status: string }) {
  const config =
    status === 'ok'
      ? { bg: '#14532d', text: '#4ade80', label: 'All systems operational' }
      : status === 'warn'
      ? { bg: '#78350f', text: '#fbbf24', label: 'Degraded performance' }
      : { bg: '#7f1d1d', text: '#f87171', label: 'Service disruption' }

  return (
    <div
      className="rounded-xl px-6 py-4 text-center text-lg font-semibold mb-8"
      style={{ background: config.bg, color: config.text }}
    >
      {config.label}
    </div>
  )
}

function ComponentCard({ c }: { c: ComponentCheck }) {
  return (
    <div
      className="flex items-start gap-4 px-5 py-4 rounded-xl"
      style={{ background: 'var(--c-surface-2, #1e2030)', border: '1px solid var(--c-border, #2d3148)' }}
    >
      <span
        className="mt-0.5 w-3 h-3 rounded-full flex-shrink-0"
        style={{ background: statusColor(c.status) }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium capitalize" style={{ color: 'var(--c-text, #e2e8f0)' }}>
            {c.name}
          </span>
          {c.latency_ms != null && (
            <span className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--c-surface-3, #252840)', color: 'var(--c-muted-3, #94a3b8)' }}>
              {c.latency_ms}ms
            </span>
          )}
        </div>
        {c.message && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--c-muted-3, #94a3b8)' }}>{c.message}</p>
        )}
      </div>
    </div>
  )
}

export default function StatusPage() {
  const [health, setHealth] = useState<HealthOut | null>(null)
  const [summaryOnly, setSummaryOnly] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [, setTick] = useState(0)

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getHealthDetail()
      setHealth(data)
      setSummaryOnly(false)
      setUnreachable(false)
      setLastChecked(new Date())
    } catch {
      // Fall back to unauthenticated summary
      try {
        const summary = await getHealth()
        setHealth({
          status: summary.status as HealthOut['status'],
          version: summary.version,
          uptime_seconds: summary.uptime_seconds,
          components: [],
        })
        setSummaryOnly(true)
        setUnreachable(false)
        setLastChecked(new Date())
      } catch {
        setUnreachable(true)
        setLastChecked(new Date())
      }
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Tick for "N seconds ago"
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const secondsAgo = lastChecked ? Math.round((Date.now() - lastChecked.getTime()) / 1000) : null

  return (
    <div
      className="min-h-screen flex flex-col items-center py-16 px-4"
      style={{ background: 'var(--c-bg, #0f1117)', color: 'var(--c-text, #e2e8f0)' }}
    >
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold font-display mb-1" style={{ color: 'var(--c-text, #e2e8f0)' }}>
            Templarc
          </h1>
          <p className="text-lg" style={{ color: 'var(--c-muted-3, #94a3b8)' }}>System Status</p>
        </div>

        {unreachable ? (
          <div
            className="rounded-xl px-6 py-4 text-center text-lg font-semibold mb-8"
            style={{ background: '#7f1d1d', color: '#f87171' }}
          >
            Unable to reach server
          </div>
        ) : health ? (
          <>
            <OverallBanner status={health.status} />

            {summaryOnly && (
              <p className="text-xs text-center mb-4" style={{ color: 'var(--c-muted-3, #94a3b8)' }}>
                Component details require authentication.
              </p>
            )}

            {health.components.length > 0 && (
              <div className="flex flex-col gap-3 mb-8">
                {health.components.map(c => (
                  <ComponentCard key={c.name} c={c} />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--c-muted-3, #94a3b8)' }}>
              <span>Version {health.version}</span>
              {secondsAgo !== null && <span>Last checked {secondsAgo}s ago</span>}
            </div>
          </>
        ) : (
          <div className="text-center py-8" style={{ color: 'var(--c-muted-3, #94a3b8)' }}>
            Checking status…
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12">
          <Link to="/login" className="text-sm" style={{ color: 'var(--c-muted-3, #94a3b8)' }}>
            ← Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
