import type { ScrapedPropertyRow } from './lib/data-admin'

type ReviewExplanation = Pick<ScrapedPropertyRow, 'review_reason' | 'evidence_basis' | 'review_guidance'>

const noReviewNeeded: ReviewExplanation = {
  review_reason: '',
  evidence_basis: '',
  review_guidance: '',
}

export function explainScrapedProperty(row: ScrapedPropertyRow): ReviewExplanation {
  if (row.presentation_licensor_key === 'dcp-vault-non-authoritative-marvel-tag') {
    return {
      review_reason: 'This record came from DCP Vault and carries a Marvel tag, but Marvel Creative properties are accepted only from ASGARD. It cannot be treated as a Marvel Creative property.',
      evidence_basis: 'The Marvel label came only from DCP Vault mixed-guide metadata. No Marvel ASGARD property record supports this row.',
      review_guidance: 'Do not classify this row as Marvel Creative. If the property exists in ASGARD, use that ASGARD record; otherwise keep this DCP record out of Marvel Creative.',
    }
  }

  if (row.source_status === 'authority_conflict' || row.presentation_licensor_key === 'dcp-vault-authority-conflict') {
    return {
      review_reason: 'Two approved DCP Vault decisions assign this exact property to different studios, so the page cannot place it under one studio.',
      evidence_basis: 'The conflict came from the approved DCP Vault classification history for this exact source property ID; more than one studio assignment is currently approved.',
      review_guidance: 'Licensing must compare those DCP Vault decisions and approve one final studio: Disney, Lucasfilm / Star Wars, or Ignore. Do not decide from the property name or landing table.',
    }
  }

  if (row.source_status === 'scope_conflict' || row.presentation_licensor_key === 'opa-scope-conflict') {
    return {
      review_reason: 'Disney OPA returned the same Property ID under both the Disney and Lucasfilm / Star Wars parent selections. The page cannot tell whether both placements are intentional.',
      evidence_basis: 'The overlap came directly from the OPA scrape: this exact Property ID appeared in both parent-selection routes.',
      review_guidance: 'Licensing must confirm whether the property belongs under Disney, Lucasfilm / Star Wars, or both, then approve the exact OPA placement. Do not decide from the property name.',
    }
  }

  if (row.source_status === 'contract_opa_conflict' || row.presentation_licensor_key === 'dcp-contract-opa-conflict') {
    return {
      review_reason: 'The signed contract and the captured Disney OPA scope disagree about which studio this property belongs to, so the page cannot place it under one studio.',
      evidence_basis: 'The disagreement is between the authoritative signed-contract assertion and the latest directly captured OPA scope reached through the approved exact OPA Property ID link.',
      review_guidance: 'Licensing must compare the contract assertion against the OPA scope and approve one studio. Do not decide from the property name or the landing table.',
    }
  }

  if (row.source_status === 'opa_scope_conflict' || row.presentation_licensor_key === 'dcp-opa-scope-conflict') {
    return {
      review_reason: 'The approved OPA Property IDs mapped to this DCP property carry conflicting direct scopes, so the page cannot tell which placement is intended.',
      evidence_basis: 'The conflict came from the directly captured OPA scopes of the exact OPA Property IDs linked by the approved DCP-to-OPA resolution.',
      review_guidance: 'Licensing must review the concrete OPA assertions and the named style guides, then approve the exact OPA placement.',
    }
  }

  if (row.source_status === 'ambiguous_crossover') {
    return {
      review_reason: 'The approved Disney OPA classification records disagree about which studio owns this property, so the page cannot place it confidently.',
      evidence_basis: 'The disagreement came from multiple approved OPA studio-classification records for this exact Property ID.',
      review_guidance: 'Licensing must check the property in Disney OPA and approve Disney, Marvel, Lucasfilm / Star Wars, Pixar, or the correct combination.',
    }
  }

  const unresolved = row.source_status === 'unresolved' || row.source_status == null

  if (unresolved && row.source_table === 'plm.opa_property') {
    return {
      review_reason: 'The Disney OPA scrape found this property, but no approved Disney OPA parent selection currently places it under a studio.',
      evidence_basis: 'There is an OPA source record for this exact Property ID, but no current approved parent-route membership or studio-classification decision for it.',
      review_guidance: 'Licensing must find this Property ID in Disney OPA and approve Disney, Marvel, Lucasfilm / Star Wars, Pixar, or the correct combination of parent selections.',
    }
  }

  if ((unresolved && /dcp/i.test(row.source_table)) || row.presentation_licensor_key === 'dcp-vault-unresolved') {
    return {
      review_reason: 'The DCP Vault scrape found this property, but no approved decision says whether it belongs to Disney, Lucasfilm / Star Wars, or should be ignored.',
      evidence_basis: 'There is a DCP Vault source record for this exact property ID, but no current approved studio-classification decision for it.',
      review_guidance: 'Licensing must inspect the original DCP Vault record and choose Disney, Lucasfilm / Star Wars, or Ignore. Do not decide from the property name or landing table.',
    }
  }

  if (unresolved) {
    const source = row.source_system.replaceAll('_', ' ')
    return {
      review_reason: `The ${source} scrape found this property, but no approved licensor or studio assignment currently places it in a review group.`,
      evidence_basis: `There is a source record for this exact property ID, but no current approved classification decision for it.`,
      review_guidance: 'Licensing must check the original source record and approve the correct licensor or studio. Do not decide from the property name or landing table.',
    }
  }

  if (row.source_table === 'plm.opa_property') {
    return noReviewNeeded
  }

  if (row.source_table === 'plm.marvel_asgard_style_guide') {
    return noReviewNeeded
  }

  if (row.source_purpose === 'Creative (DCP Vault)') {
    return noReviewNeeded
  }

  return noReviewNeeded
}
