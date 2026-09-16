import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PropertyTable, propertyColumns } from './PropertyTable'
import type { ApiClient, LicensorTreeResult } from './lib/data-admin'

afterEach(cleanup)

const fixture: LicensorTreeResult = {
  snapshot: {
    snapshot_at: '2026-07-22T12:00:00Z',
    store: 'core.licensor / core.property (Supabase canonical mirror)',
    source_system: 'designflow_plm',
    feeder_last_sync_at: '2026-07-22T10:00:00Z',
    feeder_last_run_status: 'succeeded',
    feeder_days_stale: 0,
    feeder_available: true,
    live_upstream_reconciliation: false,
    note: 'Snapshot of the canonical Supabase mirror.',
  },
  reconciliation: {
    licensor_count: 1, active_licensor_count: 1,
    property_count: 2, active_property_count: 2,
    properties_with_licensor: 1, orphan_property_count: 1,
    expected_orphan_count_is_zero: false, partition_reconciles: true,
  },
  licensors: [
    {
      id: 'l-marvel', name: 'Marvel', code: 'MRV', status: 'active',
      property_count: 1, source_refs: [], plm_context: [],
      properties: [
        { id: 'p-avengers', name: 'Avengers', code: 'AVG', status: 'active', character_count: 5, source_refs: [], plm_context: [] },
      ],
    },
  ],
  orphan_properties: [
    { id: 'o-1', name: 'Mystery IP', code: 'MYS', status: 'active', licensor_id: null, character_count: 0, source_refs: [], plm_context: [] },
  ],
  next_cursor: null, page_size: 200,
}

function makeClient(payload: LicensorTreeResult): ApiClient {
  return { rpc: vi.fn(async () => ({ data: payload, error: null })) } as unknown as ApiClient
}

function makeFailingClient(message: string): ApiClient {
  return { rpc: vi.fn(async () => ({ data: null, error: new Error(message) })) } as unknown as ApiClient
}

describe('PropertyTable', () => {
  it('reads the existing tree contract rather than a separate property RPC', async () => {
    const client = makeClient(fixture)
    render(<PropertyTable client={client} />)
    await waitFor(() => expect(client.rpc).toHaveBeenCalled())
    expect(vi.mocked(client.rpc).mock.calls[0][0]).toBe('db_data_admin_licensor_property_tree')
  })

  it('counts every property, orphans included', async () => {
    render(<PropertyTable client={makeClient(fixture)} />)
    expect(await screen.findByText('2 of 2 properties')).toBeInTheDocument()
  })

  it('does not present licensing relationships on the status-only surface', async () => {
    render(<PropertyTable client={makeClient(fixture)} />)
    expect(await screen.findByText('2 of 2 properties')).toBeInTheDocument()
    expect(screen.queryByText('Marvel')).not.toBeInTheDocument()
    expect(screen.queryByText(/no licensor/i)).not.toBeInTheDocument()
    expect(propertyColumns.map(column => column.name)).toEqual(['Property', 'Code', 'Status'])
  })

  it('hides inactive Properties by default and reveals them on request', async () => {
    const inactiveFixture: LicensorTreeResult = {
      ...fixture,
      licensors: [{
        ...fixture.licensors[0],
        properties: [...fixture.licensors[0].properties, {
          id: 'p-lapsed', name: 'Lapsed IP', code: 'LPS', status: 'inactive',
          character_count: 0, source_refs: [], plm_context: [], updated_at: '2026-08-20T09:00:00Z',
        }],
      }],
    }
    const client = makeClient(inactiveFixture)
    render(<PropertyTable client={client} />)
    expect(await screen.findByText('2 of 2 properties')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Include inactive'))
    expect(await screen.findByText('3 of 3 properties')).toBeInTheDocument()
    expect(vi.mocked(client.rpc).mock.calls[1][1]).toMatchObject({ p_include_inactive: true })
  })

  it('stays silent about orphans when there are none', async () => {
    render(<PropertyTable client={makeClient({ ...fixture, orphan_properties: [] })} />)
    expect(await screen.findByText('1 of 1 properties')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the access-denied panel instead of an empty table', async () => {
    render(<PropertyTable client={makeFailingClient('permission denied for function')} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied')
  })

  it('surfaces other load failures as an inline error', async () => {
    render(<PropertyTable client={makeFailingClient('connection reset')} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('connection reset')
  })
})
