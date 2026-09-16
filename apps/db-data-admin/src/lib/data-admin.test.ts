import { describe, expect, it, vi } from 'vitest'
import { executeMerge, initialQuery, loadAllRows, loadGridState, previewMerge, saveGridState, searchMergeCandidates, setPropertyStatus, toRpcParams, updateRecord } from './data-admin'

describe('DB Data Admin query contracts', () => {
  it('maps the customer-only channel without changing the vendor signature', () => {
    expect(toRpcParams('customer', { ...initialQuery, channelId: 'channel-1' })).toMatchObject({ p_channel_id: 'channel-1', p_page_size: 200 })
    expect(toRpcParams('vendor', initialQuery)).not.toHaveProperty('p_channel_id')
  })

  it('loads client-side pages until the cursor is exhausted', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { rows: [{ id: '1' }], next_cursor: 'next' }, error: null })
      .mockResolvedValueOnce({ data: { rows: [{ id: '2' }], next_cursor: null }, error: null })
    const result = await loadAllRows({ rpc } as never, 'customer', initialQuery)
    expect(result.rows.map(row => row.id)).toEqual(['1', '2'])
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('uses the exact saved-view contract and surfaces optimistic conflicts', async () => {
    const getRpc = vi.fn().mockResolvedValue({ data: { found: false }, error: null })
    await loadGridState({ rpc: getRpc } as never, 'customer')
    expect(getRpc).toHaveBeenCalledWith('db_data_admin_grid_state_get', { p_entity_type: 'customer', p_view_key: 'default' })
    const saveRpc = vi.fn().mockResolvedValue({ data: { ok: false, code: 'version_conflict', current_version: 3 }, error: null })
    await expect(saveGridState({ rpc: saveRpc } as never, 'vendor', initialQuery, 2)).rejects.toThrow('version 3')
  })

  it('maps single-record updates to the protected customer and vendor contracts', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
    const input = {
      expectedUpdatedAt: '2026-07-22T12:00:00Z', reason: 'Verified by operations',
      app: 'pm' as const, appStatus: 'active' as const, channelIds: ['channel-1'],
    }
    await updateRecord({ rpc } as never, 'customer', 'customer-1', input)
    expect(rpc).toHaveBeenCalledWith('db_data_admin_update_customer', expect.objectContaining({
      p_customer_id: 'customer-1', p_app: 'pm', p_channel_ids: ['channel-1'],
    }))

    rpc.mockClear()
    await updateRecord({ rpc } as never, 'vendor', 'vendor-1', input)
    expect(rpc).toHaveBeenCalledWith('db_data_admin_update_vendor', expect.objectContaining({
      p_vendor_id: 'vendor-1', p_app: 'pm',
    }))
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_channel_ids')
  })

  it('searches the full entity for a merge candidate beyond the loaded grid page', async () => {
    // A legitimate duplicate may not be on the loaded grid page. The dialog must
    // be able to reach it through a bounded, inactive-inclusive name search that
    // excludes the survivor itself.
    const rpc = vi.fn().mockResolvedValue({ data: { rows: [{ id: 'keep' }, { id: 'dupe' }], next_cursor: null }, error: null })
    const found = await searchMergeCandidates({ rpc } as never, 'customer', 'north', 'keep')
    expect(rpc).toHaveBeenCalledWith('db_data_admin_customer_list', expect.objectContaining({
      p_search: 'north', p_include_inactive: true, p_page_size: 25,
    }))
    expect(found.map(row => row.id)).toEqual(['dupe'])
  })

  it('maps merge preview and execution to the protected contracts', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
    await previewMerge({ rpc } as never, 'customer', 'keep', 'absorb')
    expect(rpc).toHaveBeenCalledWith('db_data_admin_preview_customer_merge', { p_survivor_id: 'keep', p_loser_id: 'absorb' })
    rpc.mockClear()
    await executeMerge({ rpc } as never, 'vendor', 'keep', 'absorb', 'token', 'Duplicate', { 'crm.status': 'survivor' })
    expect(rpc).toHaveBeenCalledWith('db_data_admin_merge_vendor', expect.objectContaining({
      p_survivor_id: 'keep', p_loser_id: 'absorb', p_preview_token: 'token',
      p_reason: 'Duplicate', p_resolutions: { 'crm.status': 'survivor' },
    }))
  })
})

describe('setPropertyStatus', () => {
  it('uses the guarded RPC with a fresh operation id and concurrency token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
    await setPropertyStatus({ rpc } as never, 'p-avengers', 'inactive', {
      expectedUpdatedAt: '2026-08-20T12:00:00Z', reason: 'Licence lapsed',
    })
    expect(rpc).toHaveBeenCalledWith('db_data_admin_set_property_status', expect.objectContaining({
      p_property_id: 'p-avengers', p_status: 'inactive',
      p_expected_updated_at: '2026-08-20T12:00:00Z', p_reason: 'Licence lapsed',
      p_operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
  })

  it('sends a missing concurrency token as null so the RPC can return stale_token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: false, code: 'stale_token' }, error: null })
    await setPropertyStatus({ rpc } as never, 'p-avengers', 'inactive', { expectedUpdatedAt: '', reason: 'Licence lapsed' })
    expect(rpc.mock.calls[0][1].p_expected_updated_at).toBeNull()
  })
})
