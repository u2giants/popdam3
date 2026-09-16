import { describe, expect, it } from 'vitest'
import type { ScrapedPropertyRow } from './lib/data-admin'
import { explainScrapedProperty } from './scraped-property-explanations'

const row = (overrides: Partial<ScrapedPropertyRow> = {}): ScrapedPropertyRow => ({
  id: 'row-1', row_key: 'row-1', presentation_licensor_key: 'disney',
  presentation_licensor_name: 'Disney - Creative (DCP Vault)', source_system: 'disney_dcp',
  source_table: 'plm.dcp_property', source_property_id: 'property-1', source_property_name: 'Fixture',
  display_label: 'Fixture', source_status: 'supported_core_ownership',
  provenance_kind: 'dcp_property_licensor_resolution', latest_seen_at: null, capture_marker: null,
  source_purpose: 'Creative (DCP Vault)', review_reason: 'old', evidence_basis: 'old', review_guidance: 'old',
  ...overrides,
})

describe('explainScrapedProperty', () => {
  it('explains a DCP conflict, its origin, and the exact Licensing decision', () => {
    const result = explainScrapedProperty(row({ source_status: 'authority_conflict', presentation_licensor_key: 'dcp-vault-authority-conflict' }))
    expect(result.review_reason).toContain('Two approved DCP Vault decisions')
    expect(result.evidence_basis).toContain('exact source property ID')
    expect(result.review_guidance).toContain('Disney, Lucasfilm / Star Wars, or Ignore')
  })

  it('explains why an unresolved DCP property has no studio', () => {
    const result = explainScrapedProperty(row({ source_status: 'unresolved', presentation_licensor_key: 'dcp-vault-unresolved' }))
    expect(result.review_reason).toContain('no approved decision')
    expect(result.evidence_basis).toContain('no current approved studio-classification decision')
  })

  it('explains the direct Disney and Lucasfilm OPA overlap', () => {
    const result = explainScrapedProperty(row({ source_status: 'scope_conflict', presentation_licensor_key: 'opa-scope-conflict', source_table: 'plm.opa_property' }))
    expect(result.review_reason).toContain('both the Disney and Lucasfilm / Star Wars parent selections')
    expect(result.evidence_basis).toContain('both parent-selection routes')
    expect(result.review_guidance).toContain('or both')
  })

  it('states why a DCP Marvel tag is not Marvel Creative authority', () => {
    const result = explainScrapedProperty(row({ presentation_licensor_key: 'dcp-vault-non-authoritative-marvel-tag', source_table: 'plm.marvel_dcp_property' }))
    expect(result.review_reason).toContain('accepted only from ASGARD')
    expect(result.evidence_basis).toContain('DCP Vault mixed-guide metadata')
    expect(result.review_guidance).toContain('keep this DCP record out of Marvel Creative')
  })

  it('leaves all review fields blank when no problem exists', () => {
    const result = explainScrapedProperty(row())
    expect(result).toEqual({ review_reason: '', evidence_basis: '', review_guidance: '' })
  })
})
