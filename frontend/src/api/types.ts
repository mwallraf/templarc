// ── Enums ──────────────────────────────────────────────────────────────────

export type ParameterScope = 'global' | 'project' | 'template' | 'feature'

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
  id: string
  organization_id: string
  name: string
  display_name: string
  description?: string
  git_path?: string
  output_comment_style: string
  remote_url?: string
  remote_branch: string
  remote_credential_ref?: string
  created_at: string
  updated_at: string
}

export interface ProjectCreate {
  organization_id: string
  name: string
  display_name: string
  description?: string
  git_path?: string
  output_comment_style?: string
  remote_url?: string
  remote_branch?: string
  remote_credential_ref?: string
}

export interface ProjectUpdate {
  display_name?: string
  description?: string
  git_path?: string
  output_comment_style?: string
  remote_url?: string
  remote_branch?: string
  remote_credential_ref?: string
}

export type GitRemoteStatus =
  | 'no_remote'
  | 'not_cloned'
  | 'in_sync'
  | 'ahead'
  | 'behind'
  | 'diverged'
  | 'error'

export interface GitRemoteStatusOut {
  has_remote: boolean
  remote_url?: string
  remote_branch: string
  local_sha?: string
  remote_sha?: string
  ahead: number
  behind: number
  status: GitRemoteStatus
  message?: string
}

export interface GitRemoteActionOut {
  success: boolean
  message: string
  new_sha?: string
}

export interface GitRemoteTestOut {
  success: boolean
  message: string
  branch_sha?: string
}

export interface TemplateTreeNode {
  id: string
  name: string
  display_name: string
  git_path?: string
  is_active: boolean
  is_snippet: boolean
  is_hidden: boolean
  sort_order: number
  children: TemplateTreeNode[]
}

export interface ProjectDetailOut extends ProjectOut {
  templates: TemplateTreeNode[]
}

export interface CatalogProjectOut {
  id: string
  name: string
  display_name: string
  description?: string
}

export interface CatalogTemplateItem {
  id: string
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
  id: string
  project_id: string
  name: string
  display_name: string
  description?: string
  git_path?: string
  parent_template_id?: string
  is_active: boolean
  is_snippet: boolean
  is_hidden: boolean
  sort_order: number
  history_label_param?: string
  created_at: string
  updated_at: string
}

export interface TemplateCreate {
  project_id: string
  name: string
  display_name: string
  description?: string
  git_path?: string
  parent_template_id?: string
  sort_order?: number
  is_snippet?: boolean
  is_hidden?: boolean
  content?: string
  author?: string
}

export interface TemplateUpdate {
  display_name?: string
  description?: string
  sort_order?: number
  parent_template_id?: string | null
  content?: string
  commit_message?: string
  author?: string
  is_active?: boolean
  is_snippet?: boolean
  is_hidden?: boolean
  history_label_param?: string
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
  id: string
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
  organization_id?: string
  project_id?: string
  template_id?: string
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
  organization_id?: string
  project_id?: string
  template_id?: string
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

export interface VisibleWhenCondition {
  param: string
  op: 'eq' | 'ne' | 'in' | 'not_in'
  value: string | string[]
}

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
  section?: string
  visible_when?: VisibleWhenCondition
  prefill?: unknown
  options?: { value: string; label: string; condition_param?: string; condition_value?: string }[]
  readonly?: boolean
  source_id?: string
}

export interface RenderPresetOut {
  id: number
  template_id: string
  name: string
  description?: string
  params: Record<string, unknown>
  created_by?: number
  created_at: string
}

export interface RenderPresetCreate {
  name: string
  description?: string
  params: Record<string, unknown>
}

// ── Features ────────────────────────────────────────────────────────────────

export interface FeatureParamOut {
  name: string
  widget_type: string
  label?: string
  description?: string
  help_text?: string
  default_value?: string
  required: boolean
  sort_order: number
  options?: { value: string; label: string }[]
}

export interface AvailableFeatureOut {
  id: string
  name: string
  label: string
  description?: string
  is_default: boolean
  sort_order: number
  parameters: FeatureParamOut[]
}

export interface FeatureParameterOut {
  id: number
  name: string
  widget_type: string
  label?: string
  description?: string
  help_text?: string
  default_value?: string
  required: boolean
  sort_order: number
  is_active: boolean
  is_derived: boolean
  derived_expression?: string
  validation_regex?: string
  options: { value: string; label: string; sort_order: number }[]
}

export interface FeatureOut {
  id: string
  project_id: string
  name: string
  label: string
  description?: string
  snippet_path?: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  parameters: FeatureParameterOut[]
}

export interface FeatureListOut {
  items: FeatureOut[]
  total: number
}

export interface FeatureCreate {
  project_id: string
  name: string
  label: string
  description?: string
  sort_order?: number
}

export interface FeatureUpdate {
  label?: string
  description?: string
  sort_order?: number
  is_active?: boolean
}

export interface FeatureBodyUpdate {
  body: string
  commit_message?: string
  author?: string
}

export interface FeatureParameterCreate {
  name: string
  widget_type?: string
  label?: string
  description?: string
  help_text?: string
  default_value?: string
  required?: boolean
  sort_order?: number
}

export interface TemplateFeatureOut {
  id: string
  template_id: string
  feature_id: string
  is_default: boolean
  sort_order: number
  feature: FeatureOut
}

export interface TemplateFeatureUpdate {
  is_default?: boolean
  sort_order?: number
}

export interface FormDefinitionOut {
  template_id: string
  parameters: EnrichedParameterOut[]
  inheritance_chain: string[]
  features: AvailableFeatureOut[]
}

export interface RenderRequest {
  params?: Record<string, unknown>
  feature_ids?: number[]
  notes?: string
}

export interface RenderOut {
  output: string
  render_id?: string
  template_id: string
  git_sha: string
}

export interface OnChangeRequest {
  current_params?: Record<string, unknown>
}

export interface RenderHistoryOut {
  id: string
  template_id?: string
  template_git_sha: string
  resolved_parameters: Record<string, unknown>
  raw_output: string
  rendered_by?: number
  rendered_at: string
  notes?: string
  display_label?: string
  rendered_by_username?: string
}

export interface RenderHistoryListOut {
  items: RenderHistoryOut[]
  total: number
}

export interface ReRenderRequest {
  template_id?: string
  notes?: string
  persist?: boolean
}

// ── Auth / Me (profile) ────────────────────────────────────────────────────

export interface MeOut {
  username: string
  org_id: string
  org_role: string
  is_platform_admin: boolean
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
  id: string
  username: string
  email: string
  role: string
  is_platform_admin: boolean
  is_ldap: boolean
  organization_id: string
  last_login?: string
  created_at: string
}

export interface UserCreate {
  username: string
  email: string
  password: string
  role?: string
}

export interface UserUpdate {
  role?: string
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
  id: string
  organization_id: string
  name: string
  secret_type: SecretType
  vault_path?: string
  description?: string
  created_at: string
}

// ── Auth / API Keys ────────────────────────────────────────────────────────

export interface ApiKeyCreate {
  name: string
  role: string
  expires_at?: string | null
}

export interface ApiKeyOut {
  id: number
  name: string
  key_prefix: string
  role: string
  created_by: number | null
  last_used_at: string | null
  expires_at: string | null
  created_at: string
}

// ── Project Memberships ─────────────────────────────────────────────────────

export interface ProjectMembershipCreate {
  user_id: string
  role: string
}

export interface ProjectMembershipOut {
  id: string
  user_id: string
  project_id: string
  username: string
  email: string
  role: string
  created_at: string
}

export interface ProjectMembershipsListOut {
  items: ProjectMembershipOut[]
  total: number
}

export interface ApiKeyCreatedOut extends ApiKeyOut {
  raw_key: string
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

export interface CustomFilterUpdate {
  code: string
  description?: string
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
  scope: FilterScope
  project_id?: number
}

export interface CustomObjectOut {
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

export interface CustomObjectUpdate {
  code: string
  description?: string
}

export interface CustomMacroCreate {
  name: string
  body: string
  description?: string
  scope: FilterScope
  project_id?: number
}

export interface CustomMacroOut {
  id: number
  name: string
  body: string
  description?: string
  scope: FilterScope
  project_id?: number
  is_active: boolean
  created_at: string
  created_by?: string
}

export interface CustomMacroUpdate {
  body: string
  description?: string
}

// ── AI Settings ────────────────────────────────────────────────────────────

export interface AISettingsOut {
  provider: string  // "anthropic" | "openai" | "" (empty = disabled)
  model: string
  has_api_key: boolean
  api_key_source: string  // "db" | "env" | ""
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

export interface SyncDeletedTemplate {
  id: number
  name: string
  git_path: string
}

export interface GitSyncRequest {
  import_paths?: string[] | null
  delete_paths?: string[] | null
}

export interface SyncReport {
  scanned: number
  imported: number
  already_registered: number
  skipped_fragments: number
  deleted: number
  errors: SyncErrorItem[]
  imported_templates: SyncImportedTemplate[]
  deleted_templates: SyncDeletedTemplate[]
}

export interface SyncStatusItem {
  git_path: string
  status: 'in_sync' | 'in_db_only' | 'in_git_only' | 'fragment'
  template_name?: string
  template_id?: number
}

export interface SyncStatusReport {
  in_sync: number
  in_db_only: number
  in_git_only: number
  skipped_fragments: number
  items: SyncStatusItem[]
}

// ── Duplicate parameter detection ───────────────────────────────────────────

export interface DuplicateTemplateRef {
  param_id: number
  template_id: number
  template_name: string
  template_display_name: string
  widget_type: string
  label?: string
  required: boolean
}

export interface DuplicateParameterGroup {
  name: string
  project_id: number
  project_display_name: string
  count: number
  has_conflicts: boolean
  templates: DuplicateTemplateRef[]
}

export interface DuplicatesReport {
  groups: DuplicateParameterGroup[]
  total_duplicate_names: number
  total_redundant_params: number
}

export interface PromoteRequest {
  from_name: string
  to_name: string
  project_id: number
}

export interface PromoteTemplateRewrite {
  template_id: number
  template_name: string
  git_path?: string
  rewritten: boolean
  replacements: number
  error?: string
}

export interface PromoteReport {
  created_param_id: number
  deleted_param_ids: number[]
  templates_updated: number
  git_files_rewritten: number
  template_rewrites: PromoteTemplateRewrite[]
}

// ── Quickpads ───────────────────────────────────────────────────────────────

export interface QuickpadOut {
  id: string
  name: string
  description?: string
  body: string
  is_public: boolean
  owner_username?: string
  organization_id: number
  created_at: string
  updated_at: string
}

export interface QuickpadListOut {
  items: QuickpadOut[]
  total: number
}

export interface QuickpadCreate {
  name: string
  description?: string
  body?: string
  is_public?: boolean
}

export interface QuickpadUpdate {
  name?: string
  description?: string
  body?: string
  is_public?: boolean
}

export interface QuickpadVariablesOut {
  variables: string[]
}

export interface QuickpadRenderRequest {
  params: Record<string, string>
}

export interface QuickpadRenderOut {
  output: string
  variables_used: string[]
}

// ── Render Webhooks ─────────────────────────────────────────────────────────

export type WebhookHttpMethod = 'POST' | 'PUT' | 'PATCH'
export type WebhookTriggerOn = 'persist' | 'always'
export type WebhookOnError = 'warn' | 'block'

export interface RenderWebhookCreate {
  name: string
  is_active?: boolean
  project_id?: number | null
  template_id?: number | null
  url: string
  http_method?: WebhookHttpMethod
  auth_header?: string | null
  payload_template?: string | null
  trigger_on?: WebhookTriggerOn
  on_error?: WebhookOnError
  timeout_seconds?: number
}

export interface RenderWebhookUpdate {
  name?: string
  is_active?: boolean
  url?: string
  http_method?: WebhookHttpMethod
  auth_header?: string | null
  payload_template?: string | null
  trigger_on?: WebhookTriggerOn
  on_error?: WebhookOnError
  timeout_seconds?: number
}

export interface RenderWebhookOut {
  id: number
  organization_id: string
  project_id: string | null
  template_id: string | null
  name: string
  is_active: boolean
  url: string
  http_method: string
  auth_header: string | null
  payload_template: string | null
  trigger_on: string
  on_error: string
  timeout_seconds: number
  created_at: string
  updated_at: string
}

export interface RenderWebhookListOut {
  items: RenderWebhookOut[]
  total: number
}

export interface WebhookTestResult {
  webhook_id: number
  success: boolean
  status_code: number | null
  response_body: string | null
  error: string | null
}

// ── Org Settings & Stats ─────────────────────────────────────────────────────

export interface OrgSettingsOut {
  id: string
  name: string
  display_name: string | null
  logo_url: string | null
  timezone: string
  retention_days: number | null
}

export interface OrgSettingsPatch {
  display_name?: string | null
  logo_url?: string | null
  timezone?: string
  retention_days?: number | null
}

export interface OrgStatsOut {
  users_total: number
  projects_total: number
  templates_total: number
  renders_total: number
  renders_last_30d: number
  renders_last_7d: number
  api_keys_active: number
  storage_templates_count: number
}

// ── Webhook Deliveries ───────────────────────────────────────────────────────

export interface WebhookDeliveryOut {
  id: string
  webhook_id: number
  event: string
  status_code: number | null
  error: string | null
  duration_ms: number | null
  created_at: string
}

export interface WebhookDeliveryListOut {
  items: WebhookDeliveryOut[]
  total: number
}

// ── Health / Status (Phase 14) ───────────────────────────────────────────────

export type ComponentStatus = 'ok' | 'warn' | 'error'

export interface ComponentCheck {
  name: string
  status: ComponentStatus
  message: string | null
  latency_ms: number | null
}

export interface HealthOut {
  status: ComponentStatus
  version: string
  uptime_seconds: number
  components: ComponentCheck[]
}

// ── Render Analytics (Phase 14) ──────────────────────────────────────────────

export interface RenderDayPoint {
  date: string
  total: number
  errors: number
}

export interface RenderTimeSeriesOut {
  days: number
  series: RenderDayPoint[]
}

export interface TopTemplateItem {
  template_id: string
  display_name: string
  render_count: number
  error_count: number
}

export interface TopTemplatesOut {
  items: TopTemplateItem[]
}
