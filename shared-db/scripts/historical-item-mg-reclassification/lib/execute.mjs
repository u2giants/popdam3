// The guarded executor core.
//
// Everything here takes an injected client exposing `query(text, params)`, so
// the whole guard surface is exercised by synthetic tests with no database.
// No permanent table is created; no schema object is touched. This is data-only
// work under AGENTS.md section 0.0-B.

import { ABSTAIN, HISTORICAL_CUTOFF_ISO, WRITABLE_FIELDS, assertCutoff } from './constants.mjs';
import { buildDivisionIndex, buildTaxonomyIndex, canonicalTimestamp, isHistorical, qualifyChain, resolveItemDivision } from './classify.mjs';
import {
  assertAuthorization, assertManifestBoundToTarget, assertManifestWritable, manifestDigest,
} from './manifest.mjs';
import { readLiveIdentity } from './target.mjs';

const SELECT_FIELDS = [
  'item_id_pk', 'item_num_id', 'created_time_date', 'div_code', 'div_code_fk',
  ...WRITABLE_FIELDS,
];

const same = (a, b) => String(a ?? '') === String(b ?? '');

export const DRIFT = Object.freeze({
  ROW_MISSING: 'ROW_MISSING',
  BEFORE_STATE_DRIFT: 'BEFORE_STATE_DRIFT',
  DATE_DRIFT: 'DATE_DRIFT',
  TAXONOMY_DRIFT: 'TAXONOMY_DRIFT',
});

/** Read the live taxonomy inside the open transaction. */
async function readTaxonomy(client) {
  const divisions = await client.query(
    'select "divCode_id", "external_divisoncode" from dflow."divisionCode"',
  );
  const mg = await client.query(
    'select mg_id, mg_code, "mgTypeCode", "divisionCode_fk", "divisionCode_id_fk", parent_id, is_active from core."merchGroup"',
  );
  const divisionIndex = buildDivisionIndex(divisions.rows);
  return { divisionIndex, taxonomyIndex: buildTaxonomyIndex(mg.rows, divisionIndex) };
}

/**
 * Lock the candidate rows and revalidate every locked assumption against live
 * state. Returns the exact set of rows that would change, plus anything that
 * drifted. Callers decide whether drift aborts (it always does for apply).
 */
export async function planBatch(client, manifest, { cutoff = HISTORICAL_CUTOFF_ISO } = {}) {
  assertCutoff(cutoff);
  assertManifestWritable(manifest);

  const ids = manifest.candidates.map((c) => c.item_id_pk);
  const locked = await client.query(
    `select ${SELECT_FIELDS.map((f) => `"${f}"`).join(', ')} from dflow."itemHeader" `
    + 'where item_id_pk = any($1::int[]) order by item_id_pk for update',
    [ids],
  );
  const live = new Map(locked.rows.map((r) => [Number(r.item_id_pk), r]));
  const { divisionIndex, taxonomyIndex } = await readTaxonomy(client);

  const toChange = [];
  const alreadyEqual = [];
  const drift = [];

  for (const c of manifest.candidates) {
    const row = live.get(c.item_id_pk);
    if (!row) { drift.push({ item_id_pk: c.item_id_pk, reason: DRIFT.ROW_MISSING }); continue; }

    const historical = isHistorical(row.created_time_date, cutoff);
    if (historical !== true || !same(canonicalTimestamp(row.created_time_date), c.created_time_date)) {
      drift.push({ item_id_pk: c.item_id_pk, reason: DRIFT.DATE_DRIFT });
      continue;
    }

    const division = resolveItemDivision(row, divisionIndex);
    if (division.abstain || division.code !== c.resolved_division) {
      drift.push({
        item_id_pk: c.item_id_pk,
        reason: division.abstain ?? ABSTAIN.DIVISION_MISMATCH,
      });
      continue;
    }

    const chain = qualifyChain(taxonomyIndex, division.code, {
      mg01: c.after.udf_merchgroup01,
      mg02: c.after.udf_merchgroup02,
      mg03: c.after.udf_merchgroup03,
    });
    if (chain.abstain
      || chain.chain.mg01.mg_id !== c.after.udf_merchgroup01_id
      || chain.chain.mg02.mg_id !== c.after.udf_merchgroup02_id
      || chain.chain.mg03.mg_id !== c.after.udf_merchgroup03_id) {
      drift.push({ item_id_pk: c.item_id_pk, reason: chain.abstain ?? DRIFT.TAXONOMY_DRIFT });
      continue;
    }

    const matchesAfter = WRITABLE_FIELDS.every((f) => same(row[f], c.after[f]));
    if (matchesAfter) { alreadyEqual.push(c.item_id_pk); continue; }

    const matchesBefore = WRITABLE_FIELDS.every((f) => same(row[f], c.before[f]));
    if (!matchesBefore) {
      drift.push({ item_id_pk: c.item_id_pk, reason: DRIFT.BEFORE_STATE_DRIFT });
      continue;
    }
    toChange.push(c);
  }

  return {
    attempted: manifest.candidates.length,
    to_change: toChange,
    already_equal: alreadyEqual,
    drift,
  };
}

/** The compare-and-swap UPDATE. Every before field is in the predicate. */
export function buildUpdate(candidates) {
  const values = [];
  const params = [];
  candidates.forEach((c, i) => {
    const b = i * 13;
    values.push(
      `($${b + 1}::int, $${b + 2}::varchar, $${b + 3}::varchar, $${b + 4}::varchar, `
      + `$${b + 5}::int, $${b + 6}::int, $${b + 7}::int, `
      + `$${b + 8}::varchar, $${b + 9}::varchar, $${b + 10}::varchar, `
      + `$${b + 11}::int, $${b + 12}::int, $${b + 13}::int)`,
    );
    params.push(
      c.item_id_pk,
      c.before.udf_merchgroup01, c.before.udf_merchgroup02, c.before.udf_merchgroup03,
      c.before.udf_merchgroup01_id, c.before.udf_merchgroup02_id, c.before.udf_merchgroup03_id,
      c.after.udf_merchgroup01, c.after.udf_merchgroup02, c.after.udf_merchgroup03,
      c.after.udf_merchgroup01_id, c.after.udf_merchgroup02_id, c.after.udf_merchgroup03_id,
    );
  });
  const text = `
update dflow."itemHeader" as t
set udf_merchgroup01 = v.a01,
    udf_merchgroup02 = v.a02,
    udf_merchgroup03 = v.a03,
    udf_merchgroup01_id = v.a01id,
    udf_merchgroup02_id = v.a02id,
    udf_merchgroup03_id = v.a03id
from (values ${values.join(',\n                ')}) as v(
  item_id_pk, b01, b02, b03, b01id, b02id, b03id, a01, a02, a03, a01id, a02id, a03id)
where t.item_id_pk = v.item_id_pk
  and t.udf_merchgroup01 is not distinct from v.b01
  and t.udf_merchgroup02 is not distinct from v.b02
  and t.udf_merchgroup03 is not distinct from v.b03
  and t.udf_merchgroup01_id is not distinct from v.b01id
  and t.udf_merchgroup02_id is not distinct from v.b02id
  and t.udf_merchgroup03_id is not distinct from v.b03id`;
  return { text, params };
}

/**
 * Run the batch. `mode` defaults to `plan`, which always rolls back.
 *
 * An apply aborts the WHOLE transaction if any row drifted or if the affected
 * row count is not exactly the planned change count. There is no partial apply.
 */
export async function runBatch(client, manifest, {
  target, mode = 'plan', expectedDigest, authorization, cutoff = HISTORICAL_CUTOFF_ISO,
  projectRef, onPlanned,
} = {}) {
  if (mode !== 'plan' && mode !== 'apply') {
    throw new Error(`REFUSED: unknown mode "${mode}"; expected plan or apply`);
  }
  // The binding lives HERE, in the executor, not only in the apply CLI. Any
  // caller that opens its own client would otherwise bypass it entirely.
  if (!projectRef) {
    throw new Error('REFUSED: runBatch requires the proven project ref of the open connection');
  }
  const identity = await readLiveIdentity(client);
  assertManifestBoundToTarget(manifest, {
    target, projectRef, cluster: identity.system_identifier,
  });
  const digest = manifestDigest(manifest);
  assertAuthorization({ target, expectedDigest, actualDigest: digest, authorization });

  await client.query('BEGIN');
  try {
    const plan = await planBatch(client, manifest, { cutoff });
    if (mode === 'plan') {
      await client.query('ROLLBACK');
      return { ...plan, mode, manifest_sha256: digest, changed: 0 };
    }
    if (plan.drift.length > 0) {
      throw new Error(
        `REFUSED: ${plan.drift.length} candidate row(s) drifted from the manifest before-state; `
        + 'the entire batch is rolled back',
      );
    }
    // The before-state backup MUST be taken here: inside this transaction, after
    // the rows are locked and revalidated, and over the rows this batch will
    // actually write. Capturing it before the lock was a real defect: a
    // concurrent edit that happened to land on the desired values is classified
    // `already_equal` and never touched by this batch, yet a pre-lock backup
    // still listed it, so a later rollback would have overwritten someone else's
    // edit with a stale value. `to_change` cannot contain such a row, because
    // every one of its six before-fields was just proved equal under the lock.
    if (onPlanned) await onPlanned(plan.to_change);
    let changed = 0;
    if (plan.to_change.length > 0) {
      const { text, params } = buildUpdate(plan.to_change);
      const res = await client.query(text, params);
      changed = res.rowCount ?? 0;
      if (changed !== plan.to_change.length) {
        throw new Error(
          `REFUSED: compare-and-swap affected ${changed} rows but ${plan.to_change.length} `
          + 'were planned; the entire batch is rolled back',
        );
      }
    }
    await client.query('COMMIT');
    return { ...plan, mode, manifest_sha256: digest, changed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Conditional rollback. Only rows whose six current values still equal THIS
 * batch's after-state are restored. An intervening edit abstains and is reported
 * for manual review; it is never overwritten.
 */
export async function runRollback(client, backup, { target, expectedDigest, mode = 'plan' } = {}) {
  if (mode !== 'plan' && mode !== 'apply') {
    throw new Error(`REFUSED: unknown mode "${mode}"; expected plan or apply`);
  }
  if (backup.target !== target) {
    throw new Error(
      `REFUSED: backup was taken against "${backup.target}", not "${target}"`,
    );
  }
  if (expectedDigest && backup.manifest_sha256 !== expectedDigest) {
    throw new Error(
      `REFUSED: backup names manifest ${backup.manifest_sha256}, not ${expectedDigest}`,
    );
  }
  await client.query('BEGIN');
  try {
    const ids = backup.rows.map((r) => r.item_id_pk);
    const locked = await client.query(
      `select ${SELECT_FIELDS.map((f) => `"${f}"`).join(', ')} from dflow."itemHeader" `
      + 'where item_id_pk = any($1::int[]) order by item_id_pk for update',
      [ids],
    );
    const live = new Map(locked.rows.map((r) => [Number(r.item_id_pk), r]));

    const restorable = [];
    const abstained = [];
    for (const r of backup.rows) {
      const row = live.get(r.item_id_pk);
      if (!row) { abstained.push({ item_id_pk: r.item_id_pk, reason: DRIFT.ROW_MISSING }); continue; }
      const stillOurs = WRITABLE_FIELDS.every((f) => same(row[f], r.after[f]));
      if (!stillOurs) {
        abstained.push({ item_id_pk: r.item_id_pk, reason: 'INTERVENING_EDIT' });
        continue;
      }
      restorable.push({ item_id_pk: r.item_id_pk, before: r.after, after: r.before });
    }

    if (mode === 'plan') {
      await client.query('ROLLBACK');
      return { mode, restorable: restorable.length, abstained, restored: 0 };
    }
    let restored = 0;
    if (restorable.length > 0) {
      const { text, params } = buildUpdate(restorable);
      const res = await client.query(text, params);
      restored = res.rowCount ?? 0;
      if (restored !== restorable.length) {
        throw new Error(
          `REFUSED: rollback affected ${restored} rows but ${restorable.length} were `
          + 'restorable; the entire rollback is rolled back',
        );
      }
    }
    await client.query('COMMIT');
    return { mode, restorable: restorable.length, abstained, restored };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
