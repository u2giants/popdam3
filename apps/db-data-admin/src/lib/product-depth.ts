// Product Depth maintenance client — issue #597 Phase 1.
//
// DB Data Admin is now the ONLY place a Product Depth value can be added, renamed,
// activated or deactivated (owner decision 3 on issue #597; the DesignFlow editor is
// retired). Everything here goes through the protected RPCs added by migration
// 20260809170500; there is no direct table access and no client-side authorisation.
//
// Two rules this module exists to keep honest:
//
//   1. `legacy_id` is NEVER sent. The 121 seeded values carry their original
//      DesignFlow itemDepth id, existing items resolve against it, and a rename must
//      not disturb it. The RPC refuses to change it; this client never offers to.
//
//   2. Deactivation is NOT deletion, and there is no delete path here at all. An
//      inactive Depth stays visible on items that already hold it and simply stops
//      being offered for new selections.
//
// Optimistic concurrency: every mutation sends the `updated_at` the caller last saw.
// A mismatch comes back as code 'stale_token' WITH the current row, so the UI can show
// what changed instead of overwriting someone else's edit.
//
// Idempotency: each mutation generates one operation UUID. Re-sending the same one
// replays the recorded outcome and applies nothing — safe to retry on a dropped
// connection without risking a duplicate value.

import type { ApiClient } from './data-admin'

export type ProductDepthRow = {
  id: string
  legacy_id: number | null
  code: string
  label: string
  status: 'active' | 'inactive' | 'archived' | 'deleted'
  source_system: string
  sort_order: number | null
  created_at: string
  updated_at: string
}

export type ProductDepthMutationResult = {
  success: boolean
  code?: 'validation' | 'not_found' | 'stale_token' | 'no_changes' | 'duplicate_code'
  message?: string
  row?: ProductDepthRow
  current?: ProductDepthRow
  audit_id?: string
  idempotent_replay?: boolean
}

export async function loadProductDepths(
  client: ApiClient,
  params: { search?: string; includeInactive?: boolean } = {},
): Promise<ProductDepthRow[]> {
  const { data, error } = await client.rpc('db_data_admin_product_depth_list', {
    p_search: params.search?.trim() || null,
    // Inactive values are included by default: a maintainer must be able to SEE a
    // retired value in order to reactivate it. The picker contracts
    // (api.product_depth_list) are where inactive values are withheld, not here.
    p_include_inactive: params.includeInactive ?? true,
    p_page_size: 500,
  })
  if (error) throw error
  return ((data as { rows?: ProductDepthRow[] } | null)?.rows ?? [])
}

export async function createProductDepth(
  client: ApiClient,
  input: { code: string; label: string; reason: string },
): Promise<ProductDepthMutationResult> {
  const { data, error } = await client.rpc('db_data_admin_upsert_product_depth', {
    p_operation_id: crypto.randomUUID(),
    p_reason: input.reason,
    p_label: input.label,
    p_code: input.code,
    p_depth_id: null,
    p_expected_updated_at: null,
  })
  if (error) throw error
  return data as ProductDepthMutationResult
}

export async function renameProductDepth(
  client: ApiClient,
  input: { id: string; code: string; label: string; reason: string; expectedUpdatedAt: string },
): Promise<ProductDepthMutationResult> {
  const { data, error } = await client.rpc('db_data_admin_upsert_product_depth', {
    p_operation_id: crypto.randomUUID(),
    p_reason: input.reason,
    p_label: input.label,
    p_code: input.code,
    p_depth_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) throw error
  return data as ProductDepthMutationResult
}

export async function setProductDepthStatus(
  client: ApiClient,
  input: { id: string; status: 'active' | 'inactive'; reason: string; expectedUpdatedAt: string },
): Promise<ProductDepthMutationResult> {
  const { data, error } = await client.rpc('db_data_admin_set_product_depth_status', {
    p_operation_id: crypto.randomUUID(),
    p_reason: input.reason,
    p_depth_id: input.id,
    p_status: input.status,
    p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) throw error
  return data as ProductDepthMutationResult
}

// Plain-English message for a structured failure. The RPCs return committed,
// expected failures rather than throwing, so the UI must render them — a silent
// `success: false` is the failure mode this function exists to prevent.
export function describeMutationFailure(result: ProductDepthMutationResult): string | null {
  if (result.success) return null
  switch (result.code) {
    case 'stale_token':
      return 'Someone else changed this value while you were editing. Reload and try again.'
    case 'duplicate_code':
      return 'Another Product Depth already uses that code.'
    case 'not_found':
      return 'That Product Depth no longer exists.'
    case 'no_changes':
      return 'Nothing was changed.'
    case 'validation':
      return result.message ?? 'That value is not valid.'
    default:
      return result.message ?? 'The change could not be saved.'
  }
}
