import { describe, expect, it, vi } from 'vitest'
import {
  createProductDepth,
  describeMutationFailure,
  loadProductDepths,
  renameProductDepth,
  setProductDepthStatus,
  type ProductDepthMutationResult,
} from './product-depth'

type RpcCall = { name: string; params: Record<string, unknown> }

function stubClient(response: unknown, calls: RpcCall[] = []) {
  return {
    calls,
    client: {
      rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params })
        return { data: response, error: null }
      }),
    } as never,
  }
}

describe('product depth client', () => {
  it('lists through the protected RPC and includes inactive values by default', async () => {
    const { client, calls } = stubClient({ rows: [{ id: 'a', code: '1', label: '1in' }] })
    const rows = await loadProductDepths(client)
    expect(rows).toHaveLength(1)
    expect(calls[0].name).toBe('db_data_admin_product_depth_list')
    // A maintainer must be able to SEE a retired value in order to reactivate it.
    expect(calls[0].params.p_include_inactive).toBe(true)
  })

  it('never sends legacy_id on a create or a rename', async () => {
    const { client, calls } = stubClient({ success: true })
    await createProductDepth(client, { code: 'X1', label: '9in', reason: 'new depth' })
    await renameProductDepth(client, {
      id: 'id-1', code: 'X1', label: '9.5in', reason: 'label fix', expectedUpdatedAt: 'T0',
    })
    for (const call of calls) {
      expect(Object.keys(call.params)).not.toContain('p_legacy_id')
      expect(JSON.stringify(call.params)).not.toContain('legacy')
    }
  })

  it('sends a distinct operation id per mutation so retries replay instead of duplicating', async () => {
    const { client, calls } = stubClient({ success: true })
    await createProductDepth(client, { code: 'A', label: 'a', reason: 'r' })
    await createProductDepth(client, { code: 'B', label: 'b', reason: 'r' })
    expect(calls[0].params.p_operation_id).not.toBe(calls[1].params.p_operation_id)
    expect(String(calls[0].params.p_operation_id)).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('carries the optimistic-concurrency token on every update path', async () => {
    const { client, calls } = stubClient({ success: true })
    await renameProductDepth(client, {
      id: 'id-1', code: 'A', label: 'a', reason: 'r', expectedUpdatedAt: 'T1',
    })
    await setProductDepthStatus(client, {
      id: 'id-1', status: 'inactive', reason: 'retired', expectedUpdatedAt: 'T1',
    })
    expect(calls[0].params.p_expected_updated_at).toBe('T1')
    expect(calls[1].params.p_expected_updated_at).toBe('T1')
  })

  it('creates without a concurrency token, because there is no row to conflict with', async () => {
    const { client, calls } = stubClient({ success: true })
    await createProductDepth(client, { code: 'A', label: 'a', reason: 'r' })
    expect(calls[0].params.p_depth_id).toBeNull()
    expect(calls[0].params.p_expected_updated_at).toBeNull()
  })

  it('exposes only activate/deactivate — there is no delete path', async () => {
    const { client, calls } = stubClient({ success: true })
    await setProductDepthStatus(client, {
      id: 'id-1', status: 'active', reason: 'back in use', expectedUpdatedAt: 'T1',
    })
    expect(calls[0].name).toBe('db_data_admin_set_product_depth_status')
    expect(calls[0].params.p_status).toBe('active')
    const moduleExports = Object.keys(await import('./product-depth'))
    expect(moduleExports.some(name => /delete|remove|drop/i.test(name))).toBe(false)
  })

  it('renders every structured failure rather than swallowing it', () => {
    const cases: Array<[ProductDepthMutationResult, RegExp]> = [
      [{ success: false, code: 'stale_token' }, /Reload and try again/],
      [{ success: false, code: 'duplicate_code' }, /already uses that code/],
      [{ success: false, code: 'not_found' }, /no longer exists/],
      [{ success: false, code: 'no_changes' }, /Nothing was changed/],
      [{ success: false, code: 'validation', message: 'code is required' }, /code is required/],
      [{ success: false }, /could not be saved/],
    ]
    for (const [result, pattern] of cases) {
      expect(describeMutationFailure(result)).toMatch(pattern)
    }
    expect(describeMutationFailure({ success: true })).toBeNull()
  })
})
