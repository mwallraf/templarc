import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { DndContext, type DragEndEvent, type DragOverEvent, DragOverlay } from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { editor as MonacoEditor, IPosition } from 'monaco-editor'
import { getTemplateDatasources, getTemplateVariables, listTemplates, updateTemplate } from '../../api/templates'
import { createParameter, listParameters } from '../../api/parameters'
import { listSecrets } from '../../api/auth'
import { getAISettings, listFilters, listMacros } from '../../api/admin'
import type { CustomFilterOut, CustomMacroOut, ParameterOut, TemplateOut, VariableRefOut } from '../../api/types'
import type { DataSourceDef } from './DataSourceForm'
import { ParameterPanel } from './ParameterPanel'
import { PreviewModal } from './PreviewModal'
import { Toast, type ToastState } from './Toast'
import AiAssistModal, { type InsertMode } from '../AiAssistModal'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TemplateEditorProps {
  template: TemplateOut
  initialContent?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFrontmatter(
  params: ParameterOut[],
  dataSources: DataSourceDef[],
): string {
  if (params.length === 0 && dataSources.length === 0) return ''
  let yaml = '---\n'

  if (params.length > 0) {
    yaml += 'parameters:\n'
    for (const p of params) {
      yaml += `  - name: ${p.name}\n`
      yaml += `    widget: ${p.widget_type}\n`
      if (p.label) yaml += `    label: "${p.label}"\n`
      if (p.description) yaml += `    description: "${p.description}"\n`
      if (p.help_text) yaml += `    help_text: "${p.help_text}"\n`
      if (p.required) yaml += `    required: true\n`
      if (p.default_value) yaml += `    default_value: "${p.default_value}"\n`
      if (p.is_derived && p.derived_expression) {
        yaml += `    derived: "${p.derived_expression}"\n`
      }
    }
  }

  if (dataSources.length > 0) {
    yaml += 'data_sources:\n'
    for (const ds of dataSources) {
      yaml += `  - id: ${ds.id}\n`
      yaml += `    url: "${ds.url}"\n`
      if (ds.auth) yaml += `    auth: "${ds.auth}"\n`
      if (ds.trigger) yaml += `    trigger: ${ds.trigger}\n`
      if (ds.on_error && ds.on_error !== 'warn') yaml += `    on_error: ${ds.on_error}\n`
      if (ds.cache_ttl) yaml += `    cache_ttl: ${ds.cache_ttl}\n`
      if (ds.mapping.length > 0) {
        yaml += `    mapping:\n`
        for (const m of ds.mapping) {
          yaml += `      - remote_field: "${m.remote_field}"\n`
          yaml += `        to_parameter: ${m.to_parameter}\n`
          if (m.auto_fill) yaml += `        auto_fill: true\n`
        }
      }
    }
  }

  yaml += '---\n'
  return yaml
}

// ── Monaco droppable wrapper ──────────────────────────────────────────────────

function MonacoDropZone({ children, isOver }: { children: React.ReactNode; isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'monaco-editor' })
  return (
    <div
      ref={setNodeRef}
      className={`h-full transition-colors ${
        isOver ? 'ring-2 ring-inset ring-indigo-400' : ''
      }`}
    >
      {children}
    </div>
  )
}

// ── Validate modal ────────────────────────────────────────────────────────────

function ValidateModal({
  variables,
  isLoading,
  template,
  onClose,
  onCreated,
}: {
  variables: VariableRefOut[] | undefined
  isLoading: boolean
  template: TemplateOut
  onClose: () => void
  onCreated: () => void
}) {
  const [justRegistered, setJustRegistered] = useState<Set<string>>(new Set())
  const [registering, setRegistering] = useState<Set<string>>(new Set())
  const [registerErrors, setRegisterErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Derive scope from variable name prefix
  function scopeForVar(fullPath: string): { scope: 'template' | 'project' | 'global'; label: string } {
    if (fullPath.startsWith('glob.')) return { scope: 'global', label: 'global' }
    if (fullPath.startsWith('proj.')) return { scope: 'project', label: 'project' }
    return { scope: 'template', label: 'template' }
  }

  async function handleRegister(v: VariableRefOut) {
    const { scope } = scopeForVar(v.full_path)
    setRegistering((prev) => new Set(prev).add(v.full_path))
    setRegisterErrors((prev) => { const n = { ...prev }; delete n[v.full_path]; return n })
    try {
      await createParameter({
        name: v.full_path,
        scope,
        project_id: scope !== 'template' ? template.project_id : undefined,
        template_id: scope === 'template' ? template.id : undefined,
        widget_type: 'text',
        required: false,
      })
      setJustRegistered((prev) => new Set(prev).add(v.full_path))
      onCreated()
    } catch (err) {
      setRegisterErrors((prev) => ({
        ...prev,
        [v.full_path]: err instanceof Error ? err.message : 'Failed',
      }))
    } finally {
      setRegistering((prev) => {
        const n = new Set(prev); n.delete(v.full_path); return n
      })
    }
  }

  const registered = variables?.filter((v) => v.is_registered || justRegistered.has(v.full_path)) ?? []
  const unregistered = variables?.filter((v) => !v.is_registered && !justRegistered.has(v.full_path)) ?? []
  const total = variables?.length ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-12"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl border overflow-hidden"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3.5 border-b"
          style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
        >
          <div className="flex items-center gap-3">
            <svg className="w-4 h-4 shrink-0" style={{ color: '#6366f1' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>Template Variables</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted-4)' }}>Scanned from the saved Git version · full inheritance chain</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-lg leading-none"
            style={{ color: 'var(--c-muted-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-3)')}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {isLoading && (
            <div className="flex items-center gap-2 justify-center py-10 text-sm" style={{ color: 'var(--c-muted-3)' }}>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Scanning template variables…
            </div>
          )}

          {!isLoading && variables !== undefined && (
            <>
              {/* Summary bar */}
              <div
                className="flex items-center gap-5 rounded-xl px-4 py-3 mb-5 border"
                style={{ backgroundColor: 'var(--c-base)', borderColor: 'var(--c-border)' }}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold font-display" style={{ color: 'var(--c-text)' }}>{total}</span>
                  <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>total</span>
                </div>
                <div className="w-px h-8" style={{ backgroundColor: 'var(--c-border)' }} />
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold font-display" style={{ color: registered.length > 0 ? '#34d399' : 'var(--c-muted-4)' }}>{registered.length}</span>
                  <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>registered</span>
                </div>
                <div className="w-px h-8" style={{ backgroundColor: 'var(--c-border)' }} />
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold font-display" style={{ color: unregistered.length > 0 ? '#f87171' : 'var(--c-muted-4)' }}>{unregistered.length}</span>
                  <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>unregistered</span>
                </div>
                {unregistered.length === 0 && total > 0 && (
                  <span className="ml-auto text-xs font-medium px-2.5 py-1 rounded-full border" style={{ backgroundColor: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.2)', color: '#34d399' }}>
                    All registered ✓
                  </span>
                )}
              </div>

              {/* Unregistered — with Register buttons */}
              {unregistered.length > 0 && (
                <div className="mb-5">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: '#f87171' }}>
                    Unregistered — click Register to create a parameter definition
                  </p>
                  <div className="space-y-1.5">
                    {unregistered.map((v) => {
                      const { label: scopeLabel } = scopeForVar(v.full_path)
                      const busy = registering.has(v.full_path)
                      const errMsg = registerErrors[v.full_path]
                      return (
                        <div
                          key={v.full_path}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 border"
                          style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.18)' }}
                        >
                          <span className="font-mono text-xs flex-1 min-w-0 truncate" style={{ color: '#fca5a5' }}>
                            {'{{ '}{v.full_path}{' }}'}
                          </span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded border shrink-0"
                            style={{ color: 'var(--c-muted-4)', borderColor: 'var(--c-border)', backgroundColor: 'var(--c-base)', fontSize: '10px' }}
                          >
                            {scopeLabel}
                          </span>
                          {errMsg && (
                            <span className="text-xs text-red-400 shrink-0" title={errMsg}>⚠</span>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRegister(v)}
                            className="shrink-0 text-xs px-2.5 py-1 rounded-md border font-medium transition-all disabled:opacity-50"
                            style={{
                              color: '#818cf8',
                              borderColor: 'rgba(99,102,241,0.35)',
                              backgroundColor: 'rgba(99,102,241,0.08)',
                            }}
                          >
                            {busy ? '…' : 'Register'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Registered */}
              {registered.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: '#34d399' }}>
                    Registered
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {registered.map((v) => (
                      <span
                        key={v.full_path}
                        className="font-mono text-xs px-2.5 py-1 rounded-lg border"
                        style={{ backgroundColor: 'rgba(52,211,153,0.06)', borderColor: 'rgba(52,211,153,0.18)', color: '#6ee7b7' }}
                      >
                        {'{{'}
                        <span className="mx-0.5 opacity-60"> </span>
                        {v.full_path}
                        <span className="mx-0.5 opacity-60"> </span>
                        {'}}'}
                        {justRegistered.has(v.full_path) && (
                          <span className="ml-1.5 opacity-70">✓ new</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {total === 0 && (
                <p className="text-sm text-center py-6" style={{ color: 'var(--c-muted-4)' }}>
                  No Jinja2 variables found in the saved template body.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Snippet toolbar ───────────────────────────────────────────────────────────

const JINJA_SNIPPETS: { label: string; insert: string; title: string }[] = [
  { label: '{{ }}',       insert: '{{ variable }}',                                    title: 'Variable expression' },
  { label: '{% if %}',    insert: '{% if condition %}\n\n{% endif %}',                 title: 'If / endif block' },
  { label: '{% elif %}',  insert: '{% elif condition %}',                              title: 'Elif branch' },
  { label: '{% else %}',  insert: '{% else %}',                                        title: 'Else branch' },
  { label: '{% for %}',   insert: '{% for item in items %}\n{{ item }}\n{% endfor %}', title: 'For loop' },
  { label: '{% set %}',   insert: '{% set var = value %}',                             title: 'Set variable' },
  { label: '{% include %}', insert: "{% include 'shared/file.j2' %}",                 title: 'Include fragment' },
  { label: '| default',  insert: " | default('')",                                    title: 'Default filter' },
  { label: '| join',     insert: " | join(', ')",                                     title: 'Join list' },
  { label: '| upper',    insert: ' | upper',                                           title: 'Uppercase' },
  { label: '| lower',    insert: ' | lower',                                           title: 'Lowercase' },
  { label: '| replace',  insert: " | replace('old', 'new')",                          title: 'Replace string' },
]

function SnippetToolbar({ onInsert }: { onInsert: (text: string) => void }) {
  const chipBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '1px 7px',
    borderRadius: '4px',
    cursor: 'pointer',
    border: '1px solid',
    transition: 'opacity 0.1s',
    whiteSpace: 'nowrap',
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-1.5 border-b shrink-0"
      style={{ backgroundColor: 'var(--c-base)', borderColor: 'var(--c-surface-alt)' }}
    >
      {JINJA_SNIPPETS.map((s) => (
        <button
          key={s.label}
          type="button"
          title={s.title}
          onClick={() => onInsert(s.insert)}
          style={{
            ...chipBase,
            color: '#818cf8',
            backgroundColor: 'rgba(99,102,241,0.08)',
            borderColor: 'rgba(99,102,241,0.2)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.75' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
        >
          {s.label}
        </button>
      ))}
      <span style={{ fontSize: '10px', color: 'var(--c-border-bright)', marginLeft: '4px', userSelect: 'none' }}>
        type <span style={{ color: 'var(--c-muted-4)', fontFamily: 'monospace' }}>|</span> for filter autocomplete
      </span>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a DB git_path (which includes the project directory prefix, e.g.
 * "router_provisioning/snippets/banner.j2") to a path relative to the
 * project root as used in {% include %} directives (e.g. "snippets/banner.j2").
 * The project prefix is derived from the owning template's git_path.
 */
function toIncludePath(snippetGitPath: string, templateGitPath: string | undefined): string {
  if (!templateGitPath) return snippetGitPath
  const slashIdx = templateGitPath.indexOf('/')
  if (slashIdx === -1) return snippetGitPath
  const projectDir = templateGitPath.substring(0, slashIdx + 1) // e.g. "router_provisioning/"
  return snippetGitPath.startsWith(projectDir)
    ? snippetGitPath.slice(projectDir.length)
    : snippetGitPath
}

// ── Snippet include picker panel ──────────────────────────────────────────────

function SnippetPickerPanel({
  snippets,
  onInsert,
  onClose,
  anchorEl,
  pathTransform = (p) => p,
}: {
  snippets: TemplateOut[]
  onInsert: (gitPath: string) => void
  onClose: () => void
  anchorEl: HTMLButtonElement | null
  pathTransform?: (rawGitPath: string) => string
}) {
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!anchorEl) return
    const rect = anchorEl.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
  }, [anchorEl])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorEl && !anchorEl.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose, anchorEl])

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = snippets.filter((s) =>
    !search ||
    s.display_name.toLowerCase().includes(search.toLowerCase()) ||
    (s.git_path ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 1000,
        width: '288px',
        backgroundColor: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: '10px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 border-b" style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}>
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--c-muted-3)' }}>
          Insert snippet include
        </p>
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search snippets…"
          className="w-full rounded-md px-2.5 py-1.5 text-xs focus:outline-none"
          style={{
            backgroundColor: 'var(--c-base)',
            border: '1px solid var(--c-border-bright)',
            color: 'var(--c-text)',
          }}
        />
      </div>

      {/* List */}
      <div style={{ maxHeight: '252px', overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <p className="text-xs text-center py-5" style={{ color: 'var(--c-muted-4)' }}>
            {snippets.length === 0 ? 'No snippets in this project' : 'No matches'}
          </p>
        )}
        {filtered.map((s) => {
          const rawPath = s.git_path ?? `snippets/${s.name}.j2`
          const path = pathTransform(rawPath)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onInsert(path)}
              className="w-full text-left px-3 py-2.5 transition-colors border-b"
              style={{ borderColor: 'var(--c-border)', backgroundColor: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-surface-alt)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <p className="text-xs font-medium truncate" style={{ color: 'var(--c-text)' }}>
                {s.display_name}
              </p>
              <p className="text-xs font-mono mt-0.5 truncate" style={{ color: 'var(--c-muted-4)' }}>
                {path}
              </p>
              {s.description && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--c-muted-4)', fontSize: '10px' }}>
                  {s.description}
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t" style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-base)' }}>
        <p className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
          Click to insert{' '}
          <span className="font-mono" style={{ color: 'var(--c-muted-3)' }}>
            {'{% include "…" %}'}
          </span>{' '}
          at cursor
        </p>
      </div>
    </div>
  )
}

// ── Macro call picker panel ───────────────────────────────────────────────────

function MacroPickerPanel({
  macros,
  onInsert,
  onClose,
  anchorEl,
}: {
  macros: CustomMacroOut[]
  onInsert: (text: string) => void
  onClose: () => void
  anchorEl: HTMLButtonElement | null
}) {
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!anchorEl) return
    const rect = anchorEl.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
  }, [anchorEl])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorEl && !anchorEl.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose, anchorEl])

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = macros.filter((m) =>
    !search ||
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    (m.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  // Extract parameter names from macro body signature: {% macro name(p1, p2) %}
  function getMacroSignature(macro: CustomMacroOut): string {
    const match = macro.body.match(/\{%-?\s*macro\s+\w+\s*\(([^)]*)\)/)
    const args = match?.[1]?.trim() ?? ''
    return `{{ ${macro.name}(${args}) }}`
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 1000,
        width: '300px',
        backgroundColor: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: '10px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 border-b" style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}>
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--c-muted-3)' }}>
          Insert macro call
        </p>
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search macros…"
          className="w-full rounded-md px-2.5 py-1.5 text-xs focus:outline-none"
          style={{
            backgroundColor: 'var(--c-base)',
            border: '1px solid var(--c-border-bright)',
            color: 'var(--c-text)',
          }}
        />
      </div>

      {/* List */}
      <div style={{ maxHeight: '252px', overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <p className="text-xs text-center py-5" style={{ color: 'var(--c-muted-4)' }}>
            {macros.length === 0 ? 'No macros for this project' : 'No matches'}
          </p>
        )}
        {filtered.map((m) => {
          const call = getMacroSignature(m)
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onInsert(call)}
              className="w-full text-left px-3 py-2.5 transition-colors border-b"
              style={{ borderColor: 'var(--c-border)', backgroundColor: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-surface-alt)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-xs font-mono font-medium truncate" style={{ color: '#818cf8' }}>
                  {m.name}
                </p>
                <span className="text-xs px-1 py-0 rounded" style={{ backgroundColor: 'rgba(99,102,241,0.1)', color: 'var(--c-muted-4)', fontSize: '9px' }}>
                  {m.scope}
                </span>
              </div>
              <p className="text-xs font-mono truncate" style={{ color: 'var(--c-muted-4)' }}>
                {call}
              </p>
              {m.description && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--c-muted-4)', fontSize: '10px' }}>
                  {m.description}
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t" style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-base)' }}>
        <p className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
          Click to insert macro call at cursor
        </p>
      </div>
    </div>
  )
}

// ── Jinja2 built-in filter completions ────────────────────────────────────────

const JINJA2_BUILTIN_FILTERS: { name: string; doc: string; snippet?: string }[] = [
  { name: 'abs',            doc: 'Return the absolute value of the argument.' },
  { name: 'capitalize',     doc: 'Capitalize: first character uppercase, all others lowercase.' },
  { name: 'center',         doc: 'Center the value in a field of given width.', snippet: 'center(${1:80})' },
  { name: 'default',        doc: "Return a default value if the value is undefined or falsy.", snippet: "default('${1:}')" },
  { name: 'd',              doc: "Alias for default.", snippet: "d('${1:}')" },
  { name: 'dictsort',       doc: 'Sort a dict and yield (key, value) pairs.' },
  { name: 'escape',         doc: 'Convert &, <, >, \', " to HTML-safe sequences.' },
  { name: 'e',              doc: 'Alias for escape.' },
  { name: 'filesizeformat', doc: 'Format the value as a human-readable file size (e.g. "1.2 MB").' },
  { name: 'first',          doc: 'Return the first item of a sequence.' },
  { name: 'float',          doc: 'Convert the value into a floating point number.' },
  { name: 'forceescape',    doc: 'Enforce HTML escaping, even if auto-escaping is disabled.' },
  { name: 'format',         doc: 'Apply printf-style formatting to the value.', snippet: 'format(${1:})' },
  { name: 'groupby',        doc: 'Group a sequence of objects by an attribute.', snippet: "groupby('${1:attribute}')" },
  { name: 'indent',         doc: 'Add spaces in front of each line (first line optional).', snippet: 'indent(${1:4})' },
  { name: 'int',            doc: 'Convert the value into an integer.' },
  { name: 'items',          doc: 'Return an iterator over the (key, value) pairs of a dict.' },
  { name: 'join',           doc: "Concatenate items in a sequence with a separator.", snippet: "join('${1:, }')" },
  { name: 'last',           doc: 'Return the last item of a sequence.' },
  { name: 'length',         doc: 'Return the number of items of a sequence or mapping.' },
  { name: 'count',          doc: 'Alias for length.' },
  { name: 'list',           doc: 'Convert the value into a list.' },
  { name: 'lower',          doc: 'Convert a value to lowercase.' },
  { name: 'map',            doc: 'Apply a filter on a sequence of objects.', snippet: "map(attribute='${1:attr}')" },
  { name: 'max',            doc: 'Return the largest item from the sequence.' },
  { name: 'min',            doc: 'Return the smallest item from the sequence.' },
  { name: 'pprint',         doc: 'Pretty print a variable (useful for debugging).' },
  { name: 'random',         doc: 'Return a random item from the sequence.' },
  { name: 'reject',         doc: 'Filter a sequence, removing items that pass the test.', snippet: "reject('${1:test}')" },
  { name: 'rejectattr',     doc: 'Filter a sequence of objects, removing those where the attribute passes the test.', snippet: "rejectattr('${1:attr}')" },
  { name: 'replace',        doc: 'Replace occurrences of a substring.', snippet: "replace('${1:old}', '${2:new}')" },
  { name: 'reverse',        doc: 'Reverse the object or return a reversed iterator.' },
  { name: 'round',          doc: 'Round the number to a given precision.', snippet: 'round(${1:0})' },
  { name: 'safe',           doc: 'Mark the value as safe — it will not be HTML-escaped.' },
  { name: 'select',         doc: 'Filter a sequence, keeping items that pass the test.', snippet: "select('${1:test}')" },
  { name: 'selectattr',     doc: 'Filter a sequence of objects, keeping those where the attribute passes the test.', snippet: "selectattr('${1:attr}')" },
  { name: 'slice',          doc: 'Slice an iterator and return a list of lists.', snippet: 'slice(${1:3})' },
  { name: 'sort',           doc: 'Sort an iterable.', snippet: "sort(attribute='${1:attr}')" },
  { name: 'string',         doc: 'Convert the object to a string.' },
  { name: 'striptags',      doc: 'Strip SGML/XML tags and replace adjacent whitespace.' },
  { name: 'sum',            doc: 'Return the sum of a sequence of numbers.', snippet: "sum(attribute='${1:attr}')" },
  { name: 'title',          doc: 'Return a titlecased version of the value.' },
  { name: 'tojson',         doc: 'Serialize an object to a JSON string.', snippet: 'tojson(indent=${1:2})' },
  { name: 'trim',           doc: 'Strip leading and trailing whitespace.' },
  { name: 'truncate',       doc: 'Return a truncated copy of the string.', snippet: 'truncate(${1:255})' },
  { name: 'unique',         doc: 'Return a list of unique items from the iterable.' },
  { name: 'upper',          doc: 'Convert a value to uppercase.' },
  { name: 'urlencode',      doc: 'Percent-encode a string for use in a URL.' },
  { name: 'urlize',         doc: 'Convert URLs in plain text into clickable HTML links.' },
  { name: 'wordcount',      doc: 'Count the words in the string.' },
  { name: 'wordwrap',       doc: "Wrap the string's words at the given width.", snippet: 'wordwrap(${1:79})' },
  { name: 'xmlattr',        doc: 'Build an HTML/XML attribute string from a dict.' },
]

// ── Main TemplateEditor ───────────────────────────────────────────────────────

export default function TemplateEditor({ template, initialContent = '' }: TemplateEditorProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  // Monaco editor instance ref
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const lastCursorRef = useRef<IPosition | null>(null)

  // Editor content (template body only — frontmatter is built from state on save)
  const [editorContent, setEditorContent] = useState(initialContent)

  // Parameters currently assigned to this template
  const [assignedParams, setAssignedParams] = useState<ParameterOut[]>([])
  const [dataSources, setDataSources] = useState<DataSourceDef[]>([])
  const [parentTemplateId, setParentTemplateId] = useState<number | undefined>(
    template.parent_template_id ?? undefined,
  )

  // Metadata
  const [metaDisplayName, setMetaDisplayName] = useState(template.display_name)
  const [metaDescription, setMetaDescription] = useState(template.description ?? '')
  const [metaSortOrder, setMetaSortOrder] = useState(template.sort_order)

  // UI state
  const [showPreview, setShowPreview] = useState(false)
  const [showValidate, setShowValidate] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showSnippetPanel, setShowSnippetPanel] = useState(false)
  const [showMacroPanel, setShowMacroPanel] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [activeDragParam, setActiveDragParam] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const snippetBtnRef = useRef<HTMLButtonElement>(null)
  const macroBtnRef = useRef<HTMLButtonElement>(null)

  // Unsaved changes tracking
  const [isDirty, setIsDirty] = useState(false)
  const markDirty = useCallback(() => setIsDirty(true), [])

  // Confirm navigation away when dirty
  const confirmNavAway = useCallback((to: string) => {
    if (!isDirty || window.confirm('You have unsaved changes. Leave without saving?')) {
      navigate(to)
    }
  }, [isDirty, navigate])

  // Warn on browser tab close / page reload
  useEffect(() => {
    if (!isDirty) return
    function handler(e: BeforeUnloadEvent) { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // Fetch initial template parameters from API
  const { data: templateParamsData } = useQuery({
    queryKey: ['parameters', 'template', template.id],
    queryFn: () => listParameters({ template_id: template.id, page_size: 200 }),
  })

  useEffect(() => {
    if (templateParamsData && assignedParams.length === 0) {
      setAssignedParams(templateParamsData.items)
    }
  }, [templateParamsData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch existing data sources from template frontmatter
  const { data: existingDatasources } = useQuery({
    queryKey: ['template-datasources', template.id],
    queryFn: () => getTemplateDatasources(template.id),
  })

  useEffect(() => {
    if (existingDatasources && existingDatasources.length > 0 && dataSources.length === 0) {
      const parsed = existingDatasources.map((raw) => ({
        id: String(raw.id ?? ''),
        url: String(raw.url ?? ''),
        auth: raw.auth ? String(raw.auth) : undefined,
        trigger: raw.trigger
          ? String(raw.trigger).replace(/\{\{\s*([\w.]+)\s*\}\}/g, '$1')
          : undefined,
        on_error: (raw.on_error as DataSourceDef['on_error']) ?? undefined,
        cache_ttl: raw.cache_ttl != null ? Number(raw.cache_ttl) : undefined,
        mapping: Array.isArray(raw.mapping)
          ? (raw.mapping as Record<string, unknown>[]).map((m) => ({
              remote_field: String(m.remote_field ?? ''),
              to_parameter: String(m.to_parameter ?? ''),
              auto_fill: Boolean(m.auto_fill ?? false),
            }))
          : [],
      }))
      setDataSources(parsed)
    }
  }, [existingDatasources]) // eslint-disable-line react-hooks/exhaustive-deps

  // Secrets for data source auth picker
  const { data: secretsData } = useQuery({
    queryKey: ['secrets'],
    queryFn: listSecrets,
  })

  // Custom filters — for Monaco IntelliSense completion
  const { data: customFilters = [] } = useQuery({
    queryKey: ['filters', template.project_id],
    queryFn: () => listFilters({ project_id: template.project_id }),
    select: (data) => data.filter((f) => f.is_active),
  })

  // Keep a ref so the completion provider always reads fresh data without re-registering
  const customFiltersRef = useRef<CustomFilterOut[]>(customFilters)
  useEffect(() => { customFiltersRef.current = customFilters }, [customFilters])

  // Project snippets — for the snippet picker panel and Monaco include completions
  const { data: projectTemplatesData } = useQuery({
    queryKey: ['templates', template.project_id],
    queryFn: () => listTemplates({ project_id: template.project_id }),
  })
  const projectSnippets = (projectTemplatesData ?? []).filter((t) => t.is_snippet && t.is_active)
  const projectSnippetsRef = useRef<TemplateOut[]>([])
  useEffect(() => { projectSnippetsRef.current = projectSnippets }, [projectSnippets])

  // Path transform — strips the project directory prefix for {% include %} paths
  const snippetPathTransform = useCallback(
    (rawPath: string) => toIncludePath(rawPath, template.git_path),
    [template.git_path],
  )

  // Project macros (project-scoped + global)
  const { data: projectMacros = [] } = useQuery({
    queryKey: ['macros', template.project_id],
    queryFn: async () => {
      const [proj, global] = await Promise.all([
        listMacros({ project_id: template.project_id }),
        listMacros({ scope: 'global' }),
      ])
      return [...proj, ...global].filter((m) => m.is_active)
    },
  })

  // AI settings — to know whether to enable the AI button
  const { data: aiSettings } = useQuery({
    queryKey: ['settings', 'ai'],
    queryFn: getAISettings,
    staleTime: 5 * 60 * 1000,
  })
  const aiEnabled = Boolean(aiSettings?.provider && aiSettings.provider !== '')

  // Disposable for the Monaco completion provider — cleaned up on unmount
  const completionDisposableRef = useRef<{ dispose(): void } | null>(null)
  useEffect(() => () => { completionDisposableRef.current?.dispose() }, [])

  // Variables for validation panel (reads from saved Git version)
  const validateQuery = useQuery({
    queryKey: ['template-variables', template.id],
    queryFn: () => getTemplateVariables(template.id),
    enabled: false,
  })

  // Save mutation
  const saveMut = useMutation({
    mutationFn: () => {
      const frontmatter = buildFrontmatter(assignedParams, dataSources)
      const fullContent = frontmatter + editorContent
      return updateTemplate(template.id, {
        content: fullContent,
        parent_template_id: parentTemplateId,
        display_name: metaDisplayName || undefined,
        description: metaDescription || undefined,
        sort_order: metaSortOrder,
        commit_message: commitMessage || undefined,
        author: 'admin',
      })
    },
    onSuccess: (result) => {
      setToast({
        variant: 'success',
        message: 'Template saved',
        detail: `git ${result.template.updated_at}`,
      })
      setCommitMessage('')
      setIsDirty(false)
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['template', template.id] })
      qc.invalidateQueries({ queryKey: ['template-datasources', template.id] })
    },
    onError: (err) => {
      setToast({
        variant: 'error',
        message: 'Save failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      })
    },
  })

  // ── Insert at cursor ──────────────────────────────────────────────────────

  const insertAtCursor = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor) return
    const pos = lastCursorRef.current ?? editor.getPosition()
    if (!pos) return
    editor.executeEdits('template-editor', [
      {
        range: {
          startLineNumber: pos.lineNumber,
          startColumn: pos.column,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column,
        },
        text,
      },
    ])
    editor.focus()
  }, [])

  const insertSnippetInclude = useCallback((gitPath: string) => {
    insertAtCursor(`{% include "${gitPath}" %}`)
    setShowSnippetPanel(false)
  }, [insertAtCursor])

  const insertMacroCall = useCallback((text: string) => {
    insertAtCursor(text)
    setShowMacroPanel(false)
  }, [insertAtCursor])

  // ── dnd-kit handlers ──────────────────────────────────────────────────────

  function handleDragStart(event: DragOverEvent) {
    setActiveDragParam((event.active.data.current as { paramName?: string })?.paramName ?? null)
  }

  function handleDragOver(event: DragOverEvent) {
    setIsDragOver(event.over?.id === 'monaco-editor')
  }

  function handleDragEnd(event: DragEndEvent) {
    setIsDragOver(false)
    setActiveDragParam(null)

    const paramName = event.active.data.current?.paramName as string | undefined
    if (!paramName) return

    if (event.over?.id === 'monaco-editor') {
      insertAtCursor(`{{ ${paramName} }}`)
    }
  }

  // ── Parameter panel callbacks ─────────────────────────────────────────────

  function handleAssignParam(param: ParameterOut) {
    if (!assignedParams.find((p) => p.id === param.id)) {
      setAssignedParams((prev) => [...prev, param])
    }
    markDirty()
    insertAtCursor(`{{ ${param.name} }}`)
  }

  function handleUnassignParam(paramId: number) {
    setAssignedParams((prev) => prev.filter((p) => p.id !== paramId))
    markDirty()
  }

  function handleAddDs(ds: DataSourceDef) {
    setDataSources((prev) => [...prev.filter((d) => d.id !== ds.id), ds])
    markDirty()
  }

  function handleRemoveDs(id: string) {
    setDataSources((prev) => prev.filter((d) => d.id !== id))
    markDirty()
  }

  function handleUpdateDs(id: string, ds: DataSourceDef) {
    setDataSources((prev) => prev.map((d) => (d.id === id ? ds : d)))
    markDirty()
  }

  async function handleValidate() {
    setShowValidate(true)
    await validateQuery.refetch()
  }

  function handleAIAccept(text: string, mode: InsertMode) {
    if (mode === 'replace') {
      setEditorContent(text)
    } else if (mode === 'append') {
      setEditorContent((prev) => (prev ? prev + '\n' + text : text))
    } else {
      insertAtCursor(text)
    }
    setShowAI(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DndContext
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full">
        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0"
          style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border)' }}
        >
          <button
            type="button"
            onClick={() => confirmNavAway('/admin/templates')}
            className="flex items-center gap-1 text-xs font-medium transition-colors mr-1"
            style={{ color: 'var(--c-muted-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-muted-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted-3)')}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Templates
          </button>

          <span style={{ color: 'var(--c-border-bright)' }}>|</span>

          <h2 className="font-semibold text-sm mr-1" style={{ color: 'var(--c-text)' }}>{metaDisplayName || template.display_name}</h2>

          <span style={{ color: 'var(--c-border-bright)' }}>|</span>

          <button
            onClick={handleValidate}
            disabled={validateQuery.isFetching}
            className="px-3 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50"
            style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {validateQuery.isFetching ? 'Checking…' : 'Validate'}
          </button>

          <button
            onClick={() => setShowPreview(true)}
            className="px-3 py-1.5 text-xs rounded-md transition-colors"
            style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-2)', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Preview Form
          </button>

          <button
            onClick={() => aiEnabled && setShowAI(true)}
            disabled={!aiEnabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(168,85,247,0.15))',
              border: '1px solid rgba(99,102,241,0.35)',
              color: '#a5b4fc',
            }}
            title={aiEnabled ? 'AI assist' : 'AI is disabled — configure a provider in Settings'}
            onMouseEnter={(e) => { if (aiEnabled) (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.6)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.35)' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            AI
          </button>

          <button
            ref={snippetBtnRef}
            onClick={() => { setShowMacroPanel(false); setShowSnippetPanel((v) => !v) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors"
            style={{
              border: '1px solid var(--c-border-bright)',
              color: showSnippetPanel ? '#818cf8' : 'var(--c-muted-2)',
              backgroundColor: showSnippetPanel ? 'rgba(99,102,241,0.1)' : 'transparent',
            }}
            title="Insert snippet include (project snippets)"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path strokeLinecap="round" d="M2 4h4M2 8h8M2 12h5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 9l2 2-2 2M14 9l-2 2 2 2" />
            </svg>
            Snippets
          </button>

          <button
            ref={macroBtnRef}
            onClick={() => { setShowSnippetPanel(false); setShowMacroPanel((v) => !v) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors"
            style={{
              border: '1px solid var(--c-border-bright)',
              color: showMacroPanel ? '#818cf8' : 'var(--c-muted-2)',
              backgroundColor: showMacroPanel ? 'rgba(99,102,241,0.1)' : 'transparent',
            }}
            title="Insert macro call (project & global macros)"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4l3 4-3 4M8 12h5" />
            </svg>
            Macros
          </button>

          <div className="flex-1" />

          {/* Commit message */}
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message (optional)"
            className="w-56 rounded-md px-2.5 py-1.5 text-xs focus:outline-none"
            style={{
              backgroundColor: 'var(--c-card)',
              border: '1px solid var(--c-border-bright)',
              color: 'var(--c-text)',
            }}
          />

          <div className="relative">
            {isDirty && (
              <span
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full z-10"
                style={{ backgroundColor: '#f59e0b', boxShadow: '0 0 6px rgba(245,158,11,0.7)' }}
                title="Unsaved changes"
              />
            )}
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="px-4 py-1.5 text-white text-xs font-semibold rounded-md disabled:opacity-50 transition-all"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                boxShadow: isDirty ? '0 4px 14px rgba(99,102,241,0.5)' : '0 4px 14px rgba(99,102,241,0.3)',
              }}
            >
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* ── Split view ────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Monaco editor — grows to fill remaining space */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <SnippetToolbar onInsert={insertAtCursor} />
            <MonacoDropZone isOver={isDragOver}>
              <Editor
                height="100%"
                language="python"
                theme="vs-dark"
                value={editorContent}
                onChange={(val) => { setEditorContent(val ?? ''); markDirty() }}
                onMount={(editor, monaco) => {
                  editorRef.current = editor
                  editor.onDidChangeCursorPosition((e) => {
                    lastCursorRef.current = e.position
                  })

                  // Register Jinja2 filter completion provider (triggers on |)
                  const filterCompletion = monaco.languages.registerCompletionItemProvider('python', {
                    triggerCharacters: ['|'],
                    provideCompletionItems: (model, position) => {
                      // Only activate when the text before the cursor ends with | (optionally with spaces)
                      const textBefore = model.getLineContent(position.lineNumber).substring(0, position.column - 1)
                      if (!/\|\s*\w*$/.test(textBefore)) return { suggestions: [] }

                      const word = model.getWordUntilPosition(position)
                      const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn,
                      }

                      const customSuggestions = customFiltersRef.current.map((f) => ({
                        label: f.name,
                        kind: monaco.languages.CompletionItemKind.Function,
                        detail: '⚙ custom filter',
                        documentation: { value: f.description ?? `Custom Jinja2 filter: \`${f.name}\`` },
                        insertText: f.name,
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.None,
                        range,
                        sortText: '0' + f.name, // custom filters sort first
                      }))

                      const builtinSuggestions = JINJA2_BUILTIN_FILTERS.map((f) => ({
                        label: f.name,
                        kind: monaco.languages.CompletionItemKind.Function,
                        detail: 'Jinja2',
                        documentation: { value: f.doc },
                        insertText: f.snippet ?? f.name,
                        insertTextRules: f.snippet
                          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                          : monaco.languages.CompletionItemInsertTextRule.None,
                        range,
                        sortText: '1' + f.name,
                      }))

                      return { suggestions: [...customSuggestions, ...builtinSuggestions] }
                    },
                  })

                  // Register {% include "..." %} snippet path completion (triggers on ")
                  const includeCompletion = monaco.languages.registerCompletionItemProvider('python', {
                    triggerCharacters: ['"'],
                    provideCompletionItems: (model, position) => {
                      const lineContent = model.getLineContent(position.lineNumber)
                      const textBefore = lineContent.substring(0, position.column - 1)
                      // Only activate inside {% include "... pattern
                      const match = textBefore.match(/\{%-?\s*include\s+"([^"]*)$/)
                      if (!match) return { suggestions: [] }

                      // Range covers only the text already typed after the opening quote
                      const typed = match[1]
                      const startCol = position.column - typed.length
                      const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: startCol,
                        endColumn: position.column,
                      }

                      return {
                        suggestions: projectSnippetsRef.current.map((s) => {
                          const path = toIncludePath(
                            s.git_path ?? `snippets/${s.name}.j2`,
                            template.git_path,
                          )
                          return {
                            label: path,
                            kind: monaco.languages.CompletionItemKind.File,
                            detail: s.display_name,
                            documentation: { value: s.description ?? `Include snippet: **${s.display_name}**` },
                            insertText: path,
                            insertTextRules: monaco.languages.CompletionItemInsertTextRule.None,
                            range,
                            sortText: '0' + path,
                          }
                        }),
                      }
                    },
                  })

                  completionDisposableRef.current = {
                    dispose: () => { filterCompletion.dispose(); includeCompletion.dispose() },
                  }
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                  renderWhitespace: 'boundary',
                  padding: { top: 12 },
                }}
              />
            </MonacoDropZone>

          </div>

          {/* Right: Parameter panel — responsive fixed width */}
          <div className="w-80 lg:w-96 xl:w-[440px] 2xl:w-[520px] shrink-0 flex flex-col min-h-0 overflow-hidden">
            <ParameterPanel
              templateId={template.id}
              projectId={template.project_id}
              secrets={secretsData ?? []}
              assignedParams={assignedParams}
              dataSources={dataSources}
              parentTemplateId={parentTemplateId}
              metaDisplayName={metaDisplayName}
              metaDescription={metaDescription}
              metaSortOrder={metaSortOrder}
              onChangeDisplayName={(v) => { setMetaDisplayName(v); markDirty() }}
              onChangeDescription={(v) => { setMetaDescription(v); markDirty() }}
              onChangeSortOrder={(v) => { setMetaSortOrder(v); markDirty() }}
              onAssignParam={handleAssignParam}
              onUnassignParam={handleUnassignParam}
              onSetParent={(v) => { setParentTemplateId(v); markDirty() }}
              onAddDataSource={handleAddDs}
              onRemoveDataSource={handleRemoveDs}
              onUpdateDataSource={handleUpdateDs}
            />
          </div>
        </div>
      </div>

      {/* Drag overlay — ghost preview while dragging */}
      <DragOverlay>
        {activeDragParam && (
          <div className="bg-indigo-600 text-white text-xs font-mono px-3 py-1.5 rounded-md shadow-lg opacity-90 pointer-events-none">
            {'{{ '}
            {activeDragParam}
            {' }}'}
          </div>
        )}
      </DragOverlay>

      {/* Snippet picker panel */}
      {showSnippetPanel && (
        <SnippetPickerPanel
          snippets={projectSnippets}
          onInsert={insertSnippetInclude}
          onClose={() => setShowSnippetPanel(false)}
          anchorEl={snippetBtnRef.current}
          pathTransform={snippetPathTransform}
        />
      )}

      {/* Macro picker panel */}
      {showMacroPanel && (
        <MacroPickerPanel
          macros={projectMacros}
          onInsert={insertMacroCall}
          onClose={() => setShowMacroPanel(false)}
          anchorEl={macroBtnRef.current}
        />
      )}

      {/* Preview modal */}
      {showPreview && (
        <PreviewModal templateId={template.id} onClose={() => setShowPreview(false)} />
      )}

      {/* Validate modal */}
      {showValidate && (
        <ValidateModal
          variables={validateQuery.data}
          isLoading={validateQuery.isFetching}
          template={template}
          onClose={() => setShowValidate(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['parameters', 'template', template.id] })
            validateQuery.refetch()
          }}
        />
      )}

      {/* Toast */}
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}

      {/* AI assistant modal */}
      {showAI && (
        <AiAssistModal
          registeredParams={assignedParams.map((p) => p.name)}
          customFilters={customFilters.map((f) => f.name)}
          existingBody={editorContent}
          onAccept={handleAIAccept}
          onClose={() => setShowAI(false)}
        />
      )}

    </DndContext>
  )
}
