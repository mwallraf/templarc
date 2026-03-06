import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listParameters,
  createParameter,
  updateParameter,
  createParameterOption,
  deleteParameterOption,
} from '../../api/parameters'
import { listProjects } from '../../api/catalog'
import { listTemplates } from '../../api/templates'
import type { ParameterOut, ParameterScope, WidgetType } from '../../api/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocalOption {
  _tid: string                // temp id for UI keying
  id?: number                // set if from API
  value: string
  label: string
  condition_param?: string
  condition_value?: string
  sort_order: number
  _deleted?: boolean
}

interface FormValues {
  name: string
  scope: ParameterScope
  widget_type: WidgetType
  label: string
  description: string
  help_text: string
  default_value: string
  required: boolean
  validation_regex: string
  is_derived: boolean
  derived_expression: string
  organization_id: string
  project_id: string
  template_id: string
}

export interface ParameterModalProps {
  parameter?: ParameterOut
  onClose: () => void
  onSaved: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const WIDGET_OPTIONS: { value: WidgetType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'select', label: 'Select (dropdown)' },
  { value: 'multiselect', label: 'Multiselect (checkboxes)' },
  { value: 'checkbox', label: 'Checkbox (boolean)' },
  { value: 'password', label: 'Password' },
  { value: 'readonly', label: 'Read-only' },
]

function stripScopePrefix(name: string): string {
  return name.replace(/^(glob\.|proj\.)/, '')
}

function applyPrefix(scope: ParameterScope, name: string): string {
  const bare = stripScopePrefix(name)
  if (scope === 'global') return 'glob.' + bare
  if (scope === 'project') return 'proj.' + bare
  return bare
}

const inputClass =
  'w-full rounded-lg px-3 py-2 text-sm border transition-colors duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed'

const inputStyle = {
  backgroundColor: '#141828',
  borderColor: '#2a3255',
  color: '#e2e8f4',
}

const smallInputClass =
  'w-full rounded px-2 py-1 text-xs border transition-colors duration-150 focus:outline-none'

// ── OptionRow ─────────────────────────────────────────────────────────────────

function OptionRow({
  opt,
  allParams,
  onChange,
  onRemove,
}: {
  opt: LocalOption
  allParams: ParameterOut[]
  onChange: (o: LocalOption) => void
  onRemove: () => void
}) {
  const [showCondition, setShowCondition] = useState(!!opt.condition_param)

  return (
    <div
      className="rounded-lg p-3 space-y-2 text-xs border"
      style={{ backgroundColor: '#0a0d1a', borderColor: '#2a3255' }}
    >
      <div className="flex gap-2 items-start">
        <div className="flex-1 grid grid-cols-2 gap-2">
          <div>
            <label className="block mb-0.5 font-medium" style={{ color: '#64748b' }}>Value *</label>
            <input
              value={opt.value}
              onChange={(e) => onChange({ ...opt, value: e.target.value })}
              placeholder="e.g. LON-1"
              className={smallInputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block mb-0.5 font-medium" style={{ color: '#64748b' }}>Label *</label>
            <input
              value={opt.label}
              onChange={(e) => onChange({ ...opt, label: e.target.value })}
              placeholder="e.g. London"
              className={smallInputClass}
              style={inputStyle}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-lg leading-none mt-3 ml-1 shrink-0 transition-colors"
          style={{ color: '#ef4444' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#ef4444' }}
        >
          ×
        </button>
      </div>

      <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: '#64748b' }}>
        <input
          type="checkbox"
          checked={showCondition}
          onChange={(e) => {
            setShowCondition(e.target.checked)
            if (!e.target.checked) onChange({ ...opt, condition_param: undefined, condition_value: undefined })
          }}
          className="rounded"
          style={{ accentColor: '#6366f1' }}
        />
        Conditional (only show when another field has a specific value)
      </label>

      {showCondition && (
        <div
          className="grid grid-cols-2 gap-2 pt-2 border-t"
          style={{ borderColor: '#1e2440' }}
        >
          <div>
            <label className="block mb-0.5 font-medium" style={{ color: '#64748b' }}>When parameter</label>
            <select
              value={opt.condition_param ?? ''}
              onChange={(e) => onChange({ ...opt, condition_param: e.target.value || undefined })}
              className={smallInputClass}
              style={inputStyle}
            >
              <option value="" style={{ backgroundColor: '#141828' }}>— select —</option>
              {allParams.map((p) => (
                <option key={p.id} value={p.name} style={{ backgroundColor: '#141828' }}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-0.5 font-medium" style={{ color: '#64748b' }}>equals</label>
            <input
              value={opt.condition_value ?? ''}
              onChange={(e) => onChange({ ...opt, condition_value: e.target.value || undefined })}
              placeholder="exact value"
              className={smallInputClass}
              style={inputStyle}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── ParameterModal ────────────────────────────────────────────────────────────

export function ParameterModal({ parameter, onClose, onSaved }: ParameterModalProps) {
  const isEdit = !!parameter
  const qc = useQueryClient()
  const uid = useId()
  const prevScope = useRef<ParameterScope | null>(null)

  // Options state: local copy including new/deleted
  const [options, setOptions] = useState<LocalOption[]>(
    (parameter?.options ?? []).map((o) => ({ ...o, _tid: String(o.id) })),
  )
  const [originalIds] = useState(new Set(parameter?.options.map((o) => o.id) ?? []))

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      name: parameter?.name ?? '',
      scope: parameter?.scope ?? 'template',
      widget_type: parameter?.widget_type ?? 'text',
      label: parameter?.label ?? '',
      description: parameter?.description ?? '',
      help_text: parameter?.help_text ?? '',
      default_value: parameter?.default_value ?? '',
      required: parameter?.required ?? false,
      validation_regex: parameter?.validation_regex ?? '',
      is_derived: parameter?.is_derived ?? false,
      derived_expression: parameter?.derived_expression ?? '',
      organization_id: String(parameter?.organization_id ?? ''),
      project_id: String(parameter?.project_id ?? ''),
      template_id: String(parameter?.template_id ?? ''),
    },
  })

  const scope = watch('scope')
  const widgetType = watch('widget_type')
  const isDerived = watch('is_derived')
  const projectId = watch('project_id')

  // Auto-apply name prefix when scope changes
  useEffect(() => {
    if (prevScope.current === null) {
      prevScope.current = scope
      return
    }
    if (prevScope.current === scope) return
    prevScope.current = scope
    const current = watch('name')
    setValue('name', applyPrefix(scope, current), { shouldValidate: false })
  }, [scope, setValue, watch])

  // Data queries
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(),
  })

  const { data: templateList } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => listTemplates({ project_id: Number(projectId), active_only: false }),
    enabled: scope === 'template' && !!projectId,
  })

  // All parameters (for condition selectors in OptionRow)
  const { data: allParamsData } = useQuery({
    queryKey: ['parameters', 'all-for-conditions'],
    queryFn: () => listParameters({ page_size: 200 }),
  })
  const allParams = allParamsData?.items ?? []

  // Mutations
  const saveMut = useMutation({
    mutationFn: async (values: FormValues) => {
      const base = {
        name: applyPrefix(values.scope, values.name),
        scope: values.scope,
        widget_type: values.widget_type,
        label: values.label || undefined,
        description: values.description || undefined,
        help_text: values.help_text || undefined,
        default_value: values.default_value || undefined,
        required: values.required,
        validation_regex: values.validation_regex || undefined,
        is_derived: values.is_derived,
        derived_expression: values.derived_expression || undefined,
        ...(values.scope === 'global' && { organization_id: Number(values.organization_id) || 1 }),
        ...(values.scope !== 'global' && values.project_id && {
          project_id: Number(values.project_id),
        }),
        ...(values.scope === 'template' && values.template_id && {
          template_id: Number(values.template_id),
        }),
      }

      let paramId = parameter?.id

      if (isEdit) {
        await updateParameter(parameter!.id, base)
      } else {
        const created = await createParameter(base as Parameters<typeof createParameter>[0])
        paramId = created.id
      }

      if (!paramId) return

      // Create new options
      const newOptions = options.filter((o) => !o._deleted && !o.id && o.value && o.label)
      for (const opt of newOptions) {
        await createParameterOption(paramId, {
          value: opt.value,
          label: opt.label,
          condition_param: opt.condition_param,
          condition_value: opt.condition_value,
          sort_order: opt.sort_order,
        })
      }

      // Delete removed options (had an id that's no longer in the list)
      const currentIds = new Set(options.filter((o) => o.id && !o._deleted).map((o) => o.id!))
      for (const oid of originalIds) {
        if (!currentIds.has(oid)) {
          await deleteParameterOption(paramId, oid)
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parameters'] })
      onSaved()
    },
  })

  function addOption() {
    setOptions((prev) => [
      ...prev,
      { _tid: `new-${Date.now()}`, value: '', label: '', sort_order: prev.length },
    ])
  }

  function updateOption(tid: string, updated: LocalOption) {
    setOptions((prev) => prev.map((o) => (o._tid === tid ? updated : o)))
  }

  function removeOption(tid: string) {
    setOptions((prev) =>
      prev.map((o) => (o._tid === tid ? { ...o, _deleted: true } : o)),
    )
  }

  const visibleOptions = options.filter((o) => !o._deleted)
  const showOptions = ['select', 'multiselect'].includes(widgetType)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border"
        style={{
          backgroundColor: '#0d1021',
          borderColor: '#1e2440',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b rounded-t-2xl shrink-0"
          style={{ backgroundColor: '#0a0d1a', borderColor: '#1e2440' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <h2 className="font-semibold text-slate-100 font-display">
              {isEdit ? `Edit: ${parameter!.name}` : 'New Parameter'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none transition-colors"
            style={{ color: '#3d4777' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#94a3b8' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#3d4777' }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <form
          id={uid}
          onSubmit={handleSubmit((v) => saveMut.mutate(v))}
          className="overflow-y-auto p-6 space-y-5 flex-1"
        >
          {/* Scope + Name row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>
                Scope <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                className={inputClass}
                style={inputStyle}
                {...register('scope', { required: true })}
              >
                <option value="global" style={{ backgroundColor: '#141828' }}>Global (glob.*)</option>
                <option value="project" style={{ backgroundColor: '#141828' }}>Project (proj.*)</option>
                <option value="template" style={{ backgroundColor: '#141828' }}>Template</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>
                Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className={inputClass + ' font-mono'}
                style={inputStyle}
                placeholder={
                  scope === 'global' ? 'glob.ntp_server' :
                  scope === 'project' ? 'proj.default_vrf' :
                  'router.hostname'
                }
                {...register('name', {
                  required: 'Name is required',
                  validate: (v) => {
                    if (scope === 'global' && !v.startsWith('glob.')) return 'Global parameters must start with glob.'
                    if (scope === 'project' && !v.startsWith('proj.')) return 'Project parameters must start with proj.'
                    if ((scope === 'template') && (v.startsWith('glob.') || v.startsWith('proj.'))) return 'Template parameters cannot use glob./proj. prefix'
                    return true
                  },
                })}
              />
              {errors.name && (
                <p className="text-xs mt-0.5" style={{ color: '#f87171' }}>{errors.name.message}</p>
              )}
            </div>
          </div>

          {/* Project + Template selectors (conditional) */}
          {scope !== 'global' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Project</label>
                <select
                  className={inputClass}
                  style={inputStyle}
                  {...register('project_id')}
                >
                  <option value="" style={{ backgroundColor: '#141828' }}>— select project —</option>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id} style={{ backgroundColor: '#141828' }}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </div>
              {scope === 'template' && (
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Template</label>
                  <select
                    className={inputClass}
                    style={{
                      ...inputStyle,
                      opacity: !projectId ? 0.5 : 1,
                    }}
                    disabled={!projectId}
                    {...register('template_id')}
                  >
                    <option value="" style={{ backgroundColor: '#141828' }}>— select template —</option>
                    {(templateList ?? []).map((t) => (
                      <option key={t.id} value={t.id} style={{ backgroundColor: '#141828' }}>
                        {t.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Widget type */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Widget type</label>
            <select
              className={inputClass}
              style={inputStyle}
              {...register('widget_type')}
            >
              {WIDGET_OPTIONS.map((w) => (
                <option key={w.value} value={w.value} style={{ backgroundColor: '#141828' }}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>

          {/* Label + help_text */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Label</label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="Human-readable name"
                {...register('label')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Help text</label>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="Shown below the field"
                {...register('help_text')}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Description</label>
            <textarea
              rows={2}
              className={inputClass}
              style={inputStyle}
              placeholder="Longer description (admin reference)"
              {...register('description')}
            />
          </div>

          {/* Default value + required */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Default value</label>
              <input
                className={inputClass}
                style={inputStyle}
                {...register('default_value')}
              />
            </div>
            <div className="flex items-center gap-2.5 pb-2">
              <input
                type="checkbox"
                id="req"
                {...register('required')}
                style={{ accentColor: '#6366f1', width: '14px', height: '14px' }}
              />
              <label htmlFor="req" className="text-sm cursor-pointer" style={{ color: '#94a3b8' }}>
                Required
              </label>
            </div>
          </div>

          {/* Validation regex (not for select/checkbox/readonly) */}
          {!['select', 'multiselect', 'checkbox', 'readonly'].includes(widgetType) && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Validation regex</label>
              <input
                className={inputClass + ' font-mono'}
                style={inputStyle}
                placeholder="e.g. ^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$"
                {...register('validation_regex')}
              />
            </div>
          )}

          {/* Derived parameter */}
          <div
            className="rounded-xl p-4 space-y-3 border"
            style={{ backgroundColor: '#0a0d1a', borderColor: '#1e2440' }}
          >
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="derived"
                {...register('is_derived')}
                style={{ accentColor: '#6366f1', width: '14px', height: '14px' }}
              />
              <label htmlFor="derived" className="text-sm font-medium cursor-pointer" style={{ color: '#94a3b8' }}>
                Derived parameter
              </label>
              <span className="text-xs" style={{ color: '#3d4777' }}>
                — value is computed from other parameters
              </span>
            </div>

            {isDerived && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: '#8892b0' }}>Expression</label>
                <textarea
                  rows={3}
                  className={inputClass + ' font-mono'}
                  style={inputStyle}
                  placeholder={'{{ router.hostname }}.{{ proj.domain }}'}
                  {...register('derived_expression')}
                />
                <p className="text-xs mt-2" style={{ color: '#3d4777' }}>
                  Use Jinja2 syntax referencing other parameter names.{' '}
                  <span
                    className="font-mono px-1 py-0.5 rounded text-xs"
                    style={{ backgroundColor: '#141828', color: '#22d3ee', border: '1px solid #2a3255' }}
                  >
                    {'{{ glob.domain }}'}
                  </span>{' '}
                  is a global param,{' '}
                  <span
                    className="font-mono px-1 py-0.5 rounded text-xs"
                    style={{ backgroundColor: '#141828', color: '#22d3ee', border: '1px solid #2a3255' }}
                  >
                    {'{{ proj.vrf }}'}
                  </span>{' '}
                  is a project param.
                </p>
              </div>
            )}
          </div>

          {/* Options builder (select / multiselect only) */}
          {showOptions && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" style={{ color: '#94a3b8' }}>
                  Options{' '}
                  <span className="text-xs font-normal" style={{ color: '#3d4777' }}>
                    ({visibleOptions.length} defined)
                  </span>
                </label>
                <button
                  type="button"
                  onClick={addOption}
                  className="text-xs px-2.5 py-1 rounded-lg border transition-colors"
                  style={{ color: '#818cf8', borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.08)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.15)'
                    e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.08)'
                    e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'
                  }}
                >
                  + Add option
                </button>
              </div>

              {visibleOptions.length === 0 && (
                <p
                  className="text-xs italic text-center py-5 rounded-lg border border-dashed"
                  style={{ color: '#3d4777', borderColor: '#2a3255' }}
                >
                  No options yet — click "Add option"
                </p>
              )}

              <div className="space-y-2">
                {visibleOptions.map((opt) => (
                  <OptionRow
                    key={opt._tid}
                    opt={opt}
                    allParams={allParams}
                    onChange={(updated) => updateOption(opt._tid, updated)}
                    onRemove={() => removeOption(opt._tid)}
                  />
                ))}
              </div>
            </div>
          )}

          {saveMut.error && (
            <div
              className="text-sm rounded-lg px-4 py-3 border"
              style={{
                color: '#fca5a5',
                backgroundColor: 'rgba(239,68,68,0.08)',
                borderColor: 'rgba(239,68,68,0.2)',
              }}
            >
              {saveMut.error instanceof Error ? saveMut.error.message : 'Save failed'}
            </div>
          )}
        </form>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 border-t rounded-b-2xl shrink-0"
          style={{ backgroundColor: '#0a0d1a', borderColor: '#1e2440' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border transition-colors"
            style={{ color: '#8892b0', borderColor: '#2a3255', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#141828'
              e.currentTarget.style.color = '#cbd5e1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#8892b0'
            }}
          >
            Cancel
          </button>
          <button
            form={uid}
            type="submit"
            disabled={saveMut.isPending}
            className="px-5 py-2 text-sm font-medium rounded-lg text-white transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: '0 2px 8px rgba(99,102,241,0.35)',
            }}
            onMouseEnter={(e) => {
              if (!saveMut.isPending) e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,0.5)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,0.35)'
            }}
          >
            {saveMut.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create parameter'}
          </button>
        </div>
      </div>
    </div>
  )
}
