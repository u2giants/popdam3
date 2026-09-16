import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataAdmin } from './DataAdmin'
import type { ApiClient } from './lib/data-admin'
import { formatEnvironmentLabel } from './lib/presentation'

afterEach(cleanup)

/**
 * Until this file existed, nothing rendered <DataAdmin> itself — every test in
 * DataAdmin.test.tsx exercises the exported sub-components (FilterHeader, the
 * status editor) instead. That gap is exactly how the workspace bar could sit in
 * main hardcoded to the literal string "Preview database" and be shipped to a
 * production admin tool without a single test objecting.
 *
 * These tests therefore assert the rendered bar, not the helper in isolation.
 */

/** Enough of the Supabase client for the mount effect to succeed and reach the bar. */
function stubClient(): ApiClient {
  return { rpc: vi.fn(async () => ({ data: null, error: null })) } as unknown as ApiClient
}

async function renderBar(supabaseUrl: string) {
  render(
    <DataAdmin
      client={stubClient()}
      email="signed-in-administrator"
      environmentLabel={formatEnvironmentLabel(supabaseUrl)}
      onSignOut={() => {}}
    />,
  )
  return await screen.findByText('signed-in-administrator')
}

describe('DataAdmin workspace bar names the database it is really connected to', () => {
  it('says Production database when wired to the shared production project', async () => {
    const bar = (await renderBar('https://qsllyeztdwjgirsysgai.supabase.co')).closest('div')
    expect(bar).toHaveTextContent('Production database')
  })

  it('never renders the word Preview anywhere on a production-connected instance', async () => {
    const bar = (await renderBar('https://qsllyeztdwjgirsysgai.supabase.co')).closest('div')
    expect(bar?.textContent ?? '').not.toMatch(/preview/i)
  })

  it('still says Preview database on the preview branch project', async () => {
    const bar = (await renderBar('https://rjyboqwcdzcocqgmsyel.supabase.co')).closest('div')
    expect(bar).toHaveTextContent('Preview database')
  })

  it('shows an unrecognized project as unrecognized instead of guessing', async () => {
    const bar = (await renderBar('https://someotherref123.supabase.co')).closest('div')
    expect(bar).toHaveTextContent('Unrecognized database (someotherref123)')
  })
})
