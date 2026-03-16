import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import type { AvailableFeatureOut, EnrichedParameterOut, FeatureParamOut, FormDefinitionOut, RenderOut, VisibleWhenCondition } from '../../api/types'
import { onChangeParam, renderTemplate } from '../../api/render'
import { ParameterField } from './ParameterField'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DynamicFormProps {
  templateId: string
  definition: FormDefinitionOut
  prefillValues?: Record<string, unknown>
  user?: string
  persist?: boolean
}

type EnrichmentOverrides = Record<string, Partial<EnrichedParameterOut>>

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDefaultValues(
  params: EnrichedParameterOut[],
  prefill?: Record<string, unknown>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const p of params) {
    // For select widgets with options but no explicit default/prefill,
    // use the first option value so RHF state matches what the HTML select shows.
    const firstOption =
      (p.widget_type === 'select' || p.widget_type === 'multiselect') && p.options?.length
        ? p.options[0].value
        : ''
    const val = prefill?.[p.name] ?? p.prefill ?? p.default_value ?? firstOption ?? ''
    if (p.widget_type === 'multiselect') {
      defaults[p.name] = Array.isArray(val) ? val : val ? [val] : []
    } else if (p.widget_type === 'checkbox') {
      defaults[p.name] = Boolean(val)
    } else if (p.widget_type === 'number') {
      defaults[p.name] = val === '' ? undefined : Number(val)
    } else {
      defaults[p.name] = val
    }
  }
  return defaults
}

/** Evaluate a single visible_when condition against current form values. */
function isVisible(
  param: EnrichedParameterOut,
  currentValues: Record<string, unknown>,
): boolean {
  if (!param.visible_when) return true
  const cond = param.visible_when as VisibleWhenCondition
  const current = String(currentValues[cond.param] ?? '')
  switch (cond.op) {
    case 'eq': return current === String(cond.value)
    case 'ne': return current !== String(cond.value)
    case 'in': return (cond.value as string[]).includes(current)
    case 'not_in': return !(cond.value as string[]).includes(current)
    default: return true
  }
}

const SECTION_ACCENTS = [
  '#6366f1', // indigo
  '#22d3ee', // cyan
  '#f59e0b', // amber
  '#10b981', // emerald
  '#f472b6', // pink
  '#a78bfa', // violet
  '#fb923c', // orange
]

interface SectionGroup {
  title: string
  params: EnrichedParameterOut[]
  accent: string
  initialOpen: boolean
}

/** Returns true if every param in the list has a non-empty default/prefill value. */
function allFilled(params: EnrichedParameterOut[]): boolean {
  return params.every((p) => {
    const v = p.prefill ?? p.default_value
    if (Array.isArray(v)) return v.length > 0
    return v !== undefined && v !== null && String(v).trim() !== ''
  })
}

/**
 * Group params by their `section` field if any param has one.
 * Falls back to scope-based grouping (Global / Project / Template) otherwise.
 * Global and Project sections collapse only when all their fields are pre-filled.
 */
function groupParams(params: EnrichedParameterOut[]): SectionGroup[] {
  const sort = (a: EnrichedParameterOut, b: EnrichedParameterOut) => a.sort_order - b.sort_order
  const hasAnySections = params.some((p) => p.section)

  if (!hasAnySections) {
    const global = params.filter((p) => p.scope === 'global').sort(sort)
    const project = params.filter((p) => p.scope === 'project').sort(sort)
    const template = params.filter((p) => p.scope === 'template').sort(sort)
    const groups: SectionGroup[] = []
    if (global.length) groups.push({ title: 'Global Parameters', params: global, accent: '#fbbf24', initialOpen: !allFilled(global) })
    if (project.length) groups.push({ title: 'Project Parameters', params: project, accent: '#60a5fa', initialOpen: !allFilled(project) })
    if (template.length) groups.push({ title: 'Template Parameters', params: template, accent: '#6366f1', initialOpen: true })
    return groups
  }

  // Section-based: preserve insertion order, "General" bucket for params without a section
  const order: string[] = []
  const map = new Map<string, EnrichedParameterOut[]>()
  for (const p of params) {
    const key = p.section ?? 'General'
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(p)
  }

  return order.map((title, i) => ({
    title,
    params: map.get(title)!.sort(sort),
    accent: SECTION_ACCENTS[i % SECTION_ACCENTS.length],
    initialOpen: true,
  }))
}

// ── Section component ─────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  accent: string
  params: EnrichedParameterOut[]
  visibleCount: number
  initialOpen: boolean
  register: ReturnType<typeof useForm<Record<string, unknown>>>['register']
  control: ReturnType<typeof useForm<Record<string, unknown>>>['control']
  errors: ReturnType<typeof useForm<Record<string, unknown>>>['formState']['errors']
  currentValues: Record<string, unknown>
  loadingFields: Set<string>
  paramVisibility: Record<string, boolean>
}

function ParameterSection({
  title,
  accent,
  params,
  visibleCount,
  initialOpen,
  register,
  control,
  errors,
  currentValues,
  loadingFields,
  paramVisibility,
}: SectionProps) {
  const [open, setOpen] = useState(initialOpen)
  if (params.length === 0) return null

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      {/* Section header — clickable to collapse */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 border-b text-left transition-colors"
        style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: accent }}
        />
        <h3 className="text-xs font-semibold uppercase tracking-widest flex-1" style={{ color: 'var(--c-muted-3)' }}>
          {title}
        </h3>
        <span
          className="text-xs px-2 py-0.5 rounded-full border font-mono"
          style={{
            color: visibleCount < params.length ? '#fbbf24' : accent,
            borderColor: visibleCount < params.length ? 'rgba(251,191,36,0.2)' : `${accent}33`,
            backgroundColor: visibleCount < params.length ? 'rgba(251,191,36,0.07)' : `${accent}11`,
          }}
        >
          {visibleCount < params.length ? `${visibleCount}/${params.length}` : params.length}
        </span>
        <span
          className="text-xs ml-1"
          style={{
            color: 'var(--c-dim)',
            display: 'inline-block',
            transition: 'transform 200ms',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        >
          ▾
        </span>
      </button>

      {/* Fields */}
      {open && (
        <div className="p-4 space-y-5">
          {params.map((p) =>
            paramVisibility[p.name] === false ? null : (
              <ParameterField
                key={p.name}
                param={p}
                register={register}
                control={control}
                errors={errors}
                currentValues={currentValues}
                isLoading={loadingFields.has(p.name)}
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}

// ── Inheritance Chain panel ───────────────────────────────────────────────────

function InheritanceChain({ chain }: { chain: string[] }) {
  const [open, setOpen] = useState(false)
  if (chain.length === 0) return null
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm transition-colors"
        style={{ color: 'var(--c-muted-3)' }}
      >
        <span className="flex items-center gap-2 font-medium">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path d="M16 3h5v5M4 20L21 3M21 16v5h-5" />
          </svg>
          Inheritance chain
        </span>
        <span className="text-xs" style={{ color: 'var(--c-dim)' }}>{open ? '▲ hide' : '▼ show'}</span>
      </button>
      {open && (
        <div className="border-t px-4 py-3" style={{ borderColor: 'var(--c-border)', backgroundColor: 'var(--c-surface-alt)' }}>
          <ol className="flex items-center gap-1.5 flex-wrap text-xs">
            {chain.map((name, i) => (
              <li key={name} className="flex items-center gap-1.5">
                {i > 0 && <span style={{ color: 'var(--c-dim)' }}>›</span>}
                <span
                  className="px-2 py-0.5 rounded-full border font-medium"
                  style={
                    i === chain.length - 1
                      ? { backgroundColor: 'rgba(99,102,241,0.12)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.25)' }
                      : { backgroundColor: 'var(--c-card)', color: 'var(--c-muted-3)', borderColor: 'var(--c-border-bright)' }
                  }
                >
                  {name}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

// ── Render Output ─────────────────────────────────────────────────────────────

function RenderOutput({ result }: { result: RenderOut }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(result.output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(52,211,153,0.25)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{
          backgroundColor: 'rgba(52,211,153,0.06)',
          borderColor: 'rgba(52,211,153,0.15)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: '#34d399' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Rendered output
          </span>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded border"
            style={{ color: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.08)', borderColor: 'rgba(34,211,238,0.2)' }}
          >
            {result.git_sha.slice(0, 8)}
          </span>
          {result.render_id && (
            <span className="text-xs" style={{ color: 'var(--c-muted-3)' }}>
              #{result.render_id}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs px-3 py-1 rounded-lg border transition-all duration-150"
          style={{ color: '#34d399', borderColor: 'rgba(52,211,153,0.2)', backgroundColor: 'rgba(52,211,153,0.06)' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className="p-4 text-xs code-block overflow-x-auto whitespace-pre leading-relaxed max-h-[600px] overflow-y-auto"
        style={{ backgroundColor: 'var(--c-base)', color: '#a5f3c8' }}
      >
        {result.output}
      </pre>
    </div>
  )
}

// ── Features Section ──────────────────────────────────────────────────────────

interface FeaturesSectionProps {
  features: AvailableFeatureOut[]
  enabledIds: Set<string>
  onToggle: (id: string, enabled: boolean) => void
  register: ReturnType<typeof useForm<Record<string, unknown>>>['register']
  getValues: ReturnType<typeof useForm<Record<string, unknown>>>['getValues']
}

function FeatureField({ param, register }: { param: FeatureParamOut; register: FeaturesSectionProps['register'] }) {
  const inputCls = 'w-full rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 border'
  const inputSty = { backgroundColor: 'var(--c-base)', borderColor: 'var(--c-border)', color: 'var(--c-muted-1)' }

  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--c-muted-3)' }}>
        {param.label || param.name}
        {param.required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {param.widget_type === 'textarea' ? (
        <textarea
          {...register(param.name)}
          rows={3}
          defaultValue={param.default_value ?? ''}
          placeholder={param.description ?? ''}
          className={`${inputCls} resize-none`}
          style={inputSty}
        />
      ) : param.widget_type === 'select' && param.options?.length ? (
        <select {...register(param.name)} defaultValue={param.default_value ?? ''} className={inputCls} style={inputSty}>
          <option value="">— select —</option>
          {param.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          {...register(param.name)}
          type={param.widget_type === 'number' ? 'number' : 'text'}
          defaultValue={param.default_value ?? ''}
          placeholder={param.description ?? param.name}
          className={inputCls}
          style={inputSty}
        />
      )}
      {param.description && (
        <p className="text-xs mt-1" style={{ color: 'var(--c-muted-4)' }}>{param.description}</p>
      )}
    </div>
  )
}

function FeaturesSection({ features, enabledIds, onToggle, register }: FeaturesSectionProps) {
  const [open, setOpen] = useState(true)
  if (features.length === 0) return null

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'rgba(99,102,241,0.25)' }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 border-b text-left transition-colors"
        style={{ borderColor: 'rgba(99,102,241,0.15)', backgroundColor: 'rgba(99,102,241,0.05)' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#818cf8' }}>
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <h3 className="text-xs font-semibold uppercase tracking-widest flex-1" style={{ color: '#818cf8' }}>
          Optional Features
        </h3>
        <span
          className="text-xs px-2 py-0.5 rounded-full border font-mono"
          style={{ color: '#818cf8', borderColor: 'rgba(99,102,241,0.25)', backgroundColor: 'rgba(99,102,241,0.1)' }}
        >
          {enabledIds.size}/{features.length}
        </span>
        <span className="text-xs ml-1" style={{ color: 'var(--c-dim)', transition: 'transform 200ms', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', display: 'inline-block' }}>▾</span>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {/* Feature toggle cards */}
          <div className="grid gap-2">
            {features.map((f) => {
              const enabled = enabledIds.has(f.id)
              return (
                <div key={f.id}>
                  {/* Toggle card */}
                  <button
                    type="button"
                    onClick={() => onToggle(f.id, !enabled)}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all border"
                    style={{
                      backgroundColor: enabled ? 'rgba(99,102,241,0.08)' : 'var(--c-surface-alt)',
                      borderColor: enabled ? 'rgba(99,102,241,0.35)' : 'var(--c-border)',
                    }}
                  >
                    {/* Checkbox indicator */}
                    <div
                      className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all"
                      style={{
                        borderColor: enabled ? '#6366f1' : 'var(--c-border-bright)',
                        backgroundColor: enabled ? '#6366f1' : 'transparent',
                      }}
                    >
                      {enabled && (
                        <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" className="w-2.5 h-2.5">
                          <polyline points="2 6 5 9 10 3" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: enabled ? '#a5b4fc' : 'var(--c-muted-1)' }}>
                        {f.label}
                        {f.is_default && !enabled && (
                          <span className="ml-2 text-xs opacity-60" style={{ color: 'var(--c-muted-4)' }}>(default: on)</span>
                        )}
                      </p>
                      {f.description && (
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--c-muted-4)' }}>{f.description}</p>
                      )}
                    </div>
                    {f.parameters.length > 0 && (
                      <span className="text-xs shrink-0" style={{ color: 'var(--c-muted-4)' }}>
                        {f.parameters.length} param{f.parameters.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </button>

                  {/* Inline params when enabled */}
                  {enabled && f.parameters.length > 0 && (
                    <div
                      className="mt-1 ml-7 rounded-lg p-3 space-y-3 border-l-2"
                      style={{ backgroundColor: 'rgba(99,102,241,0.04)', borderLeftColor: '#6366f1' }}
                    >
                      {f.parameters.map((p) => (
                        <FeatureField key={p.name} param={p} register={register} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main DynamicForm ──────────────────────────────────────────────────────────

export default function DynamicForm({
  templateId,
  definition,
  prefillValues,
  user = 'anonymous',
  persist = true,
}: DynamicFormProps) {
  const [enrichmentOverrides, setEnrichmentOverrides] = useState<EnrichmentOverrides>({})
  const [loadingFields, setLoadingFields] = useState<Set<string>>(new Set())
  const [renderResult, setRenderResult] = useState<RenderOut | null>(null)
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Features — initialize default-on features
  const [enabledFeatureIds, setEnabledFeatureIds] = useState<Set<string>>(
    () => new Set((definition.features ?? []).filter((f) => f.is_default).map((f) => f.id))
  )

  function toggleFeature(id: string, enabled: boolean) {
    setEnabledFeatureIds((prev) => {
      const next = new Set(prev)
      if (enabled) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const effectiveParams: EnrichedParameterOut[] = definition.parameters.map((p) => ({
    ...p,
    ...enrichmentOverrides[p.name],
  }))

  const sections = groupParams(effectiveParams)

  const {
    register,
    control,
    handleSubmit,
    getValues,
    watch,
    setValue,
    formState: { errors },
  } = useForm<Record<string, unknown>>({
    defaultValues: buildDefaultValues(definition.parameters, prefillValues),
    mode: 'onBlur',
  })

  useEffect(() => {
    setEnrichmentOverrides({})
    setRenderResult(null)
  }, [templateId])

  const triggerOnChange = useCallback(
    async (paramName: string) => {
      // Read each param by name individually — avoids the literal vs nested key mismatch
      // that occurs when getValues() is called with no arguments on dotted field names.
      const currentParams: Record<string, unknown> = {}
      for (const p of effectiveParams) {
        currentParams[p.name] = getValues(p.name as never)
      }
      console.log('[datasource] on_change triggered for param:', paramName, '| current values:', currentParams)
      setLoadingFields((prev) => new Set(prev).add(paramName))
      try {
        const updates = await onChangeParam(templateId, paramName, {
          current_params: currentParams,
        })
        console.log('[datasource] on_change response for param:', paramName, '| updates:', updates)

        // Collect enrichments and prefills outside any state setter
        const enrichmentUpdates: Record<string, Partial<EnrichedParameterOut>> = {}
        for (const [name, enrichment] of Object.entries(updates)) {
          if (typeof enrichment === 'object' && enrichment !== null) {
            enrichmentUpdates[name] = enrichment as Partial<EnrichedParameterOut>
          }
        }

        // Step 1: sync prefill values into RHF _formValues BEFORE triggering the React
        // re-render. This ensures that when TextWidget remounts (due to key change on
        // param.prefill), RHF's ref-callback reads the already-updated value and sets the
        // input correctly — rather than restoring the stale empty value.
        for (const [name, e] of Object.entries(enrichmentUpdates)) {
          if (e.prefill !== undefined) {
            setValue(name, e.prefill, { shouldDirty: false, shouldValidate: false })
          }
        }

        // Step 2: trigger the React re-render that makes param.prefill visible to widgets
        setEnrichmentOverrides((prev) => {
          const next = { ...prev }
          for (const [name, e] of Object.entries(enrichmentUpdates)) {
            next[name] = { ...next[name], ...e }
          }
          return next
        })
      } catch (err) {
        console.warn('[datasource] on_change error for param:', paramName, err)
      } finally {
        setLoadingFields((prev) => {
          const next = new Set(prev)
          next.delete(paramName)
          return next
        })
      }
    },
    [templateId, effectiveParams, getValues, setValue],
  )

  useEffect(() => {
    const subscription = watch((_, { name: fieldName }) => {
      if (!fieldName) return
      const param = definition.parameters.find((p) => p.name === fieldName)
      if (!param) return
      if (param.readonly || param.is_derived) return

      const isInstant = ['select', 'multiselect', 'checkbox'].includes(param.widget_type)

      if (isInstant) {
        triggerOnChange(fieldName)
      } else {
        clearTimeout(debounceTimers.current[fieldName])
        debounceTimers.current[fieldName] = setTimeout(() => {
          triggerOnChange(fieldName)
        }, 500)
      }
    })
    return () => subscription.unsubscribe()
  }, [watch, definition.parameters, triggerOnChange])

  const renderMut = useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      renderTemplate(
        templateId,
        { params, feature_ids: [...enabledFeatureIds] },
        { persist, user },
      ),
    onSuccess: (result) => setRenderResult(result),
  })

  function onSubmit(_rhfValues: Record<string, unknown>) {
    // RHF's handleSubmit callback has a mixed literal+nested key problem for dotted names
    // (e.g. 'proj.hostname' initialised as literal '' AND nested { proj: { hostname: 'val' } }).
    // Read each param individually via getValues(name) which correctly resolves the nested path.
    const paramValues: Record<string, unknown> = {}
    for (const p of effectiveParams) {
      paramValues[p.name] = getValues(p.name as never)
    }

    const filteredValues: Record<string, unknown> = {}
    for (const p of effectiveParams) {
      if (isVisible(p, paramValues)) {
        filteredValues[p.name] = paramValues[p.name]
      }
    }
    // Also include values for enabled feature parameters
    for (const f of (definition.features ?? [])) {
      if (!enabledFeatureIds.has(f.id)) continue
      for (const fp of f.parameters) {
        filteredValues[fp.name] = getValues(fp.name as never)
      }
    }
    renderMut.mutate(filteredValues)
  }

  const currentValues = watch() as Record<string, unknown>

  // Pre-compute visibility for all params
  const paramVisibility: Record<string, boolean> = {}
  for (const p of effectiveParams) {
    paramVisibility[p.name] = isVisible(p, currentValues)
  }

  return (
    <div className="space-y-5">
      <InheritanceChain chain={definition.inheritance_chain} />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {sections.map((section) => {
          const visibleCount = section.params.filter((p) => paramVisibility[p.name] !== false).length
          return (
            <ParameterSection
              key={section.title}
              title={section.title}
              accent={section.accent}
              params={section.params}
              visibleCount={visibleCount}
              initialOpen={section.initialOpen}
              register={register}
              control={control}
              errors={errors}
              currentValues={currentValues}
              loadingFields={loadingFields}
              paramVisibility={paramVisibility}
            />
          )
        })}

        {/* Feature toggle cards */}
        {(definition.features ?? []).length > 0 && (
          <FeaturesSection
            features={definition.features ?? []}
            enabledIds={enabledFeatureIds}
            onToggle={toggleFeature}
            register={register}
            getValues={getValues}
          />
        )}

        {renderMut.error && (
          <div
            className="rounded-lg px-4 py-3 border text-sm text-red-400"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }}
          >
            Render failed:{' '}
            {(() => {
              const err = renderMut.error as { response?: { data?: { detail?: unknown } }; message?: string }
              const detail = err?.response?.data?.detail
              if (typeof detail === 'string') return detail
              if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? JSON.stringify(d)).join('; ')
              return err?.message ?? 'Unknown error'
            })()}
          </div>
        )}

        <div className="flex items-center gap-3 pt-4">
          <button
            type="submit"
            disabled={renderMut.isPending}
            className="px-6 py-2.5 text-sm font-semibold text-white rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: renderMut.isPending ? 'none' : '0 4px 14px rgba(99,102,241,0.3)',
            }}
          >
            {renderMut.isPending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Rendering…
              </span>
            ) : (
              'Render'
            )}
          </button>

          {renderResult && (
            <span className="text-xs" style={{ color: 'var(--c-muted-4)' }}>
              Last render: {new Date().toLocaleTimeString()}
            </span>
          )}
        </div>
      </form>

      {renderResult && <RenderOutput result={renderResult} />}
    </div>
  )
}
