import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScrapedPropertiesTable } from './ScrapedPropertiesTable'
import {
  groupScrapedInventory,
  loadScrapedInventory,
  type ApiClient,
  type ScrapedInventoryKind,
  type ScrapedInventoryRow,
} from './lib/data-admin'
import { scrapedInventoryColumns } from './scraped-properties-columns'

const row = (
  key: string,
  licensor: string,
  purpose: 'Creative' | 'Submissions' = 'Creative',
  entityKind: ScrapedInventoryKind = 'property',
  overrides: Partial<ScrapedInventoryRow> = {},
): ScrapedInventoryRow => ({
  id: key,
  row_key: key,
  entity_kind: entityKind,
  licensor_key: licensor.toLowerCase().replaceAll(' ', '-'),
  licensor_name: licensor,
  licensor_group_key: licensor.toLowerCase().replaceAll(' ', '-'),
  licensor_group_name: licensor,
  source_purpose: purpose,
  display_label: `${licensor} ${entityKind}`,
  source_system: licensor === 'Star Wars' ? 'lucasfilm_dcpvault' : `${licensor.toLowerCase()}_source`,
  source_table: 'plm.source_inventory',
  source_id: key,
  source_status: null,
  latest_seen_at: null,
  capture_marker: null,
  mapping_state: entityKind === 'property' && purpose === 'Creative' ? 'unmapped' : null,
  ...overrides,
})

describe('ScrapedPropertiesTable', () => {
  it('shows inventory columns only and keeps the Property unmapped indicator', () => {
    expect(scrapedInventoryColumns('property').map(column => column.name)).toEqual([
      'Property', 'Mapping', 'Source system', 'Source ID', 'Source status', 'Source table', 'Latest seen', 'Capture marker',
    ])
    expect(scrapedInventoryColumns('character')[0].name).toBe('Character')
    expect(scrapedInventoryColumns('style_guide')[0].name).toBe('Style Guide')
  })

  it('keeps Disney, Marvel, and Star Wars separate with two purpose sections each', () => {
    const groups = groupScrapedInventory([
      row('d1', 'Disney'),
      row('d2', 'Disney', 'Submissions'),
      row('m1', 'Marvel'),
      row('s1', 'Star Wars'),
    ])
    expect(groups.map(group => group.name)).toEqual(['Disney', 'Marvel', 'Star Wars'])
    expect(groups[0].creative).toHaveLength(1)
    expect(groups[0].submissions).toHaveLength(1)
    expect(groups[1].submissions).toHaveLength(0)
  })

  it('groups portal-named rows by the canonical licensor group, not label text', () => {
    const groups = groupScrapedInventory([
      row('d-opa', 'Disney - Submissions (OPA)', 'Submissions', 'property', { licensor_key: 'disney-opa', licensor_group_key: 'disney', licensor_group_name: 'Disney' }),
      row('d-dcp', 'Disney - Creative (DCP Vault)', 'Creative', 'property', { licensor_key: 'disney', licensor_group_key: 'disney', licensor_group_name: 'Disney' }),
      row('m-dcp', 'DCP Vault - Creative (authoritative Marvel scope)', 'Creative', 'property', { licensor_key: 'marvel', licensor_group_key: 'marvel', licensor_group_name: 'Marvel' }),
      row('m-opa', 'Marvel - Submissions (OPA)', 'Submissions', 'property', { licensor_key: 'marvel-opa', licensor_group_key: 'marvel', licensor_group_name: 'Marvel' }),
      row('lf', 'Lucasfilm / Star Wars - Creative (DCP Vault)', 'Creative', 'property', { licensor_key: 'lucasfilm-star-wars', licensor_group_key: 'lucasfilm-star-wars', licensor_group_name: 'Lucasfilm / Star Wars' }),
      row('n-sub', 'NBCUniversal - Submissions (Product Submissions picker)', 'Submissions', 'property', { licensor_key: 'nbcuniversal', licensor_group_key: 'nbcuniversal', licensor_group_name: 'NBCUniversal' }),
    ])
    expect(groups.map(group => group.name)).toEqual(['Disney', 'Lucasfilm / Star Wars', 'Marvel', 'NBCUniversal'])
    expect(groups.map(group => [group.creative.length, group.submissions.length])).toEqual([[1, 1], [1, 0], [1, 1], [0, 1]])
    expect(groups.some(group => /DCP|OPA/.test(group.name))).toBe(false)
  })

  it('puts unresolved and conflicting licensors in one trailing group', () => {
    const groups = groupScrapedInventory([
      row('conflict', 'OPA - Submissions (scope conflict)', 'Submissions', 'property', { licensor_key: 'opa-scope-conflict', licensor_group_key: 'unresolved', licensor_group_name: 'Licensor not yet determined' }),
      row('tag', 'DCP Vault - Creative (non-authoritative Marvel tag)', 'Creative', 'property', { licensor_key: 'dcp-vault-non-authoritative-marvel-tag', licensor_group_key: 'unresolved', licensor_group_name: 'Licensor not yet determined' }),
      row('w', 'WWE - Creative', 'Creative', 'property', { licensor_key: 'wwe-creative', licensor_group_key: 'wwe', licensor_group_name: 'WWE' }),
      row('a', 'Coca-Cola - Creative', 'Creative', 'property', { licensor_key: 'coca-cola-creative', licensor_group_key: 'coca-cola', licensor_group_name: 'Coca-Cola' }),
    ])
    expect(groups.map(group => group.key)).toEqual(['coca-cola', 'wwe', 'unresolved'])
    expect(groups[2].name).toBe('Licensor not yet determined')
    expect(groups[2].creative).toHaveLength(1)
    expect(groups[2].submissions).toHaveLength(1)
  })

  it('loads every page from the selected raw inventory contract', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { rows: [row('1', 'Disney')], next_cursor: 'next' }, error: null })
      .mockResolvedValueOnce({ data: { rows: [row('2', 'Star Wars')], next_cursor: null }, error: null })
    const rows = await loadScrapedInventory({ rpc } as unknown as ApiClient, 'property')
    expect(rows).toHaveLength(2)
    expect(rpc).toHaveBeenNthCalledWith(1, 'db_data_admin_scraped_source_inventory', {
      p_entity_kind: 'property', p_search: null, p_cursor: null, p_page_size: 1000,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'db_data_admin_scraped_source_inventory', {
      p_entity_kind: 'property', p_search: null, p_cursor: 'next', p_page_size: 1000,
    })
  })

  it('renders Properties, Characters, and Style Guides tabs and only Creative/Submissions sections', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { rows: [row('1', 'Disney')], next_cursor: null }, error: null }) } as unknown as ApiClient
    render(<ScrapedPropertiesTable client={client} />)
    await waitFor(() => expect(screen.getByText('1 of 1 scraped properties')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Properties' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Characters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Style Guides' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Disney' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Creative' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Submissions' })).toBeInTheDocument()
    expect(screen.queryByText(/review reason/i)).not.toBeInTheDocument()
  })

  it('requests the Character inventory when that tab is selected', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rows: [], next_cursor: null }, error: null })
    render(<ScrapedPropertiesTable client={{ rpc } as unknown as ApiClient} />)
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }))
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('db_data_admin_scraped_source_inventory', expect.objectContaining({ p_entity_kind: 'character' })))
  })

  it('does not let a slow prior tab replace the selected tab', async () => {
    let resolveProperties!: (value: unknown) => void
    let resolveCharacters!: (value: unknown) => void
    const propertyResponse = new Promise(resolve => { resolveProperties = resolve })
    const characterResponse = new Promise(resolve => { resolveCharacters = resolve })
    const rpc = vi.fn((_name: string, args: { p_entity_kind: ScrapedInventoryKind }) => (
      args.p_entity_kind === 'property' ? propertyResponse : characterResponse
    ))
    render(<ScrapedPropertiesTable client={{ rpc } as unknown as ApiClient} />)
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
    resolveCharacters({ data: { rows: [row('character', 'Disney', 'Creative', 'character')], next_cursor: null }, error: null })
    await waitFor(() => expect(screen.getByText('1 of 1 scraped characters')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Disney' })).toBeInTheDocument()
    resolveProperties({ data: { rows: [row('property', 'Marvel')], next_cursor: null }, error: null })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Marvel' })).not.toBeInTheDocument())
    expect(screen.getByText('1 of 1 scraped characters')).toBeInTheDocument()
  })

  it('shows a scoped access denial', async () => {
    const client = { rpc: async () => ({ data: null, error: new Error('licensing manager access required') }) } as unknown as ApiClient
    render(<ScrapedPropertiesTable client={client} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Licensing Manager')
  })
})
