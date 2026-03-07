/**
 * GitSyncModal — review and apply git↔DB drift in one pass.
 *
 * Phases:
 *   1. loading   — calling GET /admin/git-sync/{id}/status
 *   2. review    — user inspects and (un)checks items, then clicks Apply
 *   3. applying  — POST in flight
 *   4. result    — show SyncReport summary, offer Close
 */

import { useEffect, useRef, useState } from 'react'
import { gitSyncApply, gitSyncStatus } from '../api/templates'
import type { SyncReport, SyncStatusItem, SyncStatusReport } from '../api/types'

interface Props {
  projectId: number
  projectName: string
  onClose: () => void
  onApplied: () => void   // called after a successful apply so parent can refetch
}

// ─── tiny helpers ────────────────────────────────────────────────────────────

function basename(path: string) {
  return path.split('/').pop() ?? path
}

function Spinner() {
  return (
    <svg
      className="animate-spin w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

// ─── row components ───────────────────────────────────────────────────────────

function AddRow({
  item,
  checked,
  onChange,
}: {
  item: SyncStatusItem
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors select-none"
      style={{
        backgroundColor: checked ? 'rgba(34,197,94,0.06)' : 'transparent',
        border: '1px solid',
        borderColor: checked ? 'rgba(34,197,94,0.2)' : 'rgba(30,36,64,0.5)',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded accent-emerald-500 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-xs" style={{ color: checked ? '#4ade80' : 'var(--c-muted-3)' }}>
          {item.git_path}
        </span>
      </div>
      <span
        className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
        style={{ backgroundColor: 'rgba(34,197,94,0.1)', color: '#4ade80' }}
      >
        + add
      </span>
    </label>
  )
}

function RemoveRow({
  item,
  checked,
  onChange,
}: {
  item: SyncStatusItem
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors select-none"
      style={{
        backgroundColor: checked ? 'rgba(245,158,11,0.06)' : 'transparent',
        border: '1px solid',
        borderColor: checked ? 'rgba(245,158,11,0.25)' : 'rgba(30,36,64,0.5)',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded accent-amber-500 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs" style={{ color: checked ? '#fbbf24' : 'var(--c-muted-3)' }}>
          {item.git_path}
        </div>
        {item.template_name && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--c-muted-4)' }}>
            DB record: <span style={{ color: 'var(--c-muted-3)' }}>{item.template_name}</span>
            {item.template_id && (
              <span style={{ color: 'var(--c-border-bright)' }}> #{item.template_id}</span>
            )}
          </div>
        )}
      </div>
      <span
        className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
        style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}
      >
        − remove
      </span>
    </label>
  )
}

function SyncRow({ item }: { item: SyncStatusItem }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg"
      style={{ borderColor: 'transparent' }}
    >
      <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5" style={{ color: 'var(--c-border-bright)' }}>
          <circle cx="6" cy="6" r="6" />
        </svg>
      </div>
      <span className="font-mono text-xs" style={{ color: 'var(--c-border-bright)' }}>
        {item.git_path}
      </span>
    </div>
  )
}

// ─── section header ───────────────────────────────────────────────────────────

function SectionHeader({
  label,
  count,
  color,
  onToggleAll,
  allChecked,
  hasCheckboxes,
}: {
  label: string
  count: number
  color: string
  onToggleAll?: () => void
  allChecked?: boolean
  hasCheckboxes?: boolean
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color }}>
          {label}
        </span>
        <span
          className="text-xs font-mono px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: 'var(--c-muted-3)' }}
        >
          {count}
        </span>
      </div>
      {hasCheckboxes && onToggleAll && (
        <button
          onClick={onToggleAll}
          className="text-xs transition-colors"
          style={{ color: 'var(--c-muted-4)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-3)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-4)')}
        >
          {allChecked ? 'Deselect all' : 'Select all'}
        </button>
      )}
    </div>
  )
}

// ─── result summary ───────────────────────────────────────────────────────────

function ResultPanel({
  report,
  onClose,
}: {
  report: SyncReport
  onClose: () => void
}) {
  const totalChanges = report.imported + report.deleted
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center py-4">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
          style={{ backgroundColor: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6" style={{ color: '#6366f1' }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-white font-semibold">
          {totalChanges === 0 ? 'No changes applied' : `${totalChanges} change${totalChanges !== 1 ? 's' : ''} applied`}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--c-muted-3)' }}>
          Catalog updated successfully
        </p>
      </div>

      <div
        className="rounded-lg p-3 grid grid-cols-2 gap-2"
        style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}
      >
        {[
          { label: 'Imported', value: report.imported, color: '#4ade80' },
          { label: 'Deleted', value: report.deleted, color: '#fbbf24' },
          { label: 'Already in sync', value: report.already_registered, color: 'var(--c-muted-4)' },
          { label: 'Errors', value: report.errors.length, color: report.errors.length > 0 ? '#f87171' : 'var(--c-muted-4)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex flex-col">
            <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>{label}</span>
            <span className="text-lg font-mono font-semibold" style={{ color }}>{value}</span>
          </div>
        ))}
      </div>

      {report.errors.length > 0 && (
        <div className="rounded-lg p-3 space-y-1" style={{ backgroundColor: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p className="text-xs font-semibold" style={{ color: '#f87171' }}>Errors</p>
          {report.errors.map((e) => (
            <div key={e.git_path} className="text-xs">
              <span className="font-mono" style={{ color: 'var(--c-muted-3)' }}>{basename(e.git_path)}</span>
              <span style={{ color: 'var(--c-muted-4)' }}> — {e.error}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onClose}
        className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all"
        style={{
          background: 'linear-gradient(135deg, #6366f1, #818cf8)',
          boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
          color: 'white',
        }}
      >
        Close
      </button>
    </div>
  )
}

// ─── main modal ───────────────────────────────────────────────────────────────

export default function GitSyncModal({ projectId, projectName, onClose, onApplied }: Props) {
  const [phase, setPhase] = useState<'loading' | 'review' | 'applying' | 'result'>('loading')
  const [status, setStatus] = useState<SyncStatusReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [report, setReport] = useState<SyncReport | null>(null)

  // Selection state: set of git_paths
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set())
  const [removeSelected, setRemoveSelected] = useState<Set<string>>(new Set())

  const overlayRef = useRef<HTMLDivElement>(null)

  // Load drift status on mount
  useEffect(() => {
    gitSyncStatus(projectId)
      .then((s) => {
        setStatus(s)
        // Pre-select all items
        setAddSelected(new Set(s.items.filter((i) => i.status === 'in_git_only').map((i) => i.git_path)))
        setRemoveSelected(new Set(s.items.filter((i) => i.status === 'in_db_only').map((i) => i.git_path)))
        setPhase('review')
      })
      .catch((err) => {
        setLoadError(err?.response?.data?.detail ?? err?.message ?? 'Failed to load sync status')
        setPhase('review')
      })
  }, [projectId])

  const toAdd = status?.items.filter((i) => i.status === 'in_git_only') ?? []
  const toRemove = status?.items.filter((i) => i.status === 'in_db_only') ?? []
  const inSync = status?.items.filter((i) => i.status === 'in_sync') ?? []

  const totalSelected = addSelected.size + removeSelected.size

  async function handleApply() {
    setPhase('applying')
    try {
      const result = await gitSyncApply(projectId, {
        import_paths: addSelected.size > 0 ? [...addSelected] : null,
        delete_paths: removeSelected.size > 0 ? [...removeSelected] : null,
      })
      setReport(result)
      setPhase('result')
      onApplied()
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { detail?: string } }; message?: string }
      setLoadError(anyErr?.response?.data?.detail ?? anyErr?.message ?? 'Sync failed')
      setPhase('review')
    }
  }

  // Close on overlay click
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(8,10,18,0.85)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--c-surface)',
          border: '1px solid var(--c-border-bright)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--c-border)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border-bright)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4" style={{ color: '#6366f1' }}>
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Sync from Git</h2>
              <p className="text-xs" style={{ color: 'var(--c-muted-4)' }}>{projectName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'var(--c-muted-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--c-card)'
              e.currentTarget.style.color = 'var(--c-muted-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = 'var(--c-muted-3)'
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">

          {/* Loading */}
          {phase === 'loading' && (
            <div className="flex items-center justify-center py-12 gap-3" style={{ color: 'var(--c-muted-3)' }}>
              <Spinner />
              <span className="text-sm">Checking drift status…</span>
            </div>
          )}

          {/* Error banner */}
          {loadError && (
            <div
              className="rounded-lg px-3 py-2.5 text-sm"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
            >
              {loadError}
            </div>
          )}

          {/* Result */}
          {phase === 'result' && report && (
            <ResultPanel report={report} onClose={onClose} />
          )}

          {/* Review */}
          {(phase === 'review' || phase === 'applying') && status && (
            <>
              {/* Nothing to do */}
              {toAdd.length === 0 && toRemove.length === 0 && (
                <div className="text-center py-8">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3"
                    style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" style={{ color: '#4ade80' }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium" style={{ color: 'var(--c-muted-2)' }}>Everything is in sync</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
                    {inSync.length} template{inSync.length !== 1 ? 's' : ''} match Git
                  </p>
                </div>
              )}

              {/* To Add */}
              {toAdd.length > 0 && (
                <div>
                  <SectionHeader
                    label="New in Git"
                    count={toAdd.length}
                    color="#4ade80"
                    hasCheckboxes
                    allChecked={addSelected.size === toAdd.length}
                    onToggleAll={() => {
                      if (addSelected.size === toAdd.length) {
                        setAddSelected(new Set())
                      } else {
                        setAddSelected(new Set(toAdd.map((i) => i.git_path)))
                      }
                    }}
                  />
                  <div className="space-y-1.5">
                    {toAdd.map((item) => (
                      <AddRow
                        key={item.git_path}
                        item={item}
                        checked={addSelected.has(item.git_path)}
                        onChange={(v) => {
                          const next = new Set(addSelected)
                          v ? next.add(item.git_path) : next.delete(item.git_path)
                          setAddSelected(next)
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* To Remove */}
              {toRemove.length > 0 && (
                <div>
                  <SectionHeader
                    label="Missing from Git"
                    count={toRemove.length}
                    color="#fbbf24"
                    hasCheckboxes
                    allChecked={removeSelected.size === toRemove.length}
                    onToggleAll={() => {
                      if (removeSelected.size === toRemove.length) {
                        setRemoveSelected(new Set())
                      } else {
                        setRemoveSelected(new Set(toRemove.map((i) => i.git_path)))
                      }
                    }}
                  />
                  <div
                    className="rounded-lg p-2.5 mb-2 text-xs"
                    style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', color: '#92400e' }}
                  >
                    <span style={{ color: '#fbbf24' }}>These DB records have no matching git file.</span>
                    {' '}Removing them is permanent and will also delete their parameters and presets.
                  </div>
                  <div className="space-y-1.5">
                    {toRemove.map((item) => (
                      <RemoveRow
                        key={item.git_path}
                        item={item}
                        checked={removeSelected.has(item.git_path)}
                        onChange={(v) => {
                          const next = new Set(removeSelected)
                          v ? next.add(item.git_path) : next.delete(item.git_path)
                          setRemoveSelected(next)
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* In Sync */}
              {inSync.length > 0 && (toAdd.length > 0 || toRemove.length > 0) && (
                <details className="group">
                  <summary
                    className="cursor-pointer text-xs font-semibold uppercase tracking-widest flex items-center gap-2 select-none"
                    style={{ color: 'var(--c-border-bright)' }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="w-3 h-3 transition-transform group-open:rotate-90"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    In sync ({inSync.length})
                  </summary>
                  <div className="mt-2 space-y-0.5">
                    {inSync.map((item) => (
                      <SyncRow key={item.git_path} item={item} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {(phase === 'review' || phase === 'applying') && status && (toAdd.length > 0 || toRemove.length > 0) && (
          <div
            className="px-5 py-4 flex items-center justify-between shrink-0"
            style={{ borderTop: '1px solid var(--c-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
              {totalSelected === 0
                ? 'No items selected'
                : `${totalSelected} action${totalSelected !== 1 ? 's' : ''} selected`}
            </span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={phase === 'applying'}
                className="px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-40"
                style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={totalSelected === 0 || phase === 'applying'}
                className="px-4 py-2 text-sm font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: totalSelected > 0 && phase !== 'applying'
                    ? 'linear-gradient(135deg, #6366f1, #818cf8)'
                    : 'var(--c-elevated)',
                  boxShadow: totalSelected > 0 && phase !== 'applying'
                    ? '0 4px 14px rgba(99,102,241,0.3)'
                    : 'none',
                  color: 'white',
                }}
              >
                {phase === 'applying' && <Spinner />}
                {phase === 'applying' ? 'Applying…' : `Apply ${totalSelected > 0 ? totalSelected : ''} change${totalSelected !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
