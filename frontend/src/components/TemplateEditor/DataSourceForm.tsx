import { useForm, useFieldArray } from 'react-hook-form'
import type { SecretOut } from '../../api/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MappingRow {
  remote_field: string
  to_parameter: string
  auto_fill: boolean
}

export interface DataSourceDef {
  id: string
  url: string
  auth?: string
  trigger?: string
  on_error?: 'warn' | 'fail' | 'skip'
  cache_ttl?: number
  mapping: MappingRow[]
}

// ── Add / Edit form ───────────────────────────────────────────────────────────

interface DataSourceFormProps {
  secrets: SecretOut[]
  onAdd: (ds: DataSourceDef) => void
  onCancel: () => void
  initial?: DataSourceDef
}

export function DataSourceForm({ secrets, onAdd, onCancel, initial }: DataSourceFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<DataSourceDef>({
    defaultValues: initial ?? {
      id: '',
      url: '',
      auth: '',
      trigger: '',
      on_error: 'warn',
      cache_ttl: 300,
      mapping: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'mapping' })

  return (
    <form
      onSubmit={handleSubmit(onAdd)}
      className="space-y-3 text-sm bg-gray-50 rounded-lg p-4 border border-gray-200"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            ID <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. netbox"
            {...register('id', { required: 'Required' })}
          />
          {errors.id && <p className="text-xs text-red-600 mt-0.5">{errors.id.message}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Trigger</label>
          <input
            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="on_change:router.hostname"
            {...register('trigger')}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          URL <span className="text-red-500">*</span>
        </label>
        <input
          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="https://api.example.com/endpoint?name={{ param_name }}"
          {...register('url', { required: 'Required' })}
        />
        {errors.url && <p className="text-xs text-red-600 mt-0.5">{errors.url.message}</p>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Auth secret</label>
          <select
            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            {...register('auth')}
          >
            <option value="">None</option>
            {secrets.map((s) => (
              <option key={s.id} value={`secret:${s.name}`}>
                {s.name} ({s.secret_type})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">On error</label>
          <select
            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            {...register('on_error')}
          >
            <option value="warn">warn</option>
            <option value="fail">fail</option>
            <option value="skip">skip</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Cache TTL (seconds)
        </label>
        <input
          type="number"
          className="w-32 border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          {...register('cache_ttl', { valueAsNumber: true })}
        />
      </div>

      {/* JSONPath mapping rows */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-600">Field mappings</label>
          <button
            type="button"
            onClick={() => append({ remote_field: '', to_parameter: '', auto_fill: false })}
            className="text-xs text-indigo-600 hover:underline"
          >
            + Add mapping
          </button>
        </div>

        {fields.map((field, idx) => (
          <div key={field.id} className="flex items-center gap-2 mb-2">
            <input
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="results[0].site.id"
              {...register(`mapping.${idx}.remote_field`)}
            />
            <span className="text-gray-400 text-xs shrink-0">→</span>
            <input
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="router.site_id"
              {...register(`mapping.${idx}.to_parameter`)}
            />
            <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0">
              <input type="checkbox" {...register(`mapping.${idx}.auto_fill`)} />
              auto
            </label>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="text-red-400 hover:text-red-600 shrink-0 text-base leading-none"
            >
              ×
            </button>
          </div>
        ))}

        {fields.length === 0 && (
          <p className="text-xs text-gray-400 italic">No mappings defined</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 transition-colors"
        >
          {initial ? 'Update' : 'Add'} data source
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── List item ─────────────────────────────────────────────────────────────────

interface DataSourceItemProps {
  ds: DataSourceDef
  onRemove: () => void
  onEdit: () => void
}

export function DataSourceItem({ ds, onRemove, onEdit }: DataSourceItemProps) {
  return (
    <div className="flex items-start justify-between gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100 text-xs">
      <div className="min-w-0">
        <p className="font-mono font-semibold text-blue-800">{ds.id}</p>
        <p className="text-gray-500 truncate mt-0.5">{ds.url}</p>
        {ds.trigger && (
          <p className="text-blue-600 mt-0.5">
            trigger: <span className="font-mono">{ds.trigger}</span>
          </p>
        )}
        {ds.mapping.length > 0 && (
          <p className="text-gray-400 mt-0.5">{ds.mapping.length} mapping(s)</p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <button onClick={onEdit} className="text-gray-400 hover:text-gray-600">
          Edit
        </button>
        <button onClick={onRemove} className="text-red-400 hover:text-red-600">
          ×
        </button>
      </div>
    </div>
  )
}
