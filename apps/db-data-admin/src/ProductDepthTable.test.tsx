import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProductDepthTable } from './ProductDepthTable'
import type { ApiClient } from './lib/data-admin'
import type { ProductDepthRow } from './lib/product-depth'

afterEach(cleanup)

const rows: ProductDepthRow[] = [
  {
    id: 'd-1', legacy_id: 17, code: '3IN', label: '3 inch', status: 'active',
    source_system: 'designflow_plm', sort_order: 1,
    created_at: '2026-08-09T12:00:00Z', updated_at: '2026-08-09T12:00:00Z',
  },
  {
    id: 'd-2', legacy_id: 42, code: '9IN', label: '9 inch', status: 'inactive',
    source_system: 'designflow_plm', sort_order: 2,
    created_at: '2026-08-09T12:00:00Z', updated_at: '2026-08-09T12:30:00Z',
  },
]

type RpcCall = [string, Record<string, unknown>]

function makeClient(responses: Record<string, unknown>, calls: RpcCall[] = []): ApiClient {
  return {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      calls.push([name, params])
      return { data: responses[name] ?? { rows: [] }, error: null }
    }),
  } as unknown as ApiClient
}

function makeDeniedClient(): ApiClient {
  return {
    rpc: vi.fn(async () => ({ data: null, error: new Error('permission denied for function') })),
  } as unknown as ApiClient
}

const listOnly = { db_data_admin_product_depth_list: { rows } }

describe('ProductDepthTable', () => {
  it('loads through the protected list RPC, inactive included so a value can be reactivated', async () => {
    const calls: RpcCall[] = []
    render(<ProductDepthTable client={makeClient(listOnly, calls)} />)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls[0][0]).toBe('db_data_admin_product_depth_list')
    expect(calls[0][1].p_include_inactive).toBe(true)
    expect(await screen.findByText('2 of 2 depth values · 1 active')).toBeInTheDocument()
  })

  it('shows the two-arm access message when the database gate refuses', async () => {
    render(<ProductDepthTable client={makeDeniedClient()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Administrator or Designer/i)
  })

  it('offers no delete control anywhere — deactivation is the only retirement path', async () => {
    render(<ProductDepthTable client={makeClient(listOnly)} />)
    await screen.findByText('2 of 2 depth values · 1 active')
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull()
  })

  it('refuses a mutation with no reason, before any RPC is sent', async () => {
    const calls: RpcCall[] = []
    render(<ProductDepthTable client={makeClient(listOnly, calls)} />)
    await screen.findByText('2 of 2 depth values · 1 active')
    fireEvent.click(screen.getByRole('button', { name: /add depth value/i }))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'X1' } })
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '12 inch' } })
    fireEvent.click(screen.getByRole('button', { name: /add value/i }))
    await screen.findByText(/Give a reason for this change/i)
    expect(calls.filter(call => call[0] !== 'db_data_admin_product_depth_list')).toHaveLength(0)
  })

  it('creates through the upsert RPC and never sends a legacy id', async () => {
    const calls: RpcCall[] = []
    const client = makeClient({
      ...listOnly,
      db_data_admin_upsert_product_depth: { success: true, row: rows[0] },
    }, calls)
    render(<ProductDepthTable client={client} />)
    await screen.findByText('2 of 2 depth values · 1 active')
    fireEvent.click(screen.getByRole('button', { name: /add depth value/i }))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'X1' } })
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '12 inch' } })
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'new tooling size' } })
    fireEvent.click(screen.getByRole('button', { name: /add value/i }))
    await waitFor(() => expect(calls.some(call => call[0] === 'db_data_admin_upsert_product_depth')).toBe(true))
    const [, params] = calls.find(call => call[0] === 'db_data_admin_upsert_product_depth')!
    expect(params.p_depth_id).toBeNull()
    expect(JSON.stringify(params)).not.toContain('legacy')
    expect(params.p_reason).toBe('new tooling size')
  })

  it('renders a committed failure instead of swallowing it', async () => {
    const client = makeClient({
      ...listOnly,
      db_data_admin_upsert_product_depth: { success: false, code: 'duplicate_code' },
    })
    render(<ProductDepthTable client={client} />)
    await screen.findByText('2 of 2 depth values · 1 active')
    fireEvent.click(screen.getByRole('button', { name: /add depth value/i }))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '3IN' } })
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'dupe' } })
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'testing' } })
    fireEvent.click(screen.getByRole('button', { name: /add value/i }))
    expect(await screen.findByText(/Another Product Depth already uses that code/i)).toBeInTheDocument()
  })
})
