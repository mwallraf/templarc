import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDraggable } from '@dnd-kit/core'
import { listParameters } from '../../api/parameters'
import { listTemplates } from '../../api/templates'
import { getInheritanceChain } from '../../api/templates'
import type { ParameterOut, TemplateOut } from '../../api/types'
import type { DataSourceDef } from './DataSourceForm'
import { DataSourceForm, DataSourceItem } from './DataSourceForm'
import type { SecretOut } from '../../api/types'

// ── Draggable parameter chip ───────────────────────────────────────────────

function DraggableParam({ param }: { param: ParameterOut }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `param-${param.id}`,
    data: { paramName: param.name, paramId: param.id },
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-xs cursor-grab select-none transition-opacity ${
        isDragging
          ? 'opacity-40 border-indigo-400 bg-indigo-50'
          : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50'
      }`}
    >
      <div className="min-w-0">
        <span className="font-mono text-gray-700">{param.name}</span>
        {param.label && <span className="ml-1.5 text-gray-400">{param.label}</span>}
      </div>
      <span className="shrink-0 text-gray-300 text-base">⠿</span>
    </div>
  )
}

// ── Template parameters list (currently assigned) ─────────────────────────

interface AssignedParamProps {
  param: ParameterOut
  onRemove: () => void
}

function AssignedParam({ param, onRemove }: AssignedParamProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `assigned-${param.id}`,
    data: { paramName: param.name, paramId: param.id },
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-xs cursor-grab select-none ${
        isDragging ? 'opacity-40' : 'border-indigo-100 bg-indigo-50'
      }`}
    >
      <div className="min-w-0">
        <span className="font-mono text-indigo-700 font-medium">{param.name}</span>
        <span className="ml-1.5 text-xs text-gray-400">{param.widget_type}</span>
      </div>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        className="shrink-0 text-gray-400 hover:text-red-500 leading-none text-base"
      >
        ×
      </button>
    </div>
  )
}

// ── Inheritance chain display ─────────────────────────────────────────────

function InheritancePreview({ templateId }: { templateId: number }) {
  const { data: chain, isLoading } = useQuery({
    queryKey: ['inheritance-chain', templateId],
    queryFn: () => getInheritanceChain(templateId),
    enabled: !!templateId,
  })

  if (isLoading) return <p className="text-xs text-gray-400">Loading chain…</p>
  if (!chain || chain.length === 0) return null

  return (
    <div className="flex items-center gap-1 flex-wrap mt-1.5">
      {chain.map((item, i) => (
        <span key={item.id} className="flex items-center gap-1 text-xs">
          {i > 0 && <span className="text-gray-300">›</span>}
          <span
            className={
              i === chain.length - 1
                ? 'font-semibold text-indigo-700'
                : 'text-gray-500'
            }
          >
            {item.display_name}
          </span>
        </span>
      ))}
    </div>
  )
}

// ── Main ParameterPanel ───────────────────────────────────────────────────

export interface ParameterPanelProps {
  templateId: number
  projectId: number
  secrets: SecretOut[]
  assignedParams: ParameterOut[]
  dataSources: DataSourceDef[]
  parentTemplateId?: number
  // Metadata
  metaDisplayName: string
  metaDescription: string
  metaSortOrder: number
  onChangeDisplayName: (v: string) => void
  onChangeDescription: (v: string) => void
  onChangeSortOrder: (v: number) => void
  onAssignParam: (param: ParameterOut) => void
  onUnassignParam: (paramId: number) => void
  onSetParent: (templateId: number | undefined) => void
  onAddDataSource: (ds: DataSourceDef) => void
  onRemoveDataSource: (id: string) => void
  onUpdateDataSource: (id: string, ds: DataSourceDef) => void
}

export function ParameterPanel({
  templateId,
  projectId,
  secrets,
  assignedParams,
  dataSources,
  parentTemplateId,
  metaDisplayName,
  metaDescription,
  metaSortOrder,
  onChangeDisplayName,
  onChangeDescription,
  onChangeSortOrder,
  onAssignParam,
  onUnassignParam,
  onSetParent,
  onAddDataSource,
  onRemoveDataSource,
  onUpdateDataSource,
}: ParameterPanelProps) {
  const [search, setSearch] = useState('')
  const [showDsForm, setShowDsForm] = useState(false)
  const [editingDs, setEditingDs] = useState<DataSourceDef | null>(null)
  const [activeSection, setActiveSection] = useState<'params' | 'datasources' | 'parent' | 'metadata'>('params')

  // Search all parameters in the registry
  const { data: searchResults } = useQuery({
    queryKey: ['parameters', 'search', search],
    queryFn: () => listParameters({ search: search || undefined, page_size: 20 }),
    enabled: search.length >= 1,
  })

  // All templates in this project (for parent selector)
  const { data: projectTemplates } = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => listTemplates({ project_id: projectId, active_only: false }),
    enabled: !!projectId,
  })

  const assignedIds = new Set(assignedParams.map((p) => p.id))
  const filteredResults = (searchResults?.items ?? []).filter((p) => !assignedIds.has(p.id))

  function handleAddDs(ds: DataSourceDef) {
    if (editingDs) {
      onUpdateDataSource(editingDs.id, ds)
      setEditingDs(null)
    } else {
      onAddDataSource(ds)
    }
    setShowDsForm(false)
  }

  const siblingsAndAncestors: TemplateOut[] = (projectTemplates ?? []).filter(
    (t) => t.id !== templateId,
  )

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200">
      {/* Section tabs */}
      <div className="flex border-b border-gray-200 shrink-0">
        {(
          [
            { key: 'params', label: 'Parameters' },
            { key: 'datasources', label: 'Data Sources' },
            { key: 'parent', label: 'Parent' },
            { key: 'metadata', label: 'Metadata' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              activeSection === key
                ? 'border-b-2 border-indigo-600 text-indigo-700 bg-indigo-50/50'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
            {key === 'params' && assignedParams.length > 0 && (
              <span className="ml-1 bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full text-xs">
                {assignedParams.length}
              </span>
            )}
            {key === 'datasources' && dataSources.length > 0 && (
              <span className="ml-1 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full text-xs">
                {dataSources.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* ── Parameters section ────────────────────────────────────────── */}
        {activeSection === 'params' && (
          <>
            {/* Assigned */}
            {assignedParams.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  In this template
                </p>
                <div className="space-y-1.5">
                  {assignedParams.map((p) => (
                    <AssignedParam
                      key={p.id}
                      param={p}
                      onRemove={() => onUnassignParam(p.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Registry search */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Parameter registry
              </p>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search parameters…"
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
              />
              {search && (
                <div className="space-y-1.5">
                  {filteredResults.length === 0 ? (
                    <p className="text-xs text-gray-400 italic text-center py-2">
                      No parameters found
                    </p>
                  ) : (
                    filteredResults.map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5">
                        <div className="flex-1 min-w-0">
                          <DraggableParam param={p} />
                        </div>
                        <button
                          type="button"
                          onClick={() => onAssignParam(p)}
                          className="shrink-0 text-xs text-indigo-600 hover:text-indigo-800 px-1.5 py-1 rounded hover:bg-indigo-50"
                          title="Add to template"
                        >
                          +
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {!search && (
                <p className="text-xs text-gray-400 italic text-center py-4">
                  Type to search parameters. Drag into editor to insert{' '}
                  <code className="bg-gray-100 px-1 rounded">{'{{ name }}'}</code>
                </p>
              )}
            </div>
          </>
        )}

        {/* ── Data sources section ────────────────────────────────────── */}
        {activeSection === 'datasources' && (
          <>
            {dataSources.length === 0 && !showDsForm && (
              <p className="text-xs text-gray-400 italic text-center py-4">
                No data sources configured
              </p>
            )}

            <div className="space-y-2">
              {dataSources.map((ds) =>
                editingDs?.id === ds.id ? (
                  <DataSourceForm
                    key={ds.id}
                    secrets={secrets}
                    initial={ds}
                    onAdd={handleAddDs}
                    onCancel={() => {
                      setEditingDs(null)
                      setShowDsForm(false)
                    }}
                  />
                ) : (
                  <DataSourceItem
                    key={ds.id}
                    ds={ds}
                    onRemove={() => onRemoveDataSource(ds.id)}
                    onEdit={() => {
                      setEditingDs(ds)
                      setShowDsForm(false)
                    }}
                  />
                ),
              )}
            </div>

            {showDsForm && !editingDs && (
              <DataSourceForm
                secrets={secrets}
                onAdd={handleAddDs}
                onCancel={() => setShowDsForm(false)}
              />
            )}

            {!showDsForm && !editingDs && (
              <button
                onClick={() => setShowDsForm(true)}
                className="w-full py-2 border-2 border-dashed border-gray-300 text-xs text-gray-500 rounded-lg hover:border-indigo-400 hover:text-indigo-600 transition-colors"
              >
                + Add data source
              </button>
            )}
          </>
        )}

        {/* ── Metadata section ────────────────────────────────────────── */}
        {activeSection === 'metadata' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              These fields are saved to the database when you click <strong>Save</strong>. They
              are also written as frontmatter comments into the <code>.j2</code> file for
              reference.
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Display name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={metaDisplayName}
                onChange={(e) => onChangeDisplayName(e.target.value)}
                placeholder="Human-readable template name"
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-400">Shown in the template catalog and admin lists.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
              <textarea
                value={metaDescription}
                onChange={(e) => onChangeDescription(e.target.value)}
                placeholder="Optional description of what this template generates"
                rows={4}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Sort order</label>
              <input
                type="number"
                value={metaSortOrder}
                onChange={(e) => onChangeSortOrder(Number(e.target.value))}
                min={0}
                step={10}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Controls the order within its parent group (lower = first).
              </p>
            </div>
          </div>
        )}

        {/* ── Parent template section ─────────────────────────────────── */}
        {activeSection === 'parent' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Parent template
              </label>
              <select
                value={parentTemplateId ?? ''}
                onChange={(e) =>
                  onSetParent(e.target.value ? Number(e.target.value) : undefined)
                }
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">No parent (root template)</option>
                {siblingsAndAncestors.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </div>

            {parentTemplateId && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Inheritance chain</p>
                <InheritancePreview templateId={parentTemplateId} />
              </div>
            )}

            {!parentTemplateId && (
              <p className="text-xs text-gray-400 italic">
                This template will be at the root of the hierarchy.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
