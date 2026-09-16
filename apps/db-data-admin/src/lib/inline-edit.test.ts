import { describe, expect, it, vi } from 'vitest'
import { buildInlineUpdate, INLINE_EDIT_REASON, INLINE_UNDO_REASON, saveInlineRow } from './inline-edit'

const row = {
  id: 'customer-1',
  name: 'Acme',
  display_name: 'Acme',
  status: 'active',
  crm_status: 'active',
  updated_at: '2026-07-28T12:00:00Z',
}

describe('inline table editing', () => {
  it('maps editable grid columns to the existing guarded update contract', () => {
    expect(buildInlineUpdate(row, 'crm_status', 'inactive')).toEqual({
      expectedUpdatedAt: row.updated_at,
      reason: INLINE_EDIT_REASON,
      app: 'crm',
      appStatus: 'inactive',
    })
  })

  it('rejects invalid and read-only values before calling the API', () => {
    expect(() => buildInlineUpdate(row, 'status', 'archived')).toThrow(/active, potential, or inactive/)
    expect(() => buildInlineUpdate(row, 'name_display', 'Acme North')).toThrow(/read-only/)
    expect(() => buildInlineUpdate(row, 'erp_active', 'false')).toThrow(/read-only/)
  })

  it('uses each saved row as the concurrency token for the next cell', async () => {
    const update = vi.fn()
      .mockResolvedValueOnce({ success: true, row: { ...row, status: 'inactive', updated_at: 'token-2' } })
      .mockResolvedValueOnce({ success: true, row: { ...row, status: 'inactive', crm_status: 'inactive', updated_at: 'token-3' } })

    const saved = await saveInlineRow('customer', row, {
      status: 'inactive',
      crm_status: 'inactive',
    }, update, INLINE_UNDO_REASON)

    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[1][2].expectedUpdatedAt).toBe('token-2')
    expect(update.mock.calls[0][2].reason).toBe(INLINE_UNDO_REASON)
    expect(update.mock.calls[1][2].reason).toBe(INLINE_UNDO_REASON)
    expect(saved.updated_at).toBe('token-3')
  })
})
