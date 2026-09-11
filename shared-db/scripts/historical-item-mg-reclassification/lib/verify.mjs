// Post-apply verification (plan section 9, step 11).
//
// Verification proves the CAPABILITY still works, not merely that an UPDATE
// reported a row count. It re-reads every candidate, re-walks the live taxonomy,
// re-digests the non-candidate population, and re-reads the category function's
// body to confirm the MG01-only contract and the cutoff are both still intact.

import { createHash } from 'node:crypto';
import { WRITABLE_FIELDS } from './constants.mjs';
import { buildDivisionIndex, buildTaxonomyIndex, qualifyChain, resolveItemDivision } from './classify.mjs';

const same = (a, b) => String(a ?? '') === String(b ?? '');

/**
 * Stable digest of the six MG fields of every row NOT in the batch. Any change
 * to a non-candidate row moves this digest.
 */
export async function nonCandidateDigest(client, candidateIds) {
  const { rows } = await client.query(
    'select item_id_pk, udf_merchgroup01, udf_merchgroup02, udf_merchgroup03, '
    + 'udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id '
    + 'from dflow."itemHeader" where not (item_id_pk = any($1::int[])) order by item_id_pk',
    [candidateIds],
  );
  const h = createHash('sha256');
  for (const r of rows) {
    h.update(`${r.item_id_pk}|${WRITABLE_FIELDS.map((f) => r[f] ?? '').join('|')}\n`);
  }
  return { digest: h.digest('hex'), row_count: rows.length };
}

/** Read the category function's body so its contract can be asserted, not assumed. */
export async function readCategoryFunction(client) {
  const { rows } = await client.query(
    "select pg_get_functiondef(p.oid) as def from pg_proc p "
    + "join pg_namespace n on n.oid = p.pronamespace "
    + "where n.nspname = 'api' and p.proname = 'resolve_item_mg_category'",
  );
  return rows.map((r) => r.def);
}

export function assertCategoryContract(defs, { cutoffDate = '2025-05-14' } = {}) {
  const problems = [];
  if (defs.length === 0) problems.push('api.resolve_item_mg_category is missing');
  for (const def of defs) {
    const lower = def.toLowerCase();
    if (!def.includes(cutoffDate)) {
      problems.push(`the function body no longer carries the ${cutoffDate} cutoff`);
    }
    if (lower.includes('merchgroup02') || lower.includes('merchgroup03')) {
      problems.push('the function body now references MG02 or MG03; the MG01-only contract is broken');
    }
  }
  if (problems.length) throw new Error(`VERIFY FAILED:\n  - ${problems.join('\n  - ')}`);
  return true;
}

/**
 * Full verification pass. Throws on the first class of failure with every
 * offending primary key listed, so a failure is actionable rather than a count.
 */
export async function verifyBatch(client, manifest, { expectedNonCandidate } = {}) {
  const ids = manifest.candidates.map((c) => c.item_id_pk);
  const { rows } = await client.query(
    'select item_id_pk, div_code, div_code_fk, udf_merchgroup01, udf_merchgroup02, '
    + 'udf_merchgroup03, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id '
    + 'from dflow."itemHeader" where item_id_pk = any($1::int[]) order by item_id_pk',
    [ids],
  );
  const live = new Map(rows.map((r) => [Number(r.item_id_pk), r]));

  const divisions = await client.query(
    'select "divCode_id", "external_divisoncode" from dflow."divisionCode"',
  );
  const mg = await client.query(
    'select mg_id, mg_code, "mgTypeCode", "divisionCode_fk", "divisionCode_id_fk", parent_id, is_active from core."merchGroup"',
  );
  const divisionIndex = buildDivisionIndex(divisions.rows);
  const taxonomyIndex = buildTaxonomyIndex(mg.rows, divisionIndex);

  const failures = [];
  for (const c of manifest.candidates) {
    const row = live.get(c.item_id_pk);
    if (!row) { failures.push(`${c.item_id_pk}: row missing`); continue; }
    for (const f of WRITABLE_FIELDS) {
      if (!same(row[f], c.after[f])) {
        failures.push(`${c.item_id_pk}: ${f} is "${row[f]}", expected "${c.after[f]}"`);
      }
      if (row[f] === null || row[f] === undefined || String(row[f]).trim() === '') {
        failures.push(`${c.item_id_pk}: ${f} is null or blank after an applied triplet`);
      }
    }
    const division = resolveItemDivision(row, divisionIndex);
    if (division.abstain) { failures.push(`${c.item_id_pk}: ${division.abstain}`); continue; }
    const chain = qualifyChain(taxonomyIndex, division.code, {
      mg01: row.udf_merchgroup01, mg02: row.udf_merchgroup02, mg03: row.udf_merchgroup03,
    });
    if (chain.abstain) {
      failures.push(`${c.item_id_pk}: applied codes no longer form an active chain (${chain.abstain})`);
      continue;
    }
    if (chain.chain.mg01.mg_id !== row.udf_merchgroup01_id
      || chain.chain.mg02.mg_id !== row.udf_merchgroup02_id
      || chain.chain.mg03.mg_id !== row.udf_merchgroup03_id) {
      failures.push(`${c.item_id_pk}: raw codes and normalized IDs disagree`);
    }
  }

  const nonCandidate = await nonCandidateDigest(client, ids);
  if (expectedNonCandidate && nonCandidate.digest !== expectedNonCandidate.digest) {
    failures.push('a non-candidate row changed: the non-candidate digest moved');
  }
  if (expectedNonCandidate && nonCandidate.row_count !== expectedNonCandidate.row_count) {
    failures.push(
      `non-candidate row count moved from ${expectedNonCandidate.row_count} to ${nonCandidate.row_count}`,
    );
  }

  assertCategoryContract(await readCategoryFunction(client));

  if (failures.length) {
    throw new Error(`VERIFY FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`);
  }
  return { verified: manifest.candidates.length, non_candidate: nonCandidate };
}
