import type { createSupabase } from './supabase'

export type EntityKind = 'customer' | 'vendor'
export type AdminRow = Record<string, unknown> & { id: string; display_name?: string; name?: string }
export type UpdateInput = {
  expectedUpdatedAt: string; reason: string; displayName?: string | null; status?: string | null
  app?: 'crm' | 'pm' | 'dam' | null; appStatus?: 'active' | 'inactive' | null; channelIds?: string[] | null
}
export type UpdateResult = { success: boolean; code?: string; message?: string; row?: AdminRow; current?: AdminRow; audit_id?: string; idempotent_replay?: boolean }
export type AuditEvent = { id: string; action: string; reason: string; actor_label?: string; occurred_at: string; succeeded: boolean; error_code?: string; old_snapshot?: Record<string, unknown>; new_snapshot?: Record<string, unknown> }
export type MergeConflict = { key: string; app: string; field: string; survivor: unknown; loser: unknown }
export type MergeMovingAlias = { alias: string; alias_type?: string | null; source_system?: string | null; origin: 'existing_alias' | 'loser_name' }
export type MergeMovingSourceRef = { source_system: string; source_table?: string | null; source_id?: string | null; source_code?: string | null; source_name?: string | null }
export type MergePreview = { entity_type: EntityKind; survivor: AdminRow; loser: AdminRow; affected_counts: Record<string, number>; conflicts: MergeConflict[]; moving_aliases?: MergeMovingAlias[]; moving_source_refs?: MergeMovingSourceRef[] }
export type MergePreviewResult = { success: boolean; code?: string; message?: string; preview?: MergePreview; preview_token?: string }
export type MergeResult = { success: boolean; code?: string; message?: string; survivor?: AdminRow; audit_id?: string; idempotent_replay?: boolean; current_preview?: MergePreviewResult }
export type QueryState = {
  search: string; status: string; app: string; appStatus: string; includeInactive: boolean
  channelId: string; sort: string; sortDir: 'asc' | 'desc'; cursor: string | null; pageSize: number
}

export const initialQuery: QueryState = {
  search: '', status: '', app: '', appStatus: '', includeInactive: false,
  channelId: '', sort: 'display_name', sortDir: 'asc', cursor: null, pageSize: 200,
}

export function toRpcParams(kind: EntityKind, query: QueryState) {
  return {
    p_search: query.search || null,
    p_status: query.status || null,
    p_app: query.app || null,
    p_app_status: query.appStatus || null,
    p_include_inactive: query.includeInactive,
    p_sort: query.sort,
    p_sort_dir: query.sortDir,
    p_cursor: query.cursor,
    p_page_size: query.pageSize,
    ...(kind === 'customer' ? { p_channel_id: query.channelId || null } : {}),
  }
}

export type ApiClient = ReturnType<typeof createSupabase>

export async function probeAccess(client: ApiClient) {
  const { data, error } = await client.rpc('db_data_admin_channel_list')
  if (error) throw error
  return (data ?? []) as Array<{ id: string; name: string }>
}

export async function loadRows(client: ApiClient, kind: EntityKind, query: QueryState) {
  const { data, error } = await client.rpc(`db_data_admin_${kind}_list`, toRpcParams(kind, query))
  if (error) throw error
  const payload = (data ?? {}) as { rows?: AdminRow[]; next_cursor?: string | null }
  return { rows: payload.rows ?? [], nextCursor: payload.next_cursor ?? null }
}

export async function loadAllRows(client: ApiClient, kind: EntityKind, query: QueryState, limit = 5000) {
  const rows: AdminRow[] = []
  let cursor: string | null = null
  do {
    const page = await loadRows(client, kind, { ...query, cursor, pageSize: 200 })
    rows.push(...page.rows); cursor = page.nextCursor
  } while (cursor && rows.length < limit)
  return { rows, nextCursor: cursor }
}

// Bounded candidate search for the merge dialog: a legitimate duplicate may not
// be in the currently loaded grid page (server mode, or beyond the client-mode
// cap), so the dialog can search the full entity by name through the same
// protected list RPC. Bounded to a single small page — never an unbounded scan.
export async function searchMergeCandidates(client: ApiClient, kind: EntityKind, term: string, excludeId: string) {
  const query: QueryState = { ...initialQuery, search: term, includeInactive: true, pageSize: 25 }
  const { rows } = await loadRows(client, kind, query)
  return rows.filter(row => row.id !== excludeId)
}

export async function loadDetail(client: ApiClient, kind: EntityKind, id: string) {
  const { data, error } = await client.rpc(`db_data_admin_${kind}_detail`, { p_id: id })
  if (error) throw error
  return data as Record<string, unknown>
}

export async function updateRecord(client: ApiClient, kind: EntityKind, id: string, input: UpdateInput) {
  const params = {
    [`p_${kind === 'customer' ? 'customer' : 'vendor'}_id`]: id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_operation_id: crypto.randomUUID(),
    p_reason: input.reason,
    p_display_name: input.displayName ?? null,
    p_status: input.status ?? null,
    p_app: input.app ?? null,
    p_app_status: input.appStatus ?? null,
    ...(kind === 'customer' ? { p_channel_ids: input.channelIds ?? null } : {}),
  }
  const { data, error } = await client.rpc(`db_data_admin_update_${kind}`, params)
  if (error) throw error
  return data as UpdateResult
}

export async function loadAudit(client: ApiClient, kind: EntityKind, id: string) {
  const { data, error } = await client.rpc('db_data_admin_audit_list', {
    p_entity_type: kind, p_entity_id: id, p_action: null, p_actor_profile_id: null,
    p_since: null, p_until: null, p_cursor: null, p_page_size: 50,
  })
  if (error) throw error
  return ((data as { rows?: AuditEvent[] } | null)?.rows ?? [])
}

export async function previewMerge(client: ApiClient, kind: EntityKind, survivorId: string, loserId: string) {
  const { data, error } = await client.rpc(`db_data_admin_preview_${kind}_merge`, { p_survivor_id: survivorId, p_loser_id: loserId })
  if (error) throw error
  return data as MergePreviewResult
}

export async function executeMerge(client: ApiClient, kind: EntityKind, survivorId: string, loserId: string, previewToken: string, reason: string, resolutions: Record<string, 'survivor' | 'loser'>) {
  const { data, error } = await client.rpc(`db_data_admin_merge_${kind}`, {
    p_survivor_id: survivorId, p_loser_id: loserId, p_preview_token: previewToken,
    p_operation_id: crypto.randomUUID(), p_reason: reason, p_resolutions: resolutions,
  })
  if (error) throw error
  return data as MergeResult
}

export async function loadGridState(client: ApiClient, kind: EntityKind) {
  const { data, error } = await client.rpc('db_data_admin_grid_state_get', { p_entity_type: kind, p_view_key: 'default' })
  if (error) throw error
  return data as { state?: Partial<QueryState>; version?: number } | null
}

export async function saveGridState(client: ApiClient, kind: EntityKind, state: QueryState, version: number) {
  const { data, error } = await client.rpc('db_data_admin_grid_state_upsert', {
    p_entity_type: kind, p_view_key: 'default', p_state: state, p_expected_version: version || null,
  })
  if (error) throw error
  const result = data as { ok?: boolean; code?: string; current_version?: number; version?: number } | null
  if (result?.ok === false) throw new Error(result.code === 'version_conflict' ? `Saved view conflict at version ${result.current_version ?? 'unknown'}` : 'Saved view could not be updated')
  return result
}

// ---- Step 10: read-only Licensor -> Property tree ---------------------------

export type TaxonomySourceRef = {
  source_system: string; source_table: string; source_id: string
  source_code: string | null; source_name: string | null
}
export type PlmContextEntry = {
  plm_id: string | null; division_code: string | null; mg_code: string | null
  mg_type: string | null; mg_category: string | null
  // Added by migration 20260728171500 so the UI can name a division instead of
  // printing its raw PLM id. Optional because a division id with no lookup row
  // yields nulls rather than dropping the entry.
  division_name?: string | null; division_external_code?: string | null
}
export type TaxonomyNode = {
  id: string; name: string; code: string | null; status: string
  character_count?: number; licensor_id?: string | null
  source_refs: TaxonomySourceRef[]; plm_context: PlmContextEntry[]
  updated_at?: string
}
export type PropertyNode = TaxonomyNode
export type LicensorNode = TaxonomyNode & { property_count: number; properties: PropertyNode[] }
export type TreeSnapshot = {
  snapshot_at: string; store: string; source_system: string
  feeder_last_sync_at: string | null; feeder_last_run_status: string | null
  feeder_days_stale: number | null; feeder_available: boolean
  live_upstream_reconciliation: boolean; note: string
}
export type TreeReconciliation = {
  licensor_count: number; active_licensor_count: number
  property_count: number; active_property_count: number
  properties_with_licensor: number; orphan_property_count: number
  expected_orphan_count_is_zero: boolean; partition_reconciles: boolean
}
export type LicensorTreeResult = {
  snapshot: TreeSnapshot; reconciliation: TreeReconciliation
  licensors: LicensorNode[]; orphan_properties: PropertyNode[]
  next_cursor: string | null; page_size: number
}
export type LoadedTree = {
  snapshot: TreeSnapshot; reconciliation: TreeReconciliation
  licensors: LicensorNode[]; orphanProperties: PropertyNode[]
}

// Fully read-only in v1 (DesignFlow owns the Licensor->Property edge). Pages
// over licensors by name; orphan_properties is always complete per page, so it
// is captured once and licensors are accumulated.
export async function loadLicensorTree(client: ApiClient, params: { includeInactive?: boolean } = {}) {
  const licensors: LicensorNode[] = []
  let cursor: string | null = null
  let snapshot: TreeSnapshot | undefined
  let reconciliation: TreeReconciliation | undefined
  let orphanProperties: PropertyNode[] = []
  do {
    const { data, error } = await client.rpc('db_data_admin_licensor_property_tree', {
      p_search: null,
      p_include_inactive: !!params.includeInactive,
      p_cursor: cursor,
      p_page_size: 200,
    })
    if (error) throw error
    const payload = (data ?? {}) as Partial<LicensorTreeResult>
    if (!snapshot && payload.snapshot) snapshot = payload.snapshot
    if (!reconciliation && payload.reconciliation) reconciliation = payload.reconciliation
    if (payload.orphan_properties) orphanProperties = payload.orphan_properties
    licensors.push(...(payload.licensors ?? []))
    cursor = payload.next_cursor ?? null
  } while (cursor)
  return {
    snapshot: snapshot as TreeSnapshot,
    reconciliation: reconciliation as TreeReconciliation,
    licensors,
    orphanProperties,
  }
}

export type PropertyStatus = 'active' | 'inactive'
export type PropertyStatusResult = {
  success: boolean; code?: string; message?: string
  row?: AdminRow; current?: AdminRow
  audit_id?: string; authorization_id?: string; idempotent_replay?: boolean
}

export async function setPropertyStatus(
  client: ApiClient,
  propertyId: string,
  status: PropertyStatus,
  input: { expectedUpdatedAt: string; reason: string },
) {
  const { data, error } = await client.rpc('db_data_admin_set_property_status', {
    p_property_id: propertyId,
    p_status: status,
    p_expected_updated_at: input.expectedUpdatedAt || null,
    p_operation_id: crypto.randomUUID(),
    p_reason: input.reason,
  })
  if (error) throw error
  return data as PropertyStatusResult
}

// ---- Retained source-declared Properties -----------------------------------

export type ScrapedPropertyRow = AdminRow & {
  row_key: string
  presentation_licensor_key: string
  presentation_licensor_name: string
  source_system: string
  source_table: string
  source_property_id: string
  source_property_name: string | null
  display_label: string
  source_status: string | null
  provenance_kind: string
  latest_seen_at: string | null
  capture_marker: string | null
  source_purpose: string
  review_reason: string
  evidence_basis: string
  review_guidance: string
  mapping_state?: 'mapped' | 'conflict' | 'unmapped' | null
  submissions?: Array<{ source_system: string; source_table: string; source_id: string; display_label: string | null }> | null
  contract_status?: 'evidenced' | 'not_evidenced' | 'incomplete_chain' | 'conflict' | 'unknown' | null
  submission_display?: string
  contract_status_display?: string
  is_unmapped_creative?: boolean
}

const contractStatusLabels: Record<NonNullable<ScrapedPropertyRow['contract_status']>, string> = {
  evidenced: 'Entitled — evidence on file',
  not_evidenced: 'Not evidenced',
  incomplete_chain: 'Evidence chain incomplete',
  conflict: 'Authority conflict',
  unknown: 'Unknown',
}

export function presentScrapedProperty(row: ScrapedPropertyRow): ScrapedPropertyRow {
  const isCreative = /^creative(?:\s|$|\()/i.test(row.source_purpose)
  const labels = (row.submissions ?? []).map(member => member.display_label ?? member.source_id)
  const state = row.mapping_state ?? (isCreative ? 'unmapped' : null)
  return {
    ...row,
    mapping_state: state,
    submission_display: !isCreative ? '—' : labels.length > 0 ? labels.join(' • ') : state === 'conflict' ? 'Conflict — review required' : 'Unmapped',
    contract_status_display: !isCreative ? '—' : contractStatusLabels[row.contract_status ?? 'unknown'],
    is_unmapped_creative: isCreative && state === 'unmapped',
  }
}

export async function loadScrapedProperties(client: ApiClient) {
  const rows: ScrapedPropertyRow[] = []
  let cursor: string | null = null
  do {
    const { data, error } = await client.rpc('db_data_admin_scraped_properties', {
      p_search: null,
      p_cursor: cursor,
      p_page_size: 1000,
    })
    if (error) throw error
    const payload = (data ?? {}) as { rows?: ScrapedPropertyRow[]; next_cursor?: string | null }
    rows.push(...(payload.rows ?? []).map(row => presentScrapedProperty({ ...row, id: row.row_key })))
    cursor = payload.next_cursor ?? null
  } while (cursor)
  return rows
}

export function groupScrapedProperties(rows: ScrapedPropertyRow[]) {
  const groups = new Map<string, { key: string; name: string; rows: ScrapedPropertyRow[] }>()
  for (const row of rows) {
    const group = groups.get(row.presentation_licensor_key) ?? {
      key: row.presentation_licensor_key,
      name: row.presentation_licensor_name,
      rows: [],
    }
    group.rows.push(row)
    groups.set(row.presentation_licensor_key, group)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export type ScrapedInventoryKind = 'property' | 'character' | 'style_guide'

export type ScrapedInventoryRow = AdminRow & {
  row_key: string
  entity_kind: ScrapedInventoryKind
  licensor_key: string
  licensor_name: string
  licensor_group_key: string
  licensor_group_name: string
  source_purpose: 'Creative' | 'Submissions'
  display_label: string
  source_system: string
  source_table: string
  source_id: string
  source_status: string | null
  latest_seen_at: string | null
  capture_marker: string | null
  mapping_state?: 'mapped' | 'conflict' | 'unmapped' | null
  mapping_display?: string
  is_unmapped_creative?: boolean
}

export async function loadScrapedInventory(client: ApiClient, entityKind: ScrapedInventoryKind) {
  const rows: ScrapedInventoryRow[] = []
  let cursor: string | null = null
  do {
    const { data, error } = await client.rpc('db_data_admin_scraped_source_inventory', {
      p_entity_kind: entityKind,
      p_search: null,
      p_cursor: cursor,
      p_page_size: 1000,
    })
    if (error) throw error
    const payload = (data ?? {}) as { rows?: ScrapedInventoryRow[]; next_cursor?: string | null }
    rows.push(...(payload.rows ?? []).map(row => {
      const isUnmapped = entityKind === 'property' && row.source_purpose === 'Creative' && row.mapping_state === 'unmapped'
      return {
        ...row,
        id: row.row_key,
        mapping_display: entityKind !== 'property' || row.source_purpose !== 'Creative'
          ? '—'
          : row.mapping_state === 'mapped' ? 'Mapped' : row.mapping_state === 'conflict' ? 'Conflict - review required' : 'Unmapped',
        is_unmapped_creative: isUnmapped,
      }
    }))
    cursor = payload.next_cursor ?? null
  } while (cursor)
  return rows
}

export const UNRESOLVED_LICENSOR_GROUP_KEY = 'unresolved'

export function groupScrapedInventory(rows: ScrapedInventoryRow[]) {
  const groups = new Map<string, {
    key: string
    name: string
    creative: ScrapedInventoryRow[]
    submissions: ScrapedInventoryRow[]
  }>()
  for (const row of rows) {
    // The RPC emits one canonical licensor group per row across both purposes;
    // rows with an unresolved or conflicting licensor share the 'unresolved' group.
    const key = row.licensor_group_key || UNRESOLVED_LICENSOR_GROUP_KEY
    const name = row.licensor_group_name || 'Licensor not yet determined'
    const group = groups.get(key) ?? {
      key,
      name,
      creative: [],
      submissions: [],
    }
    if (row.source_purpose === 'Creative') group.creative.push(row)
    else group.submissions.push(row)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => {
    const aUnresolved = a.key === UNRESOLVED_LICENSOR_GROUP_KEY
    const bUnresolved = b.key === UNRESOLVED_LICENSOR_GROUP_KEY
    if (aUnresolved !== bUnresolved) return aUnresolved ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}
