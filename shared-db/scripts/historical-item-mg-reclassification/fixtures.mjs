// Synthetic fixtures and a fake Postgres client.
//
// Everything here is invented. No licensed item identity, no real item number,
// no real description, and no production row appears in this file or in any
// test in this directory. The tests must pass offline with no secrets and no
// database, which is also what keeps them runnable in CI.

import { WRITABLE_FIELDS } from './lib/constants.mjs';

export const DIVISIONS = [
  { divCode_id: 1, external_divisoncode: 'EH001' },
  { divCode_id: 2, external_divisoncode: 'CW001' },
  { divCode_id: 9, external_divisoncode: 'EP001' },
];

// The taxonomy deliberately contains every trap the plan names: a duplicate
// level-3 code under two different parents, a retired level-3 code, a retired
// EP001 branch, and a row whose own two division encodings disagree.
export const MERCH_GROUPS = [
  { mg_id: 100, mg_code: 'A', mgTypeCode: '01', divisionCode_fk: 'EH001', divisionCode_id_fk: 1, parent_id: null, is_active: true },
  { mg_id: 110, mg_code: 'B', mgTypeCode: '02', divisionCode_fk: 'EH001', divisionCode_id_fk: 1, parent_id: 100, is_active: true },
  { mg_id: 120, mg_code: 'C', mgTypeCode: '03', divisionCode_fk: 'EH001', divisionCode_id_fk: 1, parent_id: 110, is_active: true },
  { mg_id: 130, mg_code: 'B2', mgTypeCode: '02', divisionCode_fk: 'EH001', divisionCode_id_fk: 1, parent_id: 100, is_active: true },
  // same level-3 code "C", different parent: only the exact chain may select it
  { mg_id: 140, mg_code: 'C', mgTypeCode: '03', divisionCode_fk: 'EH001', divisionCode_id_fk: 1, parent_id: 130, is_active: true },
  { mg_id: 200, mg_code: 'X', mgTypeCode: '03', divisionCode_fk: 'EH001', divisionCode_id_fk: 1, parent_id: 110, is_active: false },
  // EP001 has no active taxonomy at all
  { mg_id: 300, mg_code: 'A', mgTypeCode: '01', divisionCode_fk: 'EP001', divisionCode_id_fk: 9, parent_id: null, is_active: false },
  // the division-encoding trap: declared CW001, but the id points at EH001
  { mg_id: 400, mg_code: 'A', mgTypeCode: '01', divisionCode_fk: 'CW001', divisionCode_id_fk: 1, parent_id: null, is_active: true },
];

export function item(overrides = {}) {
  return {
    item_id_pk: 1,
    item_num_id: 'SYN-0001',
    created_time_date: '2024-01-15 10:00:00',
    div_code: 'EH001',
    div_code_fk: 1,
    udf_merchgroup01: 'OLD1',
    udf_merchgroup02: 'OLD2',
    udf_merchgroup03: 'OLD3',
    udf_merchgroup01_id: 900,
    udf_merchgroup02_id: 901,
    udf_merchgroup03_id: 902,
    ...overrides,
  };
}

export function sourceRow(overrides = {}) {
  return {
    company: 'SYNTHETIC',
    division: 'EH001',
    item_num: 'SYN-0001',
    matched_level: '3',
    proposed_mg01: 'A',
    proposed_mg02: 'B',
    proposed_mg03: 'C',
    match_basis: 'synthetic',
    evidence_support: 9,
    evidence_total: 10,
    evidence_share: 0.9,
    ...overrides,
  };
}

/** A manifest containing exactly the given candidate records. */
export const PREVIEW_REF = 'rjyboqwcdzcocqgmsyel';
export const PREVIEW_CLUSTER = '7000000000000000001';

export function manifestOf(candidates, binding = {}) {
  return {
    schema: 'historical-item-mg-reclassification/manifest@1',
    cutoff: '2025-05-14T00:00:00',
    target: 'preview',
    project_ref: PREVIEW_REF,
    cluster_system_identifier: PREVIEW_CLUSTER,
    ...binding,
    candidates,
    no_ops: [],
    abstentions: [],
  };
}

/**
 * A fake Postgres client. It understands only the statements this tooling
 * issues, and it implements the compare-and-swap predicate for real so that a
 * drifted row genuinely fails to update rather than being asserted about.
 */
export function fakeClient(rows, { merchGroups = MERCH_GROUPS, divisions = DIVISIONS } = {}) {
  const table = new Map(rows.map((r) => [Number(r.item_id_pk), { ...r }]));
  const log = [];
  return {
    log,
    table,
    async end() { log.push('END'); },
    async query(text, params) {
      const t = String(text).trim();
      if (t === 'BEGIN' || t === 'COMMIT' || t === 'ROLLBACK') { log.push(t); return { rows: [] }; }
      if (t.includes('pg_control_system')) {
        return { rows: [{ db: 'postgres', system_identifier: '7000000000000000001' }] };
      }
      if (t.includes('pg_get_functiondef')) {
        return { rows: [{ def: "create function api.resolve_item_mg_category(integer) ... '2025-05-14' ... udf_merchgroup01 ..." }] };
      }
      if (t.includes('divisionCode"')) return { rows: divisions.map((d) => ({ ...d })) };
      if (t.includes('core."merchGroup"')) return { rows: merchGroups.map((m) => ({ ...m })) };
      if (t.startsWith('update dflow."itemHeader"')) {
        log.push('UPDATE');
        let changed = 0;
        for (let i = 0; i < params.length; i += 13) {
          const [pk, b01, b02, b03, b01id, b02id, b03id, a01, a02, a03, a01id, a02id, a03id] =
            params.slice(i, i + 13);
          const row = table.get(Number(pk));
          if (!row) continue;
          const before = [b01, b02, b03, b01id, b02id, b03id];
          const ok = WRITABLE_FIELDS.every(
            (f, idx) => String(row[f] ?? '') === String(before[idx] ?? ''),
          );
          if (!ok) continue;
          row.udf_merchgroup01 = a01; row.udf_merchgroup02 = a02; row.udf_merchgroup03 = a03;
          row.udf_merchgroup01_id = a01id; row.udf_merchgroup02_id = a02id;
          row.udf_merchgroup03_id = a03id;
          changed += 1;
        }
        return { rows: [], rowCount: changed };
      }
      // The builder's cutoff-bounded sweep: every historical row, no id list.
      if (t.includes('created_time_date is not null')) {
        return { rows: [...table.values()].map((r) => ({ ...r })) };
      }
      if (t.includes('from dflow."itemHeader"')) {
        const ids = (params?.[0] ?? []).map(Number);
        const negated = t.includes('not (item_id_pk');
        const out = [...table.values()]
          .filter((r) => (negated ? !ids.includes(Number(r.item_id_pk)) : ids.includes(Number(r.item_id_pk))))
          .sort((a, b) => a.item_id_pk - b.item_id_pk)
          .map((r) => ({ ...r }));
        if (t.includes('for update')) log.push('LOCK');
        return { rows: out };
      }
      throw new Error(`fakeClient: unexpected statement: ${t.slice(0, 60)}`);
    },
  };
}

// A retired row that carries the division-encoding mismatch and shares its code
// with a clean active sibling. It must NOT poison that code.
export const RETIRED_CONFLICTED = {
  mg_id: 500, mg_code: 'C', mgTypeCode: '03', divisionCode_fk: 'EH001',
  divisionCode_id_fk: 2, parent_id: 110, is_active: false,
};
