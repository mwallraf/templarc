import { Controller } from 'react-hook-form'
import type { UseFormRegister, Control } from 'react-hook-form'
import type { EnrichedParameterOut } from '../../api/types'

// Filtered options for select fields — only show where condition matches current form values
export function filterOptions(
  param: EnrichedParameterOut,
  currentValues: Record<string, unknown>,
) {
  return (param.options ?? []).filter((opt) => {
    if (!opt.condition_param) return true
    return String(currentValues[opt.condition_param] ?? '') === String(opt.condition_value ?? '')
  })
}

const inputClass =
  'w-full rounded-lg px-3 py-2.5 text-sm text-slate-100 border transition-colors duration-150 focus:outline-none placeholder:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed'

const inputStyle = {
  backgroundColor: 'var(--c-card)',
  borderColor: 'var(--c-border-bright)',
}

function applyFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = '#6366f1'
  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)'
}

function removeFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.borderColor = 'var(--c-border-bright)'
  e.currentTarget.style.boxShadow = 'none'
}

// ── Text ─────────────────────────────────────────────────────────────────────

interface TextWidgetProps {
  param: EnrichedParameterOut
  register: UseFormRegister<Record<string, unknown>>
}

export function TextWidget({ param, register }: TextWidgetProps) {
  return (
    <input
      type="text"
      className={inputClass}
      style={inputStyle}
      placeholder={param.default_value ?? ''}
      onFocus={applyFocus}
      onBlur={removeFocus}
      {...register(param.name, {
        required: param.required ? `${param.label ?? param.name} is required` : false,
        pattern: param.validation_regex
          ? { value: new RegExp(param.validation_regex), message: 'Invalid format' }
          : undefined,
      })}
    />
  )
}

// ── Number ────────────────────────────────────────────────────────────────────

export function NumberWidget({ param, register }: TextWidgetProps) {
  return (
    <input
      type="number"
      className={inputClass}
      style={inputStyle}
      placeholder={param.default_value ?? ''}
      onFocus={applyFocus}
      onBlur={removeFocus}
      {...register(param.name, {
        required: param.required ? `${param.label ?? param.name} is required` : false,
        valueAsNumber: true,
      })}
    />
  )
}

// ── Password ──────────────────────────────────────────────────────────────────

export function PasswordWidget({ param, register }: TextWidgetProps) {
  return (
    <input
      type="password"
      className={inputClass}
      style={inputStyle}
      autoComplete="off"
      onFocus={applyFocus}
      onBlur={removeFocus}
      {...register(param.name, {
        required: param.required ? `${param.label ?? param.name} is required` : false,
      })}
    />
  )
}

// ── Textarea ──────────────────────────────────────────────────────────────────

export function TextareaWidget({ param, register }: TextWidgetProps) {
  return (
    <textarea
      rows={4}
      className={inputClass}
      style={inputStyle}
      placeholder={param.default_value ?? ''}
      onFocus={applyFocus}
      onBlur={removeFocus}
      {...register(param.name, {
        required: param.required ? `${param.label ?? param.name} is required` : false,
      })}
    />
  )
}

// ── Select ────────────────────────────────────────────────────────────────────

interface SelectWidgetProps {
  param: EnrichedParameterOut
  register: UseFormRegister<Record<string, unknown>>
  currentValues: Record<string, unknown>
}

export function SelectWidget({ param, register, currentValues }: SelectWidgetProps) {
  const opts = filterOptions(param, currentValues)
  return (
    <select
      className={inputClass}
      style={{ ...inputStyle, color: 'var(--c-text)' }}
      onFocus={applyFocus}
      onBlur={removeFocus}
      {...register(param.name, {
        required: param.required ? `${param.label ?? param.name} is required` : false,
      })}
    >
      <option value="" style={{ backgroundColor: 'var(--c-card)' }}>— select —</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value} style={{ backgroundColor: 'var(--c-card)' }}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ── Multiselect (checkboxes) ──────────────────────────────────────────────────

interface MultiSelectWidgetProps {
  param: EnrichedParameterOut
  control: Control<Record<string, unknown>>
  currentValues: Record<string, unknown>
}

export function MultiSelectWidget({ param, control, currentValues }: MultiSelectWidgetProps) {
  const opts = filterOptions(param, currentValues)
  return (
    <Controller
      name={param.name}
      control={control}
      rules={{
        validate: (v) => {
          if (!param.required) return true
          return Array.isArray(v) && v.length > 0
            ? true
            : `${param.label ?? param.name} is required`
        },
      }}
      defaultValue={[]}
      render={({ field }) => {
        const selected: string[] = Array.isArray(field.value) ? (field.value as string[]) : []
        function toggle(val: string) {
          const next = selected.includes(val)
            ? selected.filter((v) => v !== val)
            : [...selected, val]
          field.onChange(next)
        }
        return (
          <div className="space-y-2">
            {opts.map((o) => (
              <label key={o.value} className="flex items-center gap-2.5 text-sm cursor-pointer group">
                <span
                  className="w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-all duration-150"
                  style={{
                    backgroundColor: selected.includes(o.value) ? '#6366f1' : 'var(--c-card)',
                    borderColor: selected.includes(o.value) ? '#6366f1' : 'var(--c-border-bright)',
                  }}
                >
                  {selected.includes(o.value) && (
                    <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
                      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span className="text-slate-300 group-hover:text-slate-100 transition-colors">{o.label}</span>
              </label>
            ))}
            {opts.length === 0 && (
              <p className="text-xs italic" style={{ color: 'var(--c-muted-4)' }}>No options available</p>
            )}
          </div>
        )
      }}
    />
  )
}

// ── Checkbox (boolean) ─────────────────────────────────────────────────────────

export function CheckboxWidget({ param, register }: TextWidgetProps) {
  return (
    <label className="flex items-center gap-2.5 text-sm cursor-pointer group">
      <input type="checkbox" className="sr-only" {...register(param.name)} />
      <span className="text-slate-300 group-hover:text-slate-100 transition-colors">
        {param.label ?? param.name}
      </span>
    </label>
  )
}

// ── Readonly ──────────────────────────────────────────────────────────────────

interface ReadonlyWidgetProps {
  value: unknown
}

export function ReadonlyWidget({ value }: ReadonlyWidgetProps) {
  return (
    <input
      type="text"
      disabled
      value={value === undefined || value === null ? '' : String(value)}
      className={inputClass}
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', color: 'var(--c-muted-3)' }}
    />
  )
}
