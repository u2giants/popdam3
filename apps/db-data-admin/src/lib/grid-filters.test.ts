import { describe, expect, it } from 'vitest'
import type { AdminRow } from './data-admin'
import {
  BLANK_LABEL,
  BLANK_VALUE,
  formatFilterOptionLabel,
  getCellDisplayValue,
  getDistinctColumnValues,
  rowMatchesFilters,
  setMatch,
  textMatch,
  toggleSetFilterValue,
} from './grid-filters'

const rows: AdminRow[] = [
  { id: '1', display_name: 'Acme Corp', status: 'active', plm_linked: true, plm_status: 'ACTIVE' },
  { id: '2', display_name: 'Beta LLC', status: 'inactive', plm_linked: false, plm_status: null },
  { id: '3', display_name: '', status: null, plm_linked: true, plm_status: 'INACTIVE' },
  { id: '4', display_name: 'Acme West', status: 'active', plm_linked: true, plm_status: null },
  { id: '5', display_name: null as unknown as string, status: 'active', plm_linked: true, plm_status: 'ACTIVE' },
]

describe('getCellDisplayValue / plm_display', () => {
  it('maps PLM to the same labels the grid shows', () => {
    expect(getCellDisplayValue(rows[0]!, 'plm_display')).toBe('Active')
    expect(getCellDisplayValue(rows[1]!, 'plm_display')).toBe('Not linked')
    expect(getCellDisplayValue(rows[2]!, 'plm_display')).toBe('Inactive')
    expect(getCellDisplayValue(rows[3]!, 'plm_display')).toBe('Unknown')
  })

  it('treats null and empty string as blank for ordinary columns', () => {
    expect(getCellDisplayValue(rows[2]!, 'display_name')).toBe(BLANK_VALUE)
    expect(getCellDisplayValue(rows[5 - 1]!, 'display_name')).toBe(BLANK_VALUE)
    expect(getCellDisplayValue(rows[2]!, 'status')).toBe(BLANK_VALUE)
  })
})

// Most records carry only the canonical `name`; `display_name` is an optional
// override. The Name column renders `name_display`, which must coalesce the two
// exactly as the list RPC's sort key does.
const nameRows: AdminRow[] = [
  { id: 'a', name: 'Aldi', display_name: 'Aldi Süd' },
  { id: 'b', name: '4SGM', display_name: null as unknown as string },
  { id: 'c', name: 'Zeta Imports' },
  { id: 'd', name: 'Blank Co', display_name: '' },
  { id: 'e', name: null as unknown as string },
]

describe('getCellDisplayValue / name_display', () => {
  it('prefers the display_name override when one is set', () => {
    expect(getCellDisplayValue(nameRows[0]!, 'name_display')).toBe('Aldi Süd')
  })

  it('falls back to the canonical name when the override is null or empty', () => {
    expect(getCellDisplayValue(nameRows[1]!, 'name_display')).toBe('4SGM')
    expect(getCellDisplayValue(nameRows[2]!, 'name_display')).toBe('Zeta Imports')
    expect(getCellDisplayValue(nameRows[3]!, 'name_display')).toBe('Blank Co')
  })

  it('is blank only when neither name is present', () => {
    expect(getCellDisplayValue(nameRows[4]!, 'name_display')).toBe(BLANK_VALUE)
  })

  it('filters and lists distinct values on the effective name', () => {
    expect(getDistinctColumnValues(nameRows, 'name_display')).toEqual([
      BLANK_VALUE, '4SGM', 'Aldi Süd', 'Blank Co', 'Zeta Imports',
    ])
    expect(textMatch(nameRows[1]!, { name_display: '4sg' })).toBe(true)
    expect(setMatch(nameRows[2]!, { name_display: new Set(['Zeta Imports']) })).toBe(true)
  })
})

describe('getDistinctColumnValues', () => {
  it('derives sorted distinct display values including an explicit blank entry', () => {
    const names = getDistinctColumnValues(rows, 'display_name')
    expect(names[0]).toBe(BLANK_VALUE)
    expect(names).toEqual([BLANK_VALUE, 'Acme Corp', 'Acme West', 'Beta LLC'])
    expect(formatFilterOptionLabel(BLANK_VALUE)).toBe(BLANK_LABEL)
  })

  it('uses displayed PLM labels, not raw status fields', () => {
    expect(getDistinctColumnValues(rows, 'plm_display')).toEqual([
      'Active',
      'Inactive',
      'Not linked',
      'Unknown',
    ])
  })

  it('reads from the full row set (caller supplies unfiltered rows)', () => {
    // Even if only "active" rows would be visible after other filters, distincts
    // are computed from whatever list is passed — DataAdmin passes full `rows`.
    const onlyActive = rows.filter(r => r.status === 'active')
    expect(getDistinctColumnValues(onlyActive, 'status')).toEqual(['active'])
    expect(getDistinctColumnValues(rows, 'status')).toEqual([BLANK_VALUE, 'active', 'inactive'])
  })
})

describe('textMatch + setMatch combined (Multi Filter)', () => {
  it('text filter is case-insensitive substring on display values', () => {
    expect(textMatch(rows[0]!, { display_name: 'acme' })).toBe(true)
    expect(textMatch(rows[1]!, { display_name: 'acme' })).toBe(false)
    expect(textMatch(rows[0]!, { plm_display: 'act' })).toBe(true)
    expect(textMatch(rows[1]!, { plm_display: 'act' })).toBe(false)
    expect(textMatch(rows[0]!, { display_name: '' })).toBe(true)
  })

  it('set filter: missing selection means all; empty set means none', () => {
    expect(setMatch(rows[0]!, {})).toBe(true)
    expect(setMatch(rows[0]!, { status: undefined })).toBe(true)
    expect(setMatch(rows[0]!, { status: null })).toBe(true)
    expect(setMatch(rows[0]!, { status: new Set() })).toBe(false)
    expect(setMatch(rows[0]!, { status: new Set(['active']) })).toBe(true)
    expect(setMatch(rows[1]!, { status: new Set(['active']) })).toBe(false)
    expect(setMatch(rows[2]!, { status: new Set([BLANK_VALUE]) })).toBe(true)
  })

  it('requires Text AND Set for every column', () => {
    const text = { display_name: 'Acme' }
    const set = { status: new Set(['active']) }
    expect(rowMatchesFilters(rows[0]!, text, set)).toBe(true) // Acme Corp + active
    expect(rowMatchesFilters(rows[3]!, text, set)).toBe(true) // Acme West + active
    expect(rowMatchesFilters(rows[1]!, text, set)).toBe(false) // Beta, no text match
    expect(rowMatchesFilters(rows[0]!, text, { status: new Set(['inactive']) })).toBe(false)
    expect(rowMatchesFilters(rows[0]!, { display_name: 'zzz' }, set)).toBe(false)
  })

  it('ANDs set filters across columns', () => {
    const set = {
      status: new Set(['active']),
      plm_display: new Set(['Active']),
    }
    expect(rowMatchesFilters(rows[0]!, {}, set)).toBe(true)
    expect(rowMatchesFilters(rows[3]!, {}, set)).toBe(false) // active but Unknown PLM
  })
})

describe('toggleSetFilterValue', () => {
  const all = ['a', 'b', 'c']

  it('starts from all values when inactive, and returns null when all selected', () => {
    expect(toggleSetFilterValue(null, all, 'b')).toEqual(new Set(['a', 'c']))
    expect(toggleSetFilterValue(new Set(['a', 'c']), all, 'b')).toBeNull()
  })

  it('adds a value into a partial selection', () => {
    expect(toggleSetFilterValue(new Set(['a']), all, 'b')).toEqual(new Set(['a', 'b']))
  })
})
