import type { ApiClient } from './data-admin'

// DCP Vault property -> OPA Property review queue.
//
// Background: OPA carries only two creation branches, `disney` (1,445
// Properties) and `lucasfilm` (74). Marvel was merged into the Disney branch
// when Disney moved Marvel submissions off ASGARD, so OPA can never separate
// Marvel from Disney on its own. Owner ruling 2026-08-31 (see
// docs/business-rules/licensing-master-data.md, "OPA cannot separate Marvel
// from Disney") makes the signed contract schedule controlling for that split.
//
// This screen is how a Licensing reviewer records the decision the ruling
// requires, one DCP Vault Property at a time, instead of trading spreadsheets.
// It never invents a placement: the queue only ever offers the candidate
// members already recorded against the pending row, and an approval is written
// as a new superseding version of an append-only decision row.
//
// The shapes below follow api.db_data_admin_property_match_queue and
// api.db_data_admin_decide_property_match exactly
// (supabase/migrations/20260902053756_property_match_review_rpcs.sql).

/** A candidate member as the queue returns it: an id and its ordinal, nothing more. */
export type QueueCandidate = {
  licensed_property_id: number
  member_ordinal: number
}

/** A candidate after the OPA name has been looked up for display. */
export type MatchCandidate = QueueCandidate & {
  /** Null when the name lookup found nothing — shown as unknown rather than hidden. */
  property_name: string | null
}

export type OpaPropertyOption = {
  licensed_property_id: number
  property_name: string
}

export type MatchState = 'exact' | 'multiple' | 'none'

export type PropertyMatchRow = {
  row_key: string
  resolution_id: string
  source_system: string
  source_table: string
  source_property_id: string
  source_property_name: string | null
  display_label: string
  decision_version: number
  approval_status: 'pending' | 'approved' | 'rejected'
  evidence_reference: string
  evidence_sha256: string
  decision_reason: string
  contract_asserted_studio_code: string | null
  contract_evidence_reference: string | null
  contract_evidence_sha256: string | null
  supersedes_resolution_id: string | null
  prior_resolution_id: string | null
  prior_approval_status: string | null
  prior_decision_version: number | null
  prior_contract_asserted_studio_code: string | null
  candidate_count: number
  candidates: MatchCandidate[]
}

export type MatchQueuePage = {
  rows: PropertyMatchRow[]
  next_cursor: string | null
  page_size: number
}

export type DecisionResult = {
  resolution_id: string
  decision_version: number
  approval_status: string
  idempotent_repeat: boolean
  members: QueueCandidate[]
}

/**
 * The review RPCs are added by a governed shared-db migration. Until that lands
 * the tab must say so plainly rather than showing a raw PostgREST error, so the
 * screen can ship ahead of the database change and light up on its own.
 */
export class ReviewQueueUnavailableError extends Error {
  constructor() {
    super('The property match review queue is not enabled on this database yet.')
    this.name = 'ReviewQueueUnavailableError'
  }
}

function isMissingFunction(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  // PostgREST reports an unknown RPC as PGRST202; PostgreSQL reports 42883.
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message)
}

export function normaliseRow(row: PropertyMatchRow): PropertyMatchRow {
  const candidates = [...(row.candidates ?? [])]
    .map(candidate => ({ ...candidate, property_name: candidate.property_name ?? null }))
    .sort((a, b) => a.member_ordinal - b.member_ordinal)
  return { ...row, candidates, candidate_count: row.candidate_count ?? candidates.length }
}

/**
 * The queue returns candidate ids only. Names come from
 * api.opa_property_reconciliation, the authenticated view that carries
 * licensed_property_id alongside the OPA property name.
 */
export async function attachCandidateNames(client: ApiClient, rows: PropertyMatchRow[]) {
  const ids = [...new Set(rows.flatMap(row => row.candidates.map(c => c.licensed_property_id)))]
  if (ids.length === 0) return rows
  const { data, error } = await client
    .from('opa_property_reconciliation')
    .select('licensed_property_id, opa_property_name')
    .in('licensed_property_id', ids)
  // A naming lookup must never cost the reviewer the queue itself; the ids
  // still identify each candidate unambiguously without it.
  if (error) return rows
  const names = new Map<number, string>()
  for (const entry of (data ?? []) as { licensed_property_id: number; opa_property_name: string | null }[]) {
    if (entry.opa_property_name) names.set(Number(entry.licensed_property_id), entry.opa_property_name)
  }
  return rows.map(row => ({
    ...row,
    candidates: row.candidates.map(candidate => ({
      ...candidate,
      property_name: names.get(candidate.licensed_property_id) ?? null,
    })),
  }))
}

/** Load the complete OPA Property vocabulary; Supabase caps one select at 1,000 rows. */
export async function loadOpaPropertyOptions(client: ApiClient) {
  const options: OpaPropertyOption[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('opa_property_reconciliation')
      .select('licensed_property_id, opa_property_name')
      .order('opa_property_name')
      .range(from, from + pageSize - 1)
    if (error) return loadOpaPropertyOptionsFromReviewSurface(client, error)
    const page = (data ?? []) as { licensed_property_id: number; opa_property_name: string | null }[]
    options.push(...page.filter(row => row.opa_property_name).map(row => ({
      licensed_property_id: Number(row.licensed_property_id),
      property_name: row.opa_property_name as string,
    })))
    if (page.length < pageSize) break
  }
  return options
}

type ScrapedOpaRow = {
  source_system?: string | null
  source_id?: string | null
  source_property_id?: string | null
  display_name?: string | null
  display_label?: string | null
  source_property_name?: string | null
}

/**
 * Licensing users already read this server-owned review surface in the adjacent
 * Scraped Properties tab. Use it only when the lower-level reconciliation view
 * is refused, keeping the full OPA picker without widening database privileges.
 */
async function loadOpaPropertyOptionsFromReviewSurface(client: ApiClient, directError: unknown) {
  const options = new Map<number, string>()
  let cursor: string | null = null
  do {
    const { data, error } = await client.rpc('db_data_admin_scraped_properties', {
      p_search: null,
      p_cursor: cursor,
      p_page_size: 1000,
    })
    if (error) {
      const directCode = errorCode(directError)
      const fallbackCode = errorCode(error)
      throw new Error(`Property options could not be loaded (${directCode}; fallback ${fallbackCode}).`)
    }
    const payload = (data ?? {}) as { rows?: ScrapedOpaRow[]; next_cursor?: string | null }
    for (const row of payload.rows ?? []) {
      if (!/_opa$/i.test(row.source_system ?? '')) continue
      const id = Number(row.source_id ?? row.source_property_id)
      const name = row.display_name ?? row.display_label ?? row.source_property_name
      if (Number.isSafeInteger(id) && id > 0 && name?.trim()) options.set(id, name.trim())
    }
    cursor = payload.next_cursor ?? null
  } while (cursor)
  return [...options].map(([licensed_property_id, property_name]) => ({ licensed_property_id, property_name }))
    .sort((a, b) => a.property_name.localeCompare(b.property_name) || a.licensed_property_id - b.licensed_property_id)
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown'
  return String(error.code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'unknown'
}

/** Why this row needs a human: no candidate, exactly one, or a choice between several. */
export function matchState(row: PropertyMatchRow): MatchState {
  if (row.candidates.length === 0) return 'none'
  return row.candidates.length === 1 ? 'exact' : 'multiple'
}

export function describeMatchState(row: PropertyMatchRow) {
  switch (matchState(row)) {
    case 'multiple':
      return `${row.candidates.length} submissions-system (OPA) names are proposed for this contract clause. Remove any the clause does not cover.`
    case 'none':
      return 'No submissions-system (OPA) name was proposed. Reject it, or check the contract evidence before deciding.'
    default:
      return 'One submissions-system (OPA) name is proposed. Confirm to record the decision, or reject it.'
  }
}

/**
 * Every recorded candidate remains visible as a removable suggestion. Nothing
 * is applied until the reviewer supplies a reason and confirms the decision.
 */
export function defaultSelection(row: PropertyMatchRow) {
  return row.candidates.map(candidate => candidate.licensed_property_id)
}

export async function loadPropertyMatchQueue(client: ApiClient, search: string | null = null) {
  const rows: PropertyMatchRow[] = []
  let cursor: string | null = null
  do {
    const { data, error } = await client.rpc('db_data_admin_property_match_queue', {
      p_search: search || null,
      p_cursor: cursor,
      p_page_size: 200,
    })
    if (error) {
      if (isMissingFunction(error)) throw new ReviewQueueUnavailableError()
      throw error
    }
    const payload = (data ?? {}) as Partial<MatchQueuePage>
    rows.push(...(payload.rows ?? []).map(normaliseRow))
    cursor = payload.next_cursor ?? null
  } while (cursor)
  return attachCandidateNames(client, rows)
}

export async function decidePropertyMatch(
  client: ApiClient,
  input: {
    resolutionId: string
    decision: 'approve' | 'reject'
    licensedPropertyIds: number[]
    reason: string
    /**
     * Stable per attempt. It BECOMES the new decision row's id, so retrying a
     * failed call with the same value returns the recorded decision instead of
     * appending a second version.
     */
    clientRequestId: string
  },
) {
  if (input.decision === 'approve' && input.licensedPropertyIds.length === 0) {
    throw new Error('Select at least one OPA Property before confirming, or reject the row instead.')
  }
  if (!input.reason.trim()) throw new Error('A reason is required so the decision records why.')
  const { data, error } = await client.rpc('db_data_admin_decide_property_match', {
    p_resolution_id: input.resolutionId,
    p_decision: input.decision,
    // The database refuses a rejection that carries members, so never send any.
    p_licensed_property_ids: input.decision === 'approve' ? input.licensedPropertyIds : [],
    p_decision_reason: input.reason.trim(),
    p_client_request_id: input.clientRequestId,
  })
  if (error) {
    if (isMissingFunction(error)) throw new ReviewQueueUnavailableError()
    throw error
  }
  return (data ?? {}) as DecisionResult
}
