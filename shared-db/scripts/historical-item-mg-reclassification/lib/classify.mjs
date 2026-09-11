// Pure candidate qualification. No database, no filesystem, no network.
//
// Everything that decides whether a historical item may be rewritten lives in
// this file so that it can be exercised exhaustively with synthetic fixtures
// (plan section 10). The database modules only fetch rows and hand them here.

import { ABSTAIN, HISTORICAL_CUTOFF_ISO, MG_TYPE_CODES, assertCutoff } from './constants.mjs';

const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const norm = (v) => (blank(v) ? null : String(v).trim());

/**
 * Build a lookup of `dflow."divisionCode"` rows.
 * @param {Array<{divCode_id:number, external_divisoncode:string|null}>} rows
 */
export function buildDivisionIndex(rows) {
  const byId = new Map();
  for (const r of rows) byId.set(Number(r.divCode_id), norm(r.external_divisoncode));
  return byId;
}

/**
 * Resolve an item's authoritative external division code.
 *
 * Neither encoding may be trusted alone (plan sections 6.3 and 9.2): numeric id
 * `2` is `CW001` in `dflow."divisionCode"` but is paired with `EH001` on 217
 * inactive `core."merchGroup"` rows. So when BOTH encodings are present they
 * must agree, and a disagreement is an abstention rather than a preference.
 *
 * @returns {{code: string}|{abstain: string}}
 */
export function resolveItemDivision(item, divisionIndex) {
  const direct = norm(item.div_code);
  const viaFk = item.div_code_fk === null || item.div_code_fk === undefined
    ? null
    : (divisionIndex.get(Number(item.div_code_fk)) ?? null);
  if (direct === null && viaFk === null) return { abstain: ABSTAIN.DIVISION_UNRESOLVED };
  if (direct !== null && viaFk !== null && direct !== viaFk) {
    return { abstain: ABSTAIN.DIVISION_ENCODING_CONFLICT };
  }
  return { code: direct ?? viaFk };
}

/**
 * Index `core."merchGroup"` by (division, mgTypeCode, mg_code).
 *
 * Rows whose own two division encodings disagree are retained but marked, so a
 * candidate that would depend on one abstains with a specific reason instead of
 * silently picking an encoding.
 */
export function buildTaxonomyIndex(mgRows, divisionIndex) {
  const byKey = new Map();
  const byId = new Map();
  for (const r of mgRows) {
    const declared = norm(r.divisionCode_fk);
    const viaFk = r.divisionCode_id_fk === null || r.divisionCode_id_fk === undefined
      ? null
      : (divisionIndex.get(Number(r.divisionCode_id_fk)) ?? null);
    const conflicted = declared !== null && viaFk !== null && declared !== viaFk;
    const entry = {
      mg_id: Number(r.mg_id),
      mg_code: norm(r.mg_code),
      mg_type: norm(r.mgTypeCode),
      division: declared,
      parent_id: r.parent_id === null || r.parent_id === undefined ? null : Number(r.parent_id),
      is_active: r.is_active === true,
      division_conflicted: conflicted,
    };
    byId.set(entry.mg_id, entry);
    const key = `${entry.division} ${entry.mg_type} ${entry.mg_code}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  }
  return { byKey, byId };
}

/**
 * Select exactly one active taxonomy row for a code, in a division, optionally
 * under an exact parent. Returns an abstention reason rather than a guess.
 *
 * The ordering of the checks matters: "the code exists here but under a
 * different parent" and "the code exists here but is retired" are different
 * facts for the owner, and collapsing them into TAXONOMY_MISSING would hide a
 * real taxonomy problem behind a shrug.
 */
export function selectTaxonomyRow(index, { division, mgType, code, parentId }) {
  const all = index.byKey.get(`${division} ${mgType} ${code}`) ?? [];
  if (all.length === 0) return { abstain: ABSTAIN.TAXONOMY_MISSING };
  const active = all.filter((r) => r.is_active);
  if (active.length === 0) return { abstain: ABSTAIN.TAXONOMY_INACTIVE };
  // A conflicted row is unusable, but it must not poison the code it shares with
  // a clean sibling. 217 RETIRED merchGroup rows carry the EH001/CW001 encoding
  // mismatch; testing "any row here is conflicted" made 1,200 of the 1,781
  // level-3 proposals abstain against live production for no real reason.
  const usable = active.filter((r) => !r.division_conflicted);
  if (usable.length === 0) return { abstain: ABSTAIN.TAXONOMY_DIVISION_CONFLICT };
  if (parentId === undefined) {
    if (usable.length > 1) return { abstain: ABSTAIN.TAXONOMY_AMBIGUOUS };
    return { row: usable[0] };
  }
  const underParent = usable.filter((r) => r.parent_id === parentId);
  if (underParent.length === 0) return { abstain: ABSTAIN.TAXONOMY_PARENT_MISMATCH };
  if (underParent.length > 1) return { abstain: ABSTAIN.TAXONOMY_AMBIGUOUS };
  return { row: underParent[0] };
}

/** Walk MG01 to MG02 to MG03 by parent_id inside one division. */
export function qualifyChain(index, division, codes) {
  const mg01 = selectTaxonomyRow(index, {
    division, mgType: MG_TYPE_CODES.mg01, code: codes.mg01,
  });
  if (mg01.abstain) return { abstain: mg01.abstain, level: 'MG01' };
  const mg02 = selectTaxonomyRow(index, {
    division, mgType: MG_TYPE_CODES.mg02, code: codes.mg02, parentId: mg01.row.mg_id,
  });
  if (mg02.abstain) return { abstain: mg02.abstain, level: 'MG02' };
  const mg03 = selectTaxonomyRow(index, {
    division, mgType: MG_TYPE_CODES.mg03, code: codes.mg03, parentId: mg02.row.mg_id,
  });
  if (mg03.abstain) return { abstain: mg03.abstain, level: 'MG03' };
  return { chain: { mg01: mg01.row, mg02: mg02.row, mg03: mg03.row } };
}

/**
 * Canonical text for a timestamp, so a manifest built from a `pg` Date and a
 * later re-read compare byte-for-byte instead of by locale formatting.
 */
export function canonicalTimestamp(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}

/** True when the production row's creation date puts it before the cutoff. */
export function isHistorical(createdTime, cutoff = HISTORICAL_CUTOFF_ISO) {
  assertCutoff(cutoff);
  if (blank(createdTime)) return null; // unknown, never "post-cutoff"
  // `pg` hands back a JS Date for timestamp columns; stringifying one produces
  // "Mon May 13 2024 ..." which the space-to-T rewrite below then corrupts into
  // an invalid date. That silently turned every live candidate into a
  // NULL_TARGET_DATE abstention on the first production run.
  const t = createdTime instanceof Date
    ? createdTime
    : new Date(String(createdTime).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return null;
  return t.getTime() < new Date(cutoff).getTime();
}

/**
 * Qualify one source proposal against live production.
 *
 * @param {object} args
 * @param {object} args.source        one row of the private level-3 output
 * @param {Array}  args.liveMatches   every live item row matching the source identity
 * @param {Map}    args.divisionIndex from buildDivisionIndex
 * @param {object} args.taxonomyIndex from buildTaxonomyIndex
 * @returns {{status:'candidate'|'noop'|'abstain', reason?:string, record?:object}}
 */
export function qualifyCandidate({
  source, liveMatches, divisionIndex, taxonomyIndex, cutoff = HISTORICAL_CUTOFF_ISO,
}) {
  assertCutoff(cutoff);
  const out = (status, reason, extra = {}) => ({
    status,
    reason,
    source_identity: {
      company: norm(source.company),
      division: norm(source.division),
      item_num: norm(source.item_num),
    },
    ...extra,
  });

  if (String(source.matched_level ?? '').trim() !== '3') return out('abstain', ABSTAIN.NOT_LEVEL_3);

  const codes = {
    mg01: norm(source.proposed_mg01),
    mg02: norm(source.proposed_mg02),
    mg03: norm(source.proposed_mg03),
  };
  if (!codes.mg01 || !codes.mg02 || !codes.mg03) return out('abstain', ABSTAIN.BLANK_PROPOSAL);

  const sourceDivision = norm(source.division);
  const itemNum = norm(source.item_num);
  if (!sourceDivision || !itemNum) return out('abstain', ABSTAIN.SOURCE_IDENTITY_BLANK);

  if (liveMatches.length === 0) return out('abstain', ABSTAIN.NO_LIVE_TARGET);
  if (liveMatches.length > 1) {
    return out('abstain', ABSTAIN.AMBIGUOUS_TARGET, { live_match_count: liveMatches.length });
  }

  const item = liveMatches[0];

  const historical = isHistorical(item.created_time_date, cutoff);
  if (historical === null) return out('abstain', ABSTAIN.NULL_TARGET_DATE);
  if (historical === false) return out('abstain', ABSTAIN.NON_HISTORICAL_TARGET);

  const division = resolveItemDivision(item, divisionIndex);
  if (division.abstain) return out('abstain', division.abstain);
  if (division.code !== sourceDivision) {
    return out('abstain', ABSTAIN.DIVISION_MISMATCH, {
      source_division: sourceDivision,
      live_division: division.code,
    });
  }

  const chain = qualifyChain(taxonomyIndex, division.code, codes);
  if (chain.abstain) return out('abstain', chain.abstain, { failed_level: chain.level });

  const before = {
    udf_merchgroup01: item.udf_merchgroup01 ?? null,
    udf_merchgroup02: item.udf_merchgroup02 ?? null,
    udf_merchgroup03: item.udf_merchgroup03 ?? null,
    udf_merchgroup01_id: item.udf_merchgroup01_id ?? null,
    udf_merchgroup02_id: item.udf_merchgroup02_id ?? null,
    udf_merchgroup03_id: item.udf_merchgroup03_id ?? null,
  };
  const after = {
    udf_merchgroup01: codes.mg01,
    udf_merchgroup02: codes.mg02,
    udf_merchgroup03: codes.mg03,
    udf_merchgroup01_id: chain.chain.mg01.mg_id,
    udf_merchgroup02_id: chain.chain.mg02.mg_id,
    udf_merchgroup03_id: chain.chain.mg03.mg_id,
  };

  const record = {
    item_id_pk: Number(item.item_id_pk),
    item_num_id: norm(item.item_num_id),
    resolved_division: division.code,
    created_time_date: canonicalTimestamp(item.created_time_date),
    before,
    after,
    taxonomy: {
      mg01: { mg_id: chain.chain.mg01.mg_id, parent_id: chain.chain.mg01.parent_id },
      mg02: { mg_id: chain.chain.mg02.mg_id, parent_id: chain.chain.mg02.parent_id },
      mg03: { mg_id: chain.chain.mg03.mg_id, parent_id: chain.chain.mg03.parent_id },
    },
    evidence: {
      level: 3,
      match_basis: norm(source.match_basis),
      support: source.evidence_support ?? null,
      total: source.evidence_total ?? null,
      share: source.evidence_share ?? null,
    },
  };

  const unchanged = Object.keys(before).every(
    (k) => String(before[k] ?? '') === String(after[k] ?? ''),
  );
  return out(unchanged ? 'noop' : 'candidate', null, { record });
}

/**
 * Reconciliation. Fails closed: any mismatch throws rather than warning.
 */
export function reconcile({ attempted, candidates, noops, abstentions }) {
  const sum = candidates + noops + abstentions;
  if (sum !== attempted) {
    throw new Error(
      `RECONCILIATION FAILED: attempted ${attempted} != candidates ${candidates} `
      + `+ no-ops ${noops} + abstentions ${abstentions} = ${sum}`,
    );
  }
  return true;
}
