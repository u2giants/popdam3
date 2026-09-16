import { describe, expect, it } from 'vitest'
import { flattenProperties, formatDivision, formatPlmContext, formatSourceRefs } from './property-rows'
import type { LoadedTree } from './data-admin'

const tree: Pick<LoadedTree, 'licensors' | 'orphanProperties'> = {
  licensors: [
    {
      id: 'l-marvel', name: 'Marvel', code: 'MRV', status: 'active',
      property_count: 2, source_refs: [], plm_context: [],
      properties: [
        {
          id: 'p-avengers', name: 'Avengers', code: 'AVG', status: 'active', character_count: 5,
          source_refs: [{ source_system: 'designflow_plm', source_table: 'merchGroup', source_id: 'x', source_code: 'AVG', source_name: null }],
          plm_context: [
            { plm_id: 'pa', division_code: '1', division_name: 'POP Lic', division_external_code: 'CW001', mg_code: 'AVG', mg_type: 'property', mg_category: 'licensed' },
            { plm_id: 'pa8', division_code: '8', division_name: 'Spruce Lic', division_external_code: 'SP001', mg_code: 'AVG', mg_type: 'property', mg_category: 'licensed' },
          ],
        },
        {
          id: 'p-spider', name: 'Spider-Man', code: null, status: 'potential', character_count: 0,
          source_refs: [], plm_context: [],
        },
      ],
    },
    {
      id: 'l-disney', name: 'Disney', code: 'DS', status: 'active',
      property_count: 0, source_refs: [], plm_context: [], properties: [],
    },
  ],
  orphanProperties: [
    { id: 'o-1', name: 'Mystery IP', code: 'MYS', status: 'active', licensor_id: null, character_count: 0, source_refs: [], plm_context: [] },
  ],
}

describe('flattenProperties', () => {
  it('emits one row per property, carrying its licensor', () => {
    const rows = flattenProperties(tree)
    expect(rows.map(row => row.id)).toEqual(['p-avengers', 'p-spider', 'o-1'])
    expect(rows[0].licensor_name).toBe('Marvel')
    expect(rows[0].licensor_code).toBe('MRV')
    expect(rows[0].character_count).toBe(5)
    expect(rows[1].code).toBeNull()
    expect(rows[1].status).toBe('potential')
  })

  it('includes orphan properties, marked and parented to "(no licensor)"', () => {
    const orphan = flattenProperties(tree).find(row => row.id === 'o-1')
    expect(orphan?.is_orphan).toBe(true)
    expect(orphan?.licensor_name).toBe('(no licensor)')
    expect(orphan?.licensor_code).toBeNull()
  })

  it('never drops a property, so the row count matches the tree', () => {
    const nested = tree.licensors.reduce((total, licensor) => total + licensor.properties.length, 0)
    expect(flattenProperties(tree)).toHaveLength(nested + tree.orphanProperties.length)
  })

  it('carries updated_at as the status-change concurrency token', () => {
    const rows = flattenProperties({
      ...tree,
      licensors: tree.licensors.map(licensor => ({
        ...licensor,
        properties: licensor.properties.map(property => ({ ...property, updated_at: '2026-08-20T12:00:00Z' })),
      })),
    })
    expect(rows.find(row => !row.is_orphan)?.updated_at).toBe('2026-08-20T12:00:00Z')
    expect(rows.find(row => row.is_orphan)?.updated_at).toBeNull()
  })

  it('returns no rows for an empty tree', () => {
    expect(flattenProperties({ licensors: [], orphanProperties: [] })).toEqual([])
  })
})

describe('provenance formatting', () => {
  it('summarises source references', () => {
    expect(formatSourceRefs(tree.licensors[0].properties[0])).toBe('designflow_plm/merchGroup · AVG')
  })

  it('names each PLM division instead of printing its raw id', () => {
    expect(formatPlmContext(tree.licensors[0].properties[0])).toBe('POP Lic (CW001) · AVG, Spruce Lic (SP001) · AVG')
  })

  it('never prints the fixed mg_type literal', () => {
    expect(formatPlmContext(tree.licensors[0].properties[0])).not.toContain('property')
  })

  it('renders empty provenance as an empty string, not "undefined"', () => {
    expect(formatSourceRefs(tree.licensors[0].properties[1])).toBe('')
    expect(formatPlmContext(tree.licensors[0].properties[1])).toBe('')
  })
})

describe('formatDivision', () => {
  const base = { plm_id: 'p', mg_code: 'X', mg_type: 'property', mg_category: null }

  it('pairs the division name with its external company code', () => {
    expect(formatDivision({ ...base, division_code: '1', division_name: 'POP Lic', division_external_code: 'CW001' })).toBe('POP Lic (CW001)')
  })

  it('falls back to the raw PLM id when the division has no lookup row', () => {
    expect(formatDivision({ ...base, division_code: '99', division_name: null, division_external_code: null })).toBe('99')
  })

  it('shows whichever label exists when only one is present', () => {
    expect(formatDivision({ ...base, division_code: '1', division_name: 'POP Lic', division_external_code: null })).toBe('POP Lic')
    expect(formatDivision({ ...base, division_code: '1', division_name: null, division_external_code: 'CW001' })).toBe('CW001')
  })

  it('renders an em dash rather than nothing when the entry names no division at all', () => {
    expect(formatDivision({ ...base, division_code: null, division_name: null, division_external_code: null })).toBe('—')
  })
})
