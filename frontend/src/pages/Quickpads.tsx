import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import {
  listQuickpads,
  createQuickpad,
  updateQuickpad,
  deleteQuickpad,
  renderQuickpad,
} from '../api/quickpads'
import { useAuth } from '../contexts/AuthContext'
import type { QuickpadOut, QuickpadRenderOut } from '../api/types'
import ApiCodePanel, { getApiBase } from '../components/ApiCodePanel'
import AiAssistModal, { type InsertMode } from '../components/AiAssistModal'

// ── Jinja2 pattern helpers ─────────────────────────────────────────────────

const JINJA_SNIPPETS = [
  { label: '{{ var }}', insert: '{{ variable }}' },
  { label: '{% if %}', insert: '{% if condition %}\n\n{% endif %}' },
  { label: '{% for %}', insert: '{% for item in items %}\n{{ item }}\n{% endfor %}' },
  { label: '| default', insert: "{{ variable | default('fallback') }}" },
  { label: '| upper', insert: '{{ variable | upper }}' },
  { label: '| join', insert: "{{ list | join(', ') }}" },
]

// ── Variable chip list ─────────────────────────────────────────────────────

function extractVarsFromBody(body: string): string[] {
  // Quick client-side extraction using regex — good enough for the helper chips
  const seen = new Set<string>()
  const re = /\{\{\s*([\w.]+)\s*(?:\|[^}]*)?\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const name = m[1].trim()
    // Filter jinja2 builtins
    if (!['loop', 'range', 'true', 'false', 'none', 'namespace', 'joiner', 'cycler'].includes(name)) {
      seen.add(name)
    }
  }
  return Array.from(seen)
}

// ── Editor panel ───────────────────────────────────────────────────────────

interface EditorPanelProps {
  pad: QuickpadOut | null
  currentUsername: string
  onSaved: (pad: QuickpadOut) => void
  onCreated: (pad: QuickpadOut) => void
  onDeleted: () => void
}

interface FormValues {
  name: string
  description: string
  body: string
  is_public: boolean
}

function EditorPanel({ pad, currentUsername, onSaved, onCreated, onDeleted }: EditorPanelProps) {
  const qc = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [renderResult, setRenderResult] = useState<QuickpadRenderOut | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [renderInputs, setRenderInputs] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<'edit' | 'render'>(pad ? 'render' : 'edit')
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAI, setShowAI] = useState(false)

  const isOwner = !pad || pad.owner_username === currentUsername
  const isNew = !pad

  const { register, handleSubmit, watch, setValue, reset, formState: { isDirty } } = useForm<FormValues>({
    defaultValues: {
      name: pad?.name ?? '',
      description: pad?.description ?? '',
      body: pad?.body ?? '',
      is_public: pad?.is_public ?? false,
    },
  })

  // Reset form when selected pad changes
  const body = watch('body')
  const vars = extractVarsFromBody(body)

  const createMut = useMutation({
    mutationFn: (data: FormValues) =>
      createQuickpad({ name: data.name, description: data.description || undefined, body: data.body, is_public: data.is_public }),
    onSuccess: (newPad) => {
      qc.invalidateQueries({ queryKey: ['quickpads'] })
      onCreated(newPad)
      reset({ name: newPad.name, description: newPad.description ?? '', body: newPad.body, is_public: newPad.is_public })
    },
  })

  const updateMut = useMutation({
    mutationFn: (data: FormValues) =>
      updateQuickpad(pad!.id, { name: data.name, description: data.description || undefined, body: data.body, is_public: data.is_public }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['quickpads'] })
      onSaved(updated)
      reset({ name: updated.name, description: updated.description ?? '', body: updated.body, is_public: updated.is_public })
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteQuickpad(pad!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quickpads'] })
      onDeleted()
    },
  })

  const renderMut = useMutation({
    mutationFn: () => renderQuickpad(pad!.id, { params: renderInputs }),
    onSuccess: (result) => {
      setRenderResult(result)
      setRenderError(null)
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      setRenderError(err.response?.data?.detail ?? 'Render failed')
      setRenderResult(null)
    },
  })

  function onSubmit(data: FormValues) {
    if (isNew) createMut.mutate(data)
    else updateMut.mutate(data)
  }

  function insertSnippet(text: string) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const current = el.value
    const next = current.slice(0, start) + text + current.slice(end)
    setValue('body', next, { shouldDirty: true })
    // Restore caret after React re-render
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  function handleAIAccept(text: string, mode: InsertMode) {
    const current = watch('body') ?? ''
    if (mode === 'replace') {
      setValue('body', text, { shouldDirty: true })
    } else if (mode === 'append') {
      setValue('body', current ? current + '\n' + text : text, { shouldDirty: true })
    } else {
      insertSnippet(text)
    }
    setShowAI(false)
  }

  function copyOutput() {
    if (!renderResult) return
    navigator.clipboard.writeText(renderResult.output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const inputClass =
    'w-full rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 border'
  const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)' }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b shrink-0" style={{ borderColor: 'var(--c-border)' }}>
        {(['edit', 'render'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            disabled={tab === 'render' && isNew}
            className={`px-4 py-2.5 text-xs font-medium capitalize transition-colors disabled:opacity-30 ${
              activeTab === tab
                ? 'border-b-2 border-indigo-500 text-indigo-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab === 'edit' ? 'Editor' : 'Render'}
          </button>
        ))}
        <div className="flex-1" />
        {!isNew && (
          <span
            className="self-center mr-3 text-xs px-2 py-0.5 rounded"
            style={
              pad!.is_public
                ? { backgroundColor: 'rgba(52,211,153,0.1)', color: '#34d399' }
                : { backgroundColor: 'rgba(251,191,36,0.1)', color: '#fbbf24' }
            }
          >
            {pad!.is_public ? '🌐 Public' : '🔒 Private'}
          </span>
        )}
      </div>

      {/* Editor tab */}
      {activeTab === 'edit' && (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-muted-3)' }}>
                Name <span className="text-red-400">*</span>
              </label>
              <input
                {...register('name', { required: true })}
                placeholder="e.g. Create Linux user"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-muted-3)' }}>
                Description
              </label>
              <input
                {...register('description')}
                placeholder="Optional — what does this generate?"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            {/* Public toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_public"
                {...register('is_public')}
                className="w-3.5 h-3.5 rounded accent-indigo-500"
              />
              <label htmlFor="is_public" className="text-xs" style={{ color: 'var(--c-muted-3)' }}>
                Make public (visible to all users in your organisation)
              </label>
            </div>

            {/* Toolbar */}
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-3)' }}>
                Template body
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {JINJA_SNIPPETS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => insertSnippet(s.insert)}
                    className="px-2 py-0.5 rounded text-xs font-mono transition-colors"
                    style={{
                      backgroundColor: 'var(--c-surface)',
                      border: '1px solid var(--c-border-bright)',
                      color: '#818cf8',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border-bright)')}
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowAI(true)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-all"
                  style={{
                    background: 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(168,85,247,0.15))',
                    border: '1px solid rgba(99,102,241,0.35)',
                    color: '#a5b4fc',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.6)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.35)' }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  AI
                </button>
              </div>
              <textarea
                {...register('body')}
                ref={(el) => {
                  register('body').ref(el)
                  ;(textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
                }}
                rows={14}
                placeholder={'useradd -m -d /home/{{ username }} {{ username }}\npasswd {{ username }}'}
                className="w-full rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 border resize-none"
                style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
              />
            </div>

            {/* Detected variables */}
            {vars.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-3)' }}>
                  Detected variables
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {vars.map((v) => (
                    <span
                      key={v}
                      className="px-2 py-0.5 rounded text-xs font-mono"
                      style={{ backgroundColor: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t"
            style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}
          >
            <div className="flex gap-2">
              {!isNew && isOwner && (
                <>
                  {confirmDelete ? (
                    <>
                      <span className="text-xs text-red-400 self-center">Delete this quickpad?</span>
                      <button
                        type="button"
                        onClick={() => deleteMut.mutate()}
                        className="px-3 py-1.5 rounded-md text-xs bg-red-600 hover:bg-red-700 text-white transition-colors"
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="px-3 py-1.5 rounded-md text-xs transition-colors"
                        style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-3)' }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="px-3 py-1.5 rounded-md text-xs transition-colors"
                      style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-3)' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#f87171' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-muted-3)' }}
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-2">
              {!isNew && (
                <button
                  type="button"
                  onClick={() => {
                    reset({ name: pad!.name, description: pad!.description ?? '', body: pad!.body, is_public: pad!.is_public })
                    setRenderResult(null)
                  }}
                  disabled={!isDirty}
                  className="px-3 py-1.5 rounded-md text-xs disabled:opacity-30 transition-colors"
                  style={{ border: '1px solid var(--c-border-bright)', color: 'var(--c-muted-3)' }}
                >
                  Revert
                </button>
              )}
              {(isNew || isOwner) && (
                <button
                  type="submit"
                  disabled={createMut.isPending || updateMut.isPending}
                  className="px-4 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#6366f1' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#4f46e5' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#6366f1' }}
                >
                  {isNew ? 'Create' : 'Save'}
                </button>
              )}
            </div>
          </div>

          {(createMut.isError || updateMut.isError) && (
            <p className="text-xs text-red-400 px-4 pb-2">
              {(createMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Save failed'}
            </p>
          )}
        </form>
      )}

      {/* Render tab */}
      {activeTab === 'render' && pad && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {vars.length === 0 && (
              <p className="text-xs italic" style={{ color: 'var(--c-muted-3)' }}>
                No variables detected. Click Render to see the output.
              </p>
            )}
            {vars.map((v) => (
              <div key={v}>
                <label className="block text-xs font-mono mb-1" style={{ color: '#818cf8' }}>
                  {v}
                </label>
                <input
                  type="text"
                  value={renderInputs[v] ?? ''}
                  onChange={(e) => setRenderInputs((prev) => ({ ...prev, [v]: e.target.value }))}
                  placeholder={v}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            ))}

            {renderError && (
              <div className="rounded-md p-3 text-xs text-red-300" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {renderError}
              </div>
            )}

            {renderResult && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium" style={{ color: 'var(--c-muted-3)' }}>Output</p>
                  <div className="flex items-center gap-2">
                    <ApiCodePanel
                      examples={[
                        {
                          lang: 'curl',
                          code: [
                            `curl -s -X POST "${getApiBase()}/quickpads/${pad.id}/render" \\`,
                            `  -H "Authorization: Bearer $TOKEN" \\`,
                            `  -H "Content-Type: application/json" \\`,
                            `  -d '${JSON.stringify({ params: renderInputs })}'`,
                          ].join('\n'),
                        },
                        {
                          lang: 'python',
                          code: [
                            'import requests',
                            '',
                            'response = requests.post(',
                            `    "${getApiBase()}/quickpads/${pad.id}/render",`,
                            '    headers={"Authorization": "Bearer $TOKEN"},',
                            `    json=${JSON.stringify({ params: renderInputs }, null, 8).replace(/^/gm, '    ').trimStart()},`,
                            ')',
                            'print(response.json()["output"])',
                          ].join('\n'),
                        },
                      ]}
                    />
                    <button
                      onClick={copyOutput}
                      className="text-xs px-2 py-0.5 rounded transition-colors"
                      style={{ color: copied ? '#34d399' : 'var(--c-muted-3)', border: '1px solid var(--c-border-bright)' }}
                    >
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <pre
                  className="w-full rounded-md px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-words"
                  style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-muted-1)', minHeight: '6rem' }}
                >
                  {renderResult.output || <span className="italic opacity-50">(empty output)</span>}
                </pre>
              </div>
            )}
          </div>

          <div
            className="shrink-0 flex justify-end px-4 py-3 border-t"
            style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}
          >
            {isDirty && (
              <p className="text-xs text-amber-400 self-center mr-auto">Unsaved changes — save first for accurate render</p>
            )}
            <button
              onClick={() => renderMut.mutate()}
              disabled={renderMut.isPending}
              className="px-4 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#6366f1' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#4f46e5' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#6366f1' }}
            >
              {renderMut.isPending ? 'Rendering…' : 'Render'}
            </button>
          </div>
        </div>
      )}

      {/* AI assistant modal */}
      {showAI && (
        <AiAssistModal
          existingBody={watch('body') || undefined}
          onAccept={handleAIAccept}
          onClose={() => setShowAI(false)}
        />
      )}
    </div>
  )
}

// ── List panel ─────────────────────────────────────────────────────────────

interface ListPanelProps {
  items: QuickpadOut[]
  selectedId: string | null
  currentUsername: string
  onSelect: (pad: QuickpadOut) => void
  onNew: () => void
}

function ListPanel({ items, selectedId, currentUsername, onSelect, onNew }: ListPanelProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'mine'>('all')

  const filtered = items.filter((p) => {
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? '').toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || p.owner_username === currentUsername
    return matchSearch && matchFilter
  })

  return (
    <div className="flex flex-col h-full border-r" style={{ borderColor: 'var(--c-border)' }}>
      {/* Header */}
      <div className="shrink-0 px-3 py-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-sm font-semibold text-slate-200">Quickpads</h2>
          <button
            onClick={onNew}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-white transition-colors"
            style={{ backgroundColor: '#6366f1' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#4f46e5' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#6366f1' }}
          >
            <span className="text-base leading-none">+</span> New
          </button>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 border mb-2"
          style={{ backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border)', color: 'var(--c-text)' }}
        />

        <div className="flex gap-1">
          {(['all', 'mine'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="flex-1 py-1 rounded text-xs transition-colors capitalize"
              style={
                filter === f
                  ? { backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8' }
                  : { color: 'var(--c-muted-3)' }
              }
            >
              {f === 'all' ? 'All' : 'Mine'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-center text-xs italic py-6" style={{ color: 'var(--c-muted-4)' }}>
            {search ? 'No results' : 'No quickpads yet'}
          </p>
        )}
        {filtered.map((pad) => {
          const isSelected = pad.id === selectedId
          const isMine = pad.owner_username === currentUsername
          return (
            <button
              key={pad.id}
              onClick={() => onSelect(pad)}
              className="w-full text-left px-3 py-2.5 transition-colors border-b"
              style={{
                borderColor: 'var(--c-surface)',
                backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.03)'
              }}
              onMouseLeave={(e) => {
                if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
              }}
            >
              <div className="flex items-start justify-between gap-1.5">
                <span className={`text-xs font-medium truncate ${isSelected ? 'text-indigo-300' : 'text-slate-300'}`}>
                  {pad.name}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {!isMine && (
                    <span className="text-xs" style={{ color: 'var(--c-muted-4)' }} title={`By ${pad.owner_username}`}>
                      👤
                    </span>
                  )}
                  <span
                    className="text-xs"
                    title={pad.is_public ? 'Public' : 'Private'}
                    style={{ color: pad.is_public ? '#34d399' : '#fbbf24', opacity: 0.7 }}
                  >
                    {pad.is_public ? '🌐' : '🔒'}
                  </span>
                </div>
              </div>
              {pad.description && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--c-muted-4)' }}>
                  {pad.description}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function QuickpadsPage() {
  const { user } = useAuth()
  const username = user?.username ?? ''

  const { data, isLoading } = useQuery({
    queryKey: ['quickpads'],
    queryFn: listQuickpads,
  })

  const [selectedPad, setSelectedPad] = useState<QuickpadOut | null>(null)
  const [isNew, setIsNew] = useState(false)

  const editorKey = useCallback(
    (pad: QuickpadOut | null) => (pad ? pad.id + '_' + pad.updated_at : 'new'),
    [],
  )

  function handleSelect(pad: QuickpadOut) {
    setSelectedPad(pad)
    setIsNew(false)
  }

  function handleNew() {
    setSelectedPad(null)
    setIsNew(true)
  }

  function handleCreated(pad: QuickpadOut) {
    setSelectedPad(pad)
    setIsNew(false)
  }

  function handleDeleted() {
    setSelectedPad(null)
    setIsNew(false)
  }

  const items = data?.items ?? []

  return (
    <div className="-mx-6 -mb-6 flex" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* Left: list */}
      <div className="w-64 shrink-0 flex flex-col" style={{ backgroundColor: 'var(--c-surface-alt)' }}>
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--c-border-bright)' }}>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <ListPanel
            items={items}
            selectedId={selectedPad?.id ?? null}
            currentUsername={username}
            onSelect={handleSelect}
            onNew={handleNew}
          />
        )}
      </div>

      {/* Right: editor */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--c-base)' }}>
        {!selectedPad && !isNew ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7" style={{ color: '#6366f1' }}>
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-400">Select a quickpad or create a new one</p>
            <button
              onClick={handleNew}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: '#6366f1' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#4f46e5' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#6366f1' }}
            >
              + New Quickpad
            </button>
          </div>
        ) : (
          <EditorPanel
            key={editorKey(selectedPad)}
            pad={selectedPad}
            currentUsername={username}
            onSaved={setSelectedPad}
            onCreated={handleCreated}
            onDeleted={handleDeleted}
          />
        )}
      </div>
    </div>
  )
}
