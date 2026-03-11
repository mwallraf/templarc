import type { UseFormRegister, Control, FieldErrors } from 'react-hook-form'
import type { EnrichedParameterOut } from '../../api/types'
import {
  TextWidget,
  NumberWidget,
  PasswordWidget,
  TextareaWidget,
  SelectWidget,
  MultiSelectWidget,
  CheckboxWidget,
  ReadonlyWidget,
} from './widgets'

interface ParameterFieldProps {
  param: EnrichedParameterOut
  register: UseFormRegister<Record<string, unknown>>
  control: Control<Record<string, unknown>>
  errors: FieldErrors<Record<string, unknown>>
  currentValues: Record<string, unknown>
  isLoading?: boolean
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ color: '#6366f1' }}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

const SCOPE_BADGE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  global: {
    bg: 'rgba(251,191,36,0.1)',
    text: '#fbbf24',
    border: 'rgba(251,191,36,0.2)',
    label: 'global',
  },
  project: {
    bg: 'rgba(96,165,250,0.1)',
    text: '#60a5fa',
    border: 'rgba(96,165,250,0.2)',
    label: 'project',
  },
  template: {
    bg: 'rgba(148,163,184,0.08)',
    text: '#64748b',
    border: 'rgba(148,163,184,0.15)',
    label: 'template',
  },
}

export function ParameterField({
  param,
  register,
  control,
  errors,
  currentValues,
  isLoading,
}: ParameterFieldProps) {
  const error = errors[param.name]
  const isReadonly = param.readonly || param.is_derived

  function renderWidget() {
    if (isReadonly) {
      // Use || rather than ?? so that empty string '' also falls through to prefill
      const displayValue = currentValues[param.name] || param.prefill || param.default_value
      return <ReadonlyWidget value={displayValue} />
    }

    switch (param.widget_type) {
      case 'number':
        return <NumberWidget param={param} register={register} />
      case 'password':
        return <PasswordWidget param={param} register={register} />
      case 'textarea':
        return <TextareaWidget param={param} register={register} />
      case 'select':
        return <SelectWidget param={param} register={register} currentValues={currentValues} />
      case 'multiselect':
        return <MultiSelectWidget param={param} control={control} currentValues={currentValues} />
      case 'checkbox':
        return <CheckboxWidget param={param} register={register} />
      default:
        return <TextWidget param={param} register={register} />
    }
  }

  if (param.widget_type === 'hidden') {
    return (
      <input
        type="hidden"
        {...register(param.name)}
        defaultValue={String(param.default_value ?? param.prefill ?? '')}
      />
    )
  }

  const labelText = param.label ?? param.name
  const scopeStyle = SCOPE_BADGE[param.scope] ?? SCOPE_BADGE.template

  return (
    <div className="space-y-1.5">
      {/* Label row */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium" style={{ color: 'var(--c-muted-1)' }}>
          {labelText}
          {param.required && !isReadonly && (
            <span className="ml-0.5 text-red-400" title="Required">*</span>
          )}
        </label>

        {isLoading && <LoadingSpinner />}

        {isReadonly && (
          <span className="text-xs italic" style={{ color: 'var(--c-muted-4)' }}>
            {param.is_derived ? 'derived' : 'auto-filled'}
          </span>
        )}

        <span
          className="ml-auto text-xs px-2 py-0.5 rounded-full border font-medium"
          style={{
            backgroundColor: scopeStyle.bg,
            color: scopeStyle.text,
            borderColor: scopeStyle.border,
          }}
        >
          {scopeStyle.label}
        </span>
      </div>

      {/* Help text */}
      {param.help_text && (
        <p className="text-xs" style={{ color: 'var(--c-muted-4)' }}>{param.help_text}</p>
      )}

      {/* Widget */}
      <div className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
        {renderWidget()}
      </div>

      {/* Validation error */}
      {error && (
        <p className="text-xs text-red-400">{error.message as string}</p>
      )}
    </div>
  )
}
