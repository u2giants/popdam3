import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PropertyTable } from '../PropertyTable'
import type { ApiClient, LicensorTreeResult } from '../lib/data-admin'
import { vi } from 'vitest'

/**
 * Guards the fix for issue #1186.
 *
 * The jsdom suite aliases `@revolist/react-datagrid` to `src/test/revogrid-stub.tsx` so
 * the real Stencil web component cannot leave a debounced resize running past teardown
 * and fail the RUN while every test passes.
 *
 * If that alias is ever dropped from `vite.config.ts`, or the package is imported by a
 * path the alias does not cover, this test fails and says so — rather than the flake
 * quietly returning to a REQUIRED status check months later with nobody remembering why.
 */

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
    property_count: 1, active_property_count: 1,
    properties_with_licensor: 1, orphan_property_count: 0,
    expected_orphan_count_is_zero: true, partition_reconciles: true,
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
  orphan_properties: [],
  next_cursor: null, page_size: 200,
}

describe('the jsdom suite runs against the RevoGrid stub, not the real web component', () => {
  it('renders the stub in place of the real grid', async () => {
    const client = { rpc: vi.fn(async () => ({ data: fixture, error: null })) } as unknown as ApiClient
    render(<PropertyTable client={client} />)

    const stub = await screen.findByTestId('revogrid-stub')
    expect(stub).toBeInTheDocument()
  })

  it('still reports how many rows reached the grid, so row-count coverage is not lost', async () => {
    const client = { rpc: vi.fn(async () => ({ data: fixture, error: null })) } as unknown as ApiClient
    render(<PropertyTable client={client} />)

    const stub = await screen.findByTestId('revogrid-stub')
    expect(stub).toHaveAttribute('data-row-count', '1')
  })
})
