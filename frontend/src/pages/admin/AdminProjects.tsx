import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { listProjects, createProject, updateProject, deleteProject } from '../../api/catalog'
import { listTemplates } from '../../api/templates'
import { listParameters } from '../../api/parameters'
import { listFilters, listObjects, listMacros, getRemoteStatus, cloneRemote, pullRemote, pushRemote, testRemoteConnection } from '../../api/admin'
import type { ProjectOut, ProjectCreate, ProjectUpdate } from '../../api/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const COMMENT_STYLES = [
  { value: '#',  label: '# (shell / Python)' },
  { value: '!',  label: '! (Cisco IOS)' },
  { value: '//', label: '// (C-style)' },
  { value: '<!--', label: '<!-- (XML / HTML)' },
  { value: 'none', label: 'none (no header)' },
]

const inputCls = 'w-full rounded-lg px-3 py-2 text-sm text-slate-100 border transition-colors focus:outline-none'
const inputStyle = { backgroundColor: 'var(--c-card)', borderColor: 'var(--c-border-bright)' }

// ── Remote git status badge ────────────────────────────────────────────────────

const STATUS_CONFIG = {
  no_remote:  { color: 'var(--c-muted-4)',          label: 'no remote' },
  not_cloned: { color: '#f59e0b',                   label: 'not cloned' },
  in_sync:    { color: '#34d399',                   label: 'in sync' },
  ahead:      { color: '#60a5fa',                   label: 'ahead' },
  behind:     { color: '#f59e0b',                   label: 'behind' },
  diverged:   { color: '#f87171',                   label: 'diverged' },
  error:      { color: '#f87171',                   label: 'error' },
} as const

function RemoteStatusBadge({ status, ahead, behind }: { status: string; ahead: number; behind: number }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.error
  const detail =
    status === 'ahead' ? ` +${ahead}` :
    status === 'behind' ? ` -${behind}` :
    status === 'diverged' ? ` +${ahead}/-${behind}` : ''
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded border font-mono"
      style={{ color: cfg.color, borderColor: `${cfg.color}33`, backgroundColor: `${cfg.color}11` }}
    >
      {cfg.label}{detail}
    </span>
  )
}

// ── Remote git panel ──────────────────────────────────────────────────────────

function RemoteGitPanel({ project }: { project: ProjectOut }) {
  const qc = useQueryClient()
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const statusQ = useQuery({
    queryKey: ['git-remote-status', project.id],
    queryFn: () => getRemoteStatus(project.id),
    enabled: !!project.remote_url,
    staleTime: 30_000,
  })

  const cloneMut = useMutation({
    mutationFn: () => cloneRemote(project.id),
    onSuccess: (data) => {
      setActionMsg({ ok: true, text: data.message })
      qc.invalidateQueries({ queryKey: ['git-remote-status', project.id] })
    },
    onError: (err: Error) => setActionMsg({ ok: false, text: err.message }),
  })

  const pullMut = useMutation({
    mutationFn: () => pullRemote(project.id),
    onSuccess: (data) => {
      setActionMsg({ ok: true, text: `${data.message} (${data.new_sha?.slice(0, 7)})` })
      qc.invalidateQueries({ queryKey: ['git-remote-status', project.id] })
    },
    onError: (err: Error) => setActionMsg({ ok: false, text: err.message }),
  })

  const pushMut = useMutation({
    mutationFn: () => pushRemote(project.id),
    onSuccess: (data) => {
      setActionMsg({ ok: true, text: `${data.message} (${data.new_sha?.slice(0, 7)})` })
      qc.invalidateQueries({ queryKey: ['git-remote-status', project.id] })
    },
    onError: (err: Error) => setActionMsg({ ok: false, text: err.message }),
  })

  const testMut = useMutation({
    mutationFn: () => testRemoteConnection(project.id),
    onSuccess: (data) => {
      const detail = data.branch_sha ? ` (${data.branch_sha.slice(0, 7)})` : ''
      setActionMsg({ ok: data.success, text: `${data.message}${detail}` })
    },
    onError: (err: Error) => setActionMsg({ ok: false, text: err.message }),
  })

  if (!project.remote_url) return null

  const st = statusQ.data
  const isPending = cloneMut.isPending || pullMut.isPending || pushMut.isPending || testMut.isPending

  return (
    <div
      className="mt-3 rounded-lg border p-3"
      style={{ backgroundColor: 'rgba(99,102,241,0.04)', borderColor: 'rgba(99,102,241,0.2)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {/* Globe icon */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0" style={{ color: '#818cf8' }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
        <span className="text-xs font-mono truncate max-w-xs" style={{ color: 'var(--c-muted-3)' }}>
          {project.remote_url}
        </span>
        <span className="text-xs font-mono" style={{ color: 'var(--c-muted-4)' }}>
          @ {project.remote_branch}
        </span>

        {/* Status */}
        {statusQ.isLoading && (
          <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>checking…</span>
        )}
        {st && (
          <RemoteStatusBadge status={st.status} ahead={st.ahead} behind={st.behind} />
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 ml-auto">
          {st?.status === 'not_cloned' && (
            <button
              onClick={() => { setActionMsg(null); cloneMut.mutate() }}
              disabled={isPending}
              className="px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-50"
              style={{ borderColor: 'rgba(99,102,241,0.4)', color: '#818cf8', backgroundColor: 'rgba(99,102,241,0.08)' }}
            >
              {cloneMut.isPending ? 'Cloning…' : 'Clone'}
            </button>
          )}
          {(st?.status === 'behind' || st?.status === 'in_sync') && (
            <button
              onClick={() => { setActionMsg(null); pullMut.mutate() }}
              disabled={isPending}
              className="px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-50"
              style={{ borderColor: 'rgba(96,165,250,0.4)', color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.08)' }}
            >
              {pullMut.isPending ? 'Pulling…' : 'Pull'}
            </button>
          )}
          {(st?.status === 'ahead' || st?.status === 'in_sync') && (
            <button
              onClick={() => { setActionMsg(null); pushMut.mutate() }}
              disabled={isPending}
              className="px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-50"
              style={{ borderColor: 'rgba(52,211,153,0.4)', color: '#34d399', backgroundColor: 'rgba(52,211,153,0.08)' }}
            >
              {pushMut.isPending ? 'Pushing…' : 'Push'}
            </button>
          )}
          {/* Test connection — always visible */}
          <button
            onClick={() => { setActionMsg(null); testMut.mutate() }}
            disabled={isPending}
            className="px-2.5 py-1 rounded text-xs font-medium border transition-colors disabled:opacity-50"
            style={{ borderColor: 'rgba(250,204,21,0.4)', color: '#fbbf24', backgroundColor: 'rgba(250,204,21,0.06)' }}
            title="Test remote connection (git ls-remote)"
          >
            {testMut.isPending ? 'Testing…' : 'Test'}
          </button>
          <button
            onClick={() => { setActionMsg(null); statusQ.refetch() }}
            disabled={statusQ.isFetching || isPending}
            className="p-1 rounded border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-4)' }}
            title="Refresh remote status"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <path d="M1 4v6h6M23 20v-6h-6" />
              <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* SHA display */}
      {st && st.local_sha && (
        <div className="mt-1.5 flex items-center gap-3 text-xs font-mono" style={{ color: 'var(--c-muted-4)' }}>
          <span title="Local HEAD">local: {st.local_sha.slice(0, 7)}</span>
          {st.remote_sha && <span title="Remote HEAD">remote: {st.remote_sha.slice(0, 7)}</span>}
        </div>
      )}

      {/* Action feedback */}
      {actionMsg && (
        <div
          className="mt-2 text-xs px-2 py-1 rounded"
          style={{
            color: actionMsg.ok ? '#34d399' : '#f87171',
            backgroundColor: actionMsg.ok ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
          }}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Error / diverged warning */}
      {(st?.status === 'error' || st?.status === 'diverged') && st.message && (
        <div className="mt-2 text-xs px-2 py-1 rounded" style={{ color: '#f87171', backgroundColor: 'rgba(248,113,113,0.08)' }}>
          {st.message}
        </div>
      )}
    </div>
  )
}

// ── "New Project" inline form ─────────────────────────────────────────────────

interface CreateFormProps {
  onClose: () => void
  onSuccess: () => void
}

function CreateForm({ onClose, onSuccess }: CreateFormProps) {
  const [showRemote, setShowRemote] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<ProjectCreate>({
    defaultValues: { organization_id: 1, output_comment_style: '#', remote_branch: 'main' },
  })

  const mut = useMutation({
    mutationFn: createProject,
    onSuccess,
  })

  return (
    <div
      className="rounded-xl border p-5 mb-4"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-bright)' }}
    >
      <h3 className="text-sm font-semibold text-slate-200 mb-4">New Project</h3>
      <form
        onSubmit={handleSubmit((data) => mut.mutate(data))}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {/* Hidden org_id — hard-coded to 1 for single-tenant */}
        <input type="hidden" {...register('organization_id', { valueAsNumber: true })} />

        <div>
          <label className="block text-xs text-slate-400 mb-1">Name <span style={{ color: '#f87171' }}>*</span></label>
          <input
            {...register('name', { required: 'Required', pattern: { value: /^[a-z0-9_]+$/, message: 'Lowercase, digits, underscores only' } })}
            placeholder="router_provisioning"
            className={inputCls}
            style={inputStyle}
          />
          {errors.name && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{errors.name.message}</p>}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Display Name <span style={{ color: '#f87171' }}>*</span></label>
          <input
            {...register('display_name', { required: 'Required' })}
            placeholder="Router Provisioning"
            className={inputCls}
            style={inputStyle}
          />
          {errors.display_name && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{errors.display_name.message}</p>}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Git Path</label>
          <input
            {...register('git_path')}
            placeholder="router_provisioning (defaults to name)"
            className={inputCls}
            style={inputStyle}
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Comment Style</label>
          <select
            {...register('output_comment_style')}
            className={inputCls}
            style={inputStyle}
          >
            {COMMENT_STYLES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs text-slate-400 mb-1">Description</label>
          <input
            {...register('description')}
            placeholder="Optional description"
            className={inputCls}
            style={inputStyle}
          />
        </div>

        {/* Remote Git toggle */}
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => setShowRemote((v) => !v)}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: showRemote ? '#818cf8' : 'var(--c-muted-4)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            {showRemote ? 'Hide remote Git settings' : 'Configure remote Git (optional)'}
          </button>
        </div>

        {showRemote && (
          <>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Remote URL</label>
              <input
                {...register('remote_url')}
                placeholder="https://github.com/org/repo.git"
                className={inputCls}
                style={inputStyle}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
                HTTPS or SSH clone URL. Leave blank for local-only.
              </p>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Remote Branch</label>
              <input
                {...register('remote_branch')}
                placeholder="main"
                className={inputCls}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Credential</label>
              <input
                {...register('remote_credential_ref')}
                placeholder="secret:my_git_token or env:GIT_TOKEN"
                className={inputCls}
                style={inputStyle}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>
                Secret reference for HTTPS auth. Leave blank for public repos or SSH.
              </p>
            </div>
          </>
        )}

        {mut.error && (
          <div className="sm:col-span-2 text-xs rounded-lg px-3 py-2 border" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}>
            {mut.error instanceof Error ? mut.error.message : 'Failed to create project'}
          </div>
        )}

        <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm border transition-colors"
            style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-3)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mut.isPending}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}
          >
            {mut.isPending ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Inline edit row ───────────────────────────────────────────────────────────

interface EditFormProps {
  project: ProjectOut
  onClose: () => void
  onSuccess: () => void
}

function EditForm({ project, onClose, onSuccess }: EditFormProps) {
  const [showRemote, setShowRemote] = useState(!!project.remote_url)
  const { register, handleSubmit } = useForm<ProjectUpdate>({
    defaultValues: {
      display_name: project.display_name,
      description: project.description ?? '',
      git_path: project.git_path ?? '',
      output_comment_style: project.output_comment_style,
      remote_url: project.remote_url ?? '',
      remote_branch: project.remote_branch ?? 'main',
      remote_credential_ref: project.remote_credential_ref ?? '',
    },
  })

  const mut = useMutation({
    mutationFn: (data: ProjectUpdate) => updateProject(project.id, data),
    onSuccess,
  })

  return (
    <div
      className="mt-3 rounded-lg border p-4"
      style={{ backgroundColor: 'var(--c-surface-alt)', borderColor: 'var(--c-border-bright)' }}
    >
      <form
        onSubmit={handleSubmit((data) => mut.mutate(data))}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        <div>
          <label className="block text-xs text-slate-400 mb-1">Display Name</label>
          <input {...register('display_name', { required: true })} className={inputCls} style={inputStyle} />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Git Path</label>
          <input {...register('git_path')} className={inputCls} style={inputStyle} />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Comment Style</label>
          <select {...register('output_comment_style')} className={inputCls} style={inputStyle}>
            {COMMENT_STYLES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Description</label>
          <input {...register('description')} className={inputCls} style={inputStyle} />
        </div>

        {/* Remote Git toggle */}
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => setShowRemote((v) => !v)}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: showRemote ? '#818cf8' : 'var(--c-muted-4)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            {showRemote ? 'Hide remote Git settings' : 'Configure remote Git'}
          </button>
        </div>

        {showRemote && (
          <>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Remote URL</label>
              <input
                {...register('remote_url')}
                placeholder="https://github.com/org/repo.git"
                className={inputCls}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Remote Branch</label>
              <input {...register('remote_branch')} placeholder="main" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Credential</label>
              <input
                {...register('remote_credential_ref')}
                placeholder="secret:my_git_token or env:GIT_TOKEN"
                className={inputCls}
                style={inputStyle}
              />
            </div>
          </>
        )}

        {mut.error && (
          <div className="sm:col-span-2 text-xs rounded-lg px-3 py-2 border" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}>
            {mut.error instanceof Error ? mut.error.message : 'Failed to update project'}
          </div>
        )}

        <div className="sm:col-span-2 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs border transition-colors"
            style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-3)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mut.isPending}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Delete confirmation ───────────────────────────────────────────────────────

interface DeleteConfirmProps {
  project: ProjectOut
  templateCount: number
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DeleteConfirm({ project, templateCount, onConfirm, onCancel, isPending }: DeleteConfirmProps) {
  return (
    <div
      className="mt-3 rounded-lg border p-4"
      style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}
    >
      <p className="text-sm text-red-400 font-medium mb-1">
        Delete &ldquo;{project.display_name}&rdquo;?
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--c-muted-3)' }}>
        This will permanently delete the project
        {templateCount > 0 && <> and its <span className="text-red-400 font-medium">{templateCount} template{templateCount !== 1 ? 's' : ''}</span></>}
        {' '}and all project parameters. Git files will remain on disk.
      </p>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs border transition-colors"
          style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-3)' }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={isPending}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 border transition-colors disabled:opacity-50"
          style={{ borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.1)' }}
        >
          {isPending ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </div>
  )
}

// ── Project row ───────────────────────────────────────────────────────────────

interface ProjectRowProps {
  project: ProjectOut
  templateCount: number
  paramCount: number
  filterCount: number
  objectCount: number
  macroCount: number
  onMutated: () => void
}

function ProjectRow({ project, templateCount, paramCount, filterCount, objectCount, macroCount, onMutated }: ProjectRowProps) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const deleteMut = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: onMutated,
  })

  return (
    <div
      className="rounded-xl border p-4 transition-colors"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-100 text-sm">{project.display_name}</span>
            <span
              className="text-xs px-2 py-0.5 rounded border font-mono"
              style={{ color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)', backgroundColor: 'var(--c-card)' }}
            >
              {project.name}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded border font-mono"
              style={{ color: '#22d3ee', borderColor: 'rgba(34,211,238,0.2)', backgroundColor: 'rgba(34,211,238,0.06)' }}
              title="Output header comment style"
            >
              comment:{project.output_comment_style === 'none' ? 'none' : project.output_comment_style}
            </span>
          </div>

          {project.description && (
            <p className="text-xs mt-1 truncate" style={{ color: 'var(--c-muted-3)' }}>{project.description}</p>
          )}

          <div className="flex items-center gap-4 mt-2">
            {project.git_path && (
              <span className="flex items-center gap-1 text-xs font-mono" style={{ color: 'var(--c-muted-4)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                {project.git_path}
              </span>
            )}

            {/* Template count → link to admin/templates */}
            <Link
              to={`/admin/templates?project_id=${project.id}`}
              className="flex items-center gap-1 text-xs transition-colors hover:text-indigo-400"
              style={{ color: templateCount > 0 ? '#6366f1' : 'var(--c-muted-4)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              {templateCount} template{templateCount !== 1 ? 's' : ''}
            </Link>

            {/* Param count → link to admin/parameters for this project */}
            <Link
              to={`/admin/parameters?scope=project&project_id=${project.id}`}
              className="flex items-center gap-1 text-xs transition-colors hover:text-blue-400"
              style={{ color: paramCount > 0 ? '#60a5fa' : 'var(--c-muted-4)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              {paramCount} proj.* param{paramCount !== 1 ? 's' : ''}
            </Link>

            {/* Extension counts (filters / objects / macros scoped to this project) */}
            {(filterCount > 0 || objectCount > 0 || macroCount > 0) && (
              <Link
                to="/admin/filters"
                className="flex items-center gap-1 text-xs transition-colors hover:text-violet-400"
                style={{ color: '#7c3aed' }}
                title="Project-scoped filters, objects, and macros"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                  <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {[
                  filterCount > 0 && `${filterCount} filter${filterCount !== 1 ? 's' : ''}`,
                  objectCount > 0 && `${objectCount} obj${objectCount !== 1 ? 's' : ''}`,
                  macroCount > 0 && `${macroCount} macro${macroCount !== 1 ? 's' : ''}`,
                ].filter(Boolean).join(' · ')}
              </Link>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            to={`/catalog/${project.name}`}
            className="px-2.5 py-1.5 rounded-lg text-xs border transition-colors"
            style={{ borderColor: 'var(--c-border-bright)', color: 'var(--c-muted-3)' }}
            title="View catalog"
          >
            View
          </Link>
          <button
            onClick={() => { setEditing((v) => !v); setConfirming(false) }}
            className="px-2.5 py-1.5 rounded-lg text-xs border transition-colors"
            style={{
              borderColor: editing ? '#6366f1' : 'var(--c-border-bright)',
              color: editing ? '#818cf8' : 'var(--c-muted-3)',
              backgroundColor: editing ? 'rgba(99,102,241,0.08)' : 'transparent',
            }}
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            onClick={() => { setConfirming((v) => !v); setEditing(false) }}
            className="px-2.5 py-1.5 rounded-lg text-xs border transition-colors"
            style={{
              borderColor: confirming ? 'rgba(239,68,68,0.3)' : 'var(--c-border-bright)',
              color: confirming ? '#f87171' : 'var(--c-muted-3)',
              backgroundColor: confirming ? 'rgba(239,68,68,0.08)' : 'transparent',
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Remote Git panel — shown when remote_url is configured */}
      {!editing && !confirming && <RemoteGitPanel project={project} />}

      {/* Inline edit */}
      {editing && (
        <EditForm
          project={project}
          onClose={() => setEditing(false)}
          onSuccess={() => { setEditing(false); onMutated() }}
        />
      )}

      {/* Delete confirmation */}
      {confirming && (
        <DeleteConfirm
          project={project}
          templateCount={templateCount}
          onConfirm={() => deleteMut.mutate()}
          onCancel={() => setConfirming(false)}
          isPending={deleteMut.isPending}
        />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminProjects() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  // Load all templates + project-scoped params once to compute counts
  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: () => listTemplates({ active_only: false }),
  })

  // page_size max is 200 (enforced by backend le=200)
  const { data: projParams } = useQuery({
    queryKey: ['parameters', { scope: 'project' }],
    queryFn: () => listParameters({ scope: 'project', page_size: 200 }),
  })

  const { data: allFilters = [] } = useQuery({
    queryKey: ['admin-filters'],
    queryFn: () => listFilters(),
  })

  const { data: allObjects = [] } = useQuery({
    queryKey: ['admin-objects'],
    queryFn: () => listObjects(),
  })

  const { data: allMacros = [] } = useQuery({
    queryKey: ['admin-macros'],
    queryFn: () => listMacros(),
  })

  // Per-project counts
  const templateCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const t of templates ?? []) {
      counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1)
    }
    return counts
  }, [templates])

  const paramCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const p of projParams?.items ?? []) {
      if (p.project_id != null) {
        counts.set(p.project_id, (counts.get(p.project_id) ?? 0) + 1)
      }
    }
    return counts
  }, [projParams])

  const filterCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const f of allFilters) {
      if (f.project_id != null) counts.set(f.project_id, (counts.get(f.project_id) ?? 0) + 1)
    }
    return counts
  }, [allFilters])

  const objectCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const o of allObjects) {
      if (o.project_id != null) counts.set(o.project_id, (counts.get(o.project_id) ?? 0) + 1)
    }
    return counts
  }, [allObjects])

  const macroCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const m of allMacros) {
      if (m.project_id != null) counts.set(m.project_id, (counts.get(m.project_id) ?? 0) + 1)
    }
    return counts
  }, [allMacros])

  const filtered = useMemo(() => {
    if (!projects) return []
    const q = search.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.display_name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q),
    )
  }, [projects, search])

  function handleMutated() {
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['templates'] })
    qc.invalidateQueries({ queryKey: ['parameters'] })
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white font-display">Projects</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--c-muted-3)' }}>
            Manage template catalog projects and their metadata
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all"
          style={{
            background: showCreate ? 'transparent' : 'linear-gradient(135deg, #6366f1, #818cf8)',
            border: showCreate ? '1px solid var(--c-border-bright)' : 'none',
            color: showCreate ? 'var(--c-muted-3)' : 'white',
          }}
        >
          {showCreate ? 'Cancel' : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Project
            </>
          )}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateForm
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); handleMutated() }}
        />
      )}

      {/* Search bar */}
      {(projects?.length ?? 0) > 3 && (
        <div className="mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className={`${inputCls} max-w-xs`}
            style={inputStyle}
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div
          className="rounded-xl border border-dashed px-6 py-16 text-center"
          style={{ borderColor: 'var(--c-border-bright)' }}
        >
          <p className="text-sm" style={{ color: 'var(--c-muted-3)' }}>
            {search ? 'No projects match your search.' : 'No projects yet.'}
          </p>
          {!search && (
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-block transition-colors"
            >
              Create the first project →
            </button>
          )}
        </div>
      )}

      {/* Project list */}
      <div className="space-y-3">
        {filtered.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            templateCount={templateCounts.get(project.id) ?? 0}
            paramCount={paramCounts.get(project.id) ?? 0}
            filterCount={filterCounts.get(project.id) ?? 0}
            objectCount={objectCounts.get(project.id) ?? 0}
            macroCount={macroCounts.get(project.id) ?? 0}
            onMutated={handleMutated}
          />
        ))}
      </div>

      {/* Summary footer */}
      {!isLoading && projects && projects.length > 0 && (
        <p className="text-xs mt-6 text-center" style={{ color: 'var(--c-dim)' }}>
          {projects.length} project{projects.length !== 1 ? 's' : ''} total
        </p>
      )}
    </div>
  )
}
