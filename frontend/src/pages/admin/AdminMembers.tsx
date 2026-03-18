import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listProjects } from '../../api/catalog'
import { listUsers } from '../../api/auth'
import { listProjectMembers, upsertProjectMember, removeProjectMember } from '../../api/admin'
import type { ProjectMembershipCreate } from '../../api/types'

const PROJECT_ROLES = ['guest', 'project_member', 'project_editor', 'project_admin'] as const
type ProjectRole = (typeof PROJECT_ROLES)[number]

function roleLabel(role: string): string {
  switch (role) {
    case 'project_admin': return 'Admin'
    case 'project_editor': return 'Editor'
    case 'project_member': return 'Member'
    case 'guest': return 'Guest'
    default: return role
  }
}

function roleStyle(role: string): React.CSSProperties {
  switch (role) {
    case 'project_admin': return { color: '#f59e0b', borderColor: '#78350f', backgroundColor: 'rgba(245,158,11,0.08)' }
    case 'project_editor': return { color: '#818cf8', borderColor: '#312e81', backgroundColor: 'rgba(99,102,241,0.08)' }
    case 'project_member': return { color: '#34d399', borderColor: '#064e3b', backgroundColor: 'rgba(52,211,153,0.08)' }
    case 'guest': return { color: 'var(--c-muted-3)', borderColor: 'var(--c-border)', backgroundColor: 'transparent' }
    default: return {}
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

const selectStyle: React.CSSProperties = {
  backgroundColor: 'var(--c-elevated)',
  border: '1px solid var(--c-border)',
  color: 'var(--c-text)',
  borderRadius: '8px',
  padding: '6px 10px',
  fontSize: '13px',
  outline: 'none',
}

export default function AdminMembers() {
  const qc = useQueryClient()
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<ProjectRole>('project_member')
  const [addError, setAddError] = useState<string | null>(null)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })

  const { data: memberships, isLoading: loadingMembers } = useQuery({
    queryKey: ['project-members', selectedProjectId],
    queryFn: () => listProjectMembers(selectedProjectId),
    enabled: !!selectedProjectId,
  })

  const upsertMut = useMutation({
    mutationFn: (data: ProjectMembershipCreate) => upsertProjectMember(selectedProjectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', selectedProjectId] })
      setAddUserId('')
      setAddRole('project_member')
      setAddError(null)
    },
    onError: (e: any) => {
      setAddError(e?.response?.data?.detail ?? 'Failed to add member')
    },
  })

  const removeMut = useMutation({
    mutationFn: (userId: string) => removeProjectMember(selectedProjectId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', selectedProjectId] }),
  })

  const changeRoleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      upsertProjectMember(selectedProjectId, { user_id: userId, role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', selectedProjectId] }),
  })

  const selectedProject = projects.find((p: any) => p.id === selectedProjectId)

  // Users not already a member (for the add dropdown)
  const memberUserIds = new Set((memberships?.items ?? []).map((m) => m.user_id))
  const availableUsers = users.filter((u: any) => !memberUserIds.has(u.id))

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white font-display">Project Members</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-muted-3)' }}>
          Manage who has access to each project and what role they hold.
        </p>
      </div>

      {/* Project selector */}
      <div className="rounded-xl border p-4 mb-6" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--c-muted-3)' }}>
          Select project
        </label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          style={{ ...selectStyle, width: '100%', maxWidth: '360px' }}
        >
          <option value="">— choose a project —</option>
          {projects.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {!selectedProjectId ? (
        <div className="text-center py-20" style={{ color: 'var(--c-muted-4)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-12 h-12 mx-auto mb-4 opacity-40">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
          <p className="text-sm">Select a project to manage its members</p>
        </div>
      ) : (
        <>
          {/* Add member form */}
          <div
            className="rounded-xl border p-5 mb-5"
            style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
          >
            <h2 className="text-sm font-semibold mb-3 font-display" style={{ color: 'var(--c-text)' }}>
              Add member to <span style={{ color: '#818cf8' }}>{selectedProject?.name}</span>
            </h2>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-48">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>User</label>
                <select
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  style={{ ...selectStyle, width: '100%' }}
                >
                  <option value="">— select user —</option>
                  {availableUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.username}{u.email ? ` (${u.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-2)' }}>Role</label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as ProjectRole)}
                  style={selectStyle}
                >
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => {
                  if (!addUserId) { setAddError('Please select a user'); return }
                  upsertMut.mutate({ user_id: addUserId, role: addRole })
                }}
                disabled={upsertMut.isPending || !addUserId}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                  boxShadow: '0 4px 14px rgba(99,102,241,0.25)',
                }}
              >
                {upsertMut.isPending ? 'Adding…' : 'Add'}
              </button>
            </div>
            {addError && (
              <p className="text-xs mt-2" style={{ color: '#f87171' }}>{addError}</p>
            )}
          </div>

          {/* Members table */}
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
            {loadingMembers ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 rounded-lg skeleton" />
                ))}
              </div>
            ) : !memberships?.items?.length ? (
              <p className="px-4 py-10 text-center text-sm" style={{ color: 'var(--c-muted-3)' }}>
                No explicit members yet. Org admins have implicit project_admin access.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ backgroundColor: 'var(--c-surface-alt)', borderBottom: '1px solid var(--c-border)' }}>
                    <tr>
                      {['User', 'Email', 'Role', 'Since', ''].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-muted-4)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {memberships.items.map((m, idx) => (
                      <tr
                        key={m.id}
                        style={{
                          borderBottom: idx < memberships.items.length - 1 ? '1px solid var(--c-border)' : 'none',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--c-row-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: 'var(--c-muted-2)' }}>
                          {m.username}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-3)' }}>
                          {m.email || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={m.role}
                            onChange={(e) => changeRoleMut.mutate({ userId: m.user_id, role: e.target.value })}
                            disabled={changeRoleMut.isPending}
                            style={{
                              ...selectStyle,
                              padding: '2px 8px',
                              fontSize: '11px',
                              ...roleStyle(m.role),
                              border: `1px solid ${roleStyle(m.role).borderColor ?? 'var(--c-border)'}`,
                            }}
                          >
                            {PROJECT_ROLES.map((r) => (
                              <option key={r} value={r}>{roleLabel(r)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted-4)' }}>
                          {formatDate(m.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              if (confirm(`Remove ${m.username} from this project?`)) {
                                removeMut.mutate(m.user_id)
                              }
                            }}
                            disabled={removeMut.isPending}
                            className="text-xs font-medium transition-colors disabled:opacity-30"
                            style={{ color: '#ef4444' }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs mt-3" style={{ color: 'var(--c-muted-4)' }}>
            Note: users with org_owner or org_admin role always have implicit project_admin access regardless of entries here.
          </p>
        </>
      )}
    </div>
  )
}
