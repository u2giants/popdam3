import type { AdminRow, EntityKind, UpdateInput, UpdateResult } from './data-admin'

export const INLINE_EDIT_REASON = 'Edited in table'
export const INLINE_UNDO_REASON = 'Undid table edit'
export const INLINE_EDITABLE_PROPS = new Set(['status', 'crm_status', 'pm_status', 'dam_status'])

const GLOBAL_STATUSES = new Set(['active', 'potential', 'inactive'])
const APP_STATUSES = new Set(['active', 'inactive'])

export type InlineUpdateCall = (
  kind: EntityKind,
  id: string,
  input: UpdateInput,
) => Promise<UpdateResult>

export function buildInlineUpdate(
  row: AdminRow,
  prop: string,
  value: unknown,
  reason = INLINE_EDIT_REASON,
): UpdateInput {
  const text = value == null ? '' : String(value).trim()
  const base = { expectedUpdatedAt: String(row.updated_at), reason }

  if (prop === 'status') {
    if (!GLOBAL_STATUSES.has(text)) throw new Error('Status must be active, potential, or inactive.')
    return { ...base, status: text }
  }
  const appMatch = /^(crm|pm|dam)_status$/.exec(prop)
  if (appMatch) {
    if (!APP_STATUSES.has(text)) throw new Error('Application status must be active or inactive.')
    return {
      ...base,
      app: appMatch[1] as 'crm' | 'pm' | 'dam',
      appStatus: text as 'active' | 'inactive',
    }
  }
  throw new Error('That column is read-only.')
}

/**
 * Saves one row's edited cells in a stable order. The RPC changes the row's
 * optimistic-concurrency token after every write, so later cells must use the
 * fresh row returned by the prior call.
 */
export async function saveInlineRow(
  kind: EntityKind,
  row: AdminRow,
  changes: Record<string, unknown>,
  update: InlineUpdateCall,
  reason = INLINE_EDIT_REASON,
): Promise<AdminRow> {
  let current = row
  for (const [prop, value] of Object.entries(changes)) {
    if (!INLINE_EDITABLE_PROPS.has(prop)) continue
    const displayedCurrent = String(current[prop] ?? '')
    if (displayedCurrent === String(value ?? '').trim()) continue

    const result = await update(kind, current.id, buildInlineUpdate(current, prop, value, reason))
    if (!result.success || !result.row) {
      throw new Error(result.code === 'stale_token'
        ? 'This row changed elsewhere. Refresh the table, then try again.'
        : result.message ?? 'The table change was not saved.')
    }
    current = { ...current, ...result.row }
  }
  return current
}
