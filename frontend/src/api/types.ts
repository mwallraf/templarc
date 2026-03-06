// ── Enums ──────────────────────────────────────────────────────────────────

export type ParameterScope = 'global' | 'project' | 'template'

export type WidgetType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'number'
  | 'password'
  | 'readonly'

export type SecretType = 'env' | 'vault' | 'db'

// ── Catalog ────────────────────────────────────────────────────────────────

export interface ProjectOut {
  id: number
  organization_id: number
  name: string
  display_name: string
  description?: string
  git_path?: string
  output_comment_style: string
  created_at: string
  updated_at: string
}

export interface ProjectCreate {
  organization_id: number
  name: string
  display_name: string
  description?: string
  git_path?: string
  output_comment_style?: string
}

export interface ProjectUpdate {
  display_name?: string
  description?: string
  git_path?: string
  output_comment_style?: string
}

export interface TemplateTreeNode {
  id: number
  name: string
  display_name: string
  is_active: boolean
  sort_order: number
  children: TemplateTreeNode[]
}

export interface ProjectDetailOut extends ProjectOut {
  templates: TemplateTreeNode[]
}

export interface CatalogProjectOut {
  id: number
  name: string
  display_name: string
  description?: string
}

export interface CatalogTemplateItem {
  id: number
  name: string
  display_name: string
  description?: string
  breadcrumb: string[]
  parameter_count: number
  has_remote_datasources: boolean
  is_leaf: boolean
}

export interface CatalogResponse {
  project: CatalogProjectOut
  templates: CatalogTemplateItem[]
}

// ── Templates ──────────────────────────────────────────────────────────────

export interface TemplateOut {
  id: number
  project_id: number
  name: string
  display_name: string
  description?: string
  git_path?: string
  parent_template_id?: number
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TemplateCreate {
  project_id: number
  name: string
  display_name: string
  description?: string
  parent_template_id?: number
  sort_order?: number
  content?: string
  author?: string
}

export interface TemplateUpdate {
  display_name?: string
  description?: string
  sort_order?: number
  parent_template_id?: number | null
  content?: string
  commit_message?: string
  author?: string
}

export interface VariableRefOut {
  name: string
  type: 'simple' | 'attribute'
  full_path: string
  is_registered: boolean
}

export interface TemplateUpdateOut {
  template: TemplateOut
  suggested_parameters: VariableRefOut[]
}

export interface TemplateUploadOut {
  template: TemplateOut
  parameters_registered: number
  suggested_parameters: VariableRefOut[]
}

export interface InheritanceChainItem {
  id: number
  name: string
  display_name: string
  git_path?: string
  description?: string
}

// ── Parameters ─────────────────────────────────────────────────────────────

export interface ParameterOptionOut {
  id: number
  parameter_id: number
  value: string
  label: string
  condition_param?: string
  condition_value?: string
  sort_order: number
}

export interface ParameterOut {
  id: number
  name: string
  scope: ParameterScope
  organization_id?: number
  project_id?: number
  template_id?: number
  widget_type: WidgetType
  label?: string
  description?: string
  help_text?: string
  default_value?: string
  required: boolean
  validation_regex?: string
  is_derived: boolean
  derived_expression?: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  options: ParameterOptionOut[]
}

export interface ParameterCreate {
  name: string
  scope: ParameterScope
  organization_id?: number
  project_id?: number
  template_id?: number
  widget_type?: WidgetType
  label?: string
  description?: string
  help_text?: string
  default_value?: string
  required?: boolean
  validation_regex?: string
  is_derived?: boolean
  derived_expression?: string
  sort_order?: number
}

export interface ParameterUpdate {
  widget_type?: WidgetType
  label?: string
  description?: string
  help_text?: string
  default_value?: string
  required?: boolean
  validation_regex?: string
  is_derived?: boolean
  derived_expression?: string
  sort_order?: number
}

export interface ParameterOptionCreate {
  value: string
  label: string
  condition_param?: string
  condition_value?: string
  sort_order?: number
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

// ── Render ─────────────────────────────────────────────────────────────────

export interface EnrichedParameterOut {
  name: string
  scope: string
  widget_type: string
  label?: string
  description?: string
  help_text?: string
  default_value?: string
  required: boolean
  sort_order: number
  is_derived: boolean
  validation_regex?: string
  prefill?: unknown
  options?: { value: string; label: string; condition_param?: string; condition_value?: string }[]
  readonly?: boolean
  source_id?: string
}

export interface FormDefinitionOut {
  template_id: number
  parameters: EnrichedParameterOut[]
  inheritance_chain: string[]
}

export interface RenderRequest {
  params?: Record<string, unknown>
  notes?: string
}

export interface RenderOut {
  output: string
  render_id?: number
  template_id: number
  git_sha: string
}

export interface OnChangeRequest {
  current_params?: Record<string, unknown>
}

export interface RenderHistoryOut {
  id: number
  template_id?: number
  template_git_sha: string
  resolved_parameters: Record<string, unknown>
  raw_output: string
  rendered_by?: number
  rendered_at: string
  notes?: string
}

export interface RenderHistoryListOut {
  items: RenderHistoryOut[]
  total: number
}

export interface ReRenderRequest {
  template_id?: number
  notes?: string
  persist?: boolean
}

// ── Auth / Me (profile) ────────────────────────────────────────────────────

export interface MeOut {
  username: string
  org_id: number
  is_admin: boolean
  email?: string
  is_ldap: boolean
  last_login?: string
  created_at?: string
}

export interface MeUpdate {
  email?: string
  current_password?: string
  new_password?: string
}

// ── Auth / Users ───────────────────────────────────────────────────────────

export interface UserOut {
  id: number
  username: string
  email: string
  is_admin: boolean
  is_ldap: boolean
  organization_id: number
  last_login?: string
  created_at: string
}

export interface UserCreate {
  username: string
  email: string
  password: string
  is_admin?: boolean
}

export interface UserUpdate {
  is_admin?: boolean
  password?: string
}

// ── Auth / Secrets ─────────────────────────────────────────────────────────

export interface SecretCreate {
  name: string
  secret_type: SecretType
  value?: string
  vault_path?: string
  description?: string
}

export interface SecretOut {
  id: number
  organization_id: number
  name: string
  secret_type: SecretType
  vault_path?: string
  description?: string
  created_at: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

// ── Custom Filters & Objects ────────────────────────────────────────────────

export type FilterScope = 'global' | 'project'

export interface CustomFilterCreate {
  name: string
  code: string
  description?: string
  scope: FilterScope
  project_id?: number
}

export interface CustomFilterOut {
  id: number
  name: string
  code: string
  description?: string
  scope: FilterScope
  project_id?: number
  is_active: boolean
  created_at: string
  created_by?: string
}

export interface FilterTestRequest {
  code: string
  test_input?: string
}

export interface FilterTestResult {
  ok: boolean
  output?: string
  error?: string
}

export interface CustomObjectCreate {
  name: string
  code: string
  description?: string
  project_id?: number
}

export interface CustomObjectOut {
  id: number
  name: string
  code: string
  description?: string
  project_id?: number
  is_active: boolean
  created_at: string
  created_by?: string
}

// ── Admin ──────────────────────────────────────────────────────────────────

export interface SyncErrorItem {
  git_path: string
  error: string
}

export interface SyncImportedTemplate {
  id: number
  name: string
  git_path: string
}

export interface SyncReport {
  scanned: number
  imported: number
  already_registered: number
  skipped_fragments: number
  errors: SyncErrorItem[]
  imported_templates: SyncImportedTemplate[]
}

export interface SyncStatusItem {
  git_path: string
  status: 'in_sync' | 'in_db_only' | 'in_git_only' | 'fragment'
}

export interface SyncStatusReport {
  in_sync: number
  in_db_only: number
  in_git_only: number
  skipped_fragments: number
  items: SyncStatusItem[]
}
