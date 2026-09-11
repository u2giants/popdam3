#!/usr/bin/env node
// Step 1: build the private, live-qualified candidate manifest.
//
//   node build-manifest.mjs \
//     --source <private historical_hierarchical_mg_matches.csv> \
//     --target preview|production \
//     --expect-project-ref <ref> \
//     --out <PRIVATE output directory>
//
// READ-ONLY. This script issues SELECT statements only and takes no lock. It
// writes nothing to the database and nothing to this public repository.
//
// PRIVACY: the manifest and abstention ledger contain licensed item identities
// and must be written to the private `u2giants/licensor-source-data` checkout or
// an ignored `.private/` directory. Only the counts and the SHA-256 digest that
// this script prints on stdout may be quoted publicly. Item descriptions are
// never read into the manifest at all.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HISTORICAL_CUTOFF_ISO, assertCutoff } from './lib/constants.mjs';
import { parseCsv } from './lib/csv.mjs';
import {
  buildDivisionIndex, buildTaxonomyIndex, qualifyCandidate, reconcile,
} from './lib/classify.mjs';
import { manifestDigest, serializeManifest, sha256 } from './lib/manifest.mjs';
import { connect, parseArgs } from './lib/pg.mjs';
import { readLiveIdentity } from './lib/target.mjs';
import { assertPrivateOutputDir } from './lib/private-path.mjs';

const FLAGS = ['source', 'target', 'expect_project_ref', 'out', 'help'];

export const REQUIRED_SOURCE_HEADERS = [
  'Company', 'Division', 'Item #', 'Matched Level',
  'Proposed MG01', 'Proposed MG02', 'Proposed MG03',
];

/**
 * A header that does not match is NOT an empty result. Every row would abstain
 * as NOT_LEVEL_3 and the operator would get a healthy-looking zero-candidate
 * manifest, so the header set is proved before a single row is mapped.
 */
export function assertSourceHeaders(rows) {
  const present = new Set(Object.keys(rows[0] ?? {}));
  const missing = REQUIRED_SOURCE_HEADERS.filter((h) => !present.has(h));
  if (!rows.length) throw new Error('REFUSED: the source export has no data rows');
  if (missing.length) {
    throw new Error(
      `REFUSED: the source export is missing required column(s): ${missing.join(', ')}`,
    );
  }
  return true;
}

function mapSourceRow(r) {
  return {
    company: r.Company,
    division: r.Division,
    item_num: r['Item #'],
    matched_level: r['Matched Level'],
    proposed_mg01: r['Proposed MG01'],
    proposed_mg02: r['Proposed MG02'],
    proposed_mg03: r['Proposed MG03'],
    match_basis: r['Match Basis'],
    evidence_support: r['Evidence Support'],
    evidence_total: r['Evidence Total'],
    evidence_share: r['Evidence Share'],
  };
}

export async function buildManifest({ client, sourceRows, sourceDigest, cutoff = HISTORICAL_CUTOFF_ISO }) {
  assertSourceHeaders(sourceRows);
  // The CLI cannot pass a cutoff, but this function is exported: a direct caller
  // could otherwise widen the SELECT bound and only be refused later, per row, by
  // qualifyCandidate. Refuse here, before any statement is issued.
  assertCutoff(cutoff);
  const items = await client.query(
    'select item_id_pk, item_num_id, created_time_date, div_code, div_code_fk, '
    + 'udf_merchgroup01, udf_merchgroup02, udf_merchgroup03, '
    + 'udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id '
    + 'from dflow."itemHeader" where created_time_date is not null and created_time_date < $1',
    [cutoff],
  );
  const byItemNum = new Map();
  for (const row of items.rows) {
    const key = String(row.item_num_id ?? '').trim();
    if (key === '') continue;
    if (!byItemNum.has(key)) byItemNum.set(key, []);
    byItemNum.get(key).push(row);
  }

  const divisions = await client.query(
    'select "divCode_id", "external_divisoncode" from dflow."divisionCode"',
  );
  const mg = await client.query(
    'select mg_id, mg_code, "mgTypeCode", "divisionCode_fk", "divisionCode_id_fk", parent_id, is_active from core."merchGroup"',
  );
  const divisionIndex = buildDivisionIndex(divisions.rows);
  const taxonomyIndex = buildTaxonomyIndex(mg.rows, divisionIndex);

  const candidates = [];
  const noops = [];
  const abstentions = [];
  for (const raw of sourceRows) {
    const source = mapSourceRow(raw);
    const key = String(source.item_num ?? '').trim();
    const liveMatches = byItemNum.get(key) ?? [];
    const result = qualifyCandidate({ source, liveMatches, divisionIndex, taxonomyIndex, cutoff });
    if (result.status === 'candidate') candidates.push(result.record);
    else if (result.status === 'noop') noops.push(result.record);
    else {
      abstentions.push({
        reason: result.reason,
        source_identity: result.source_identity,
        ...(result.failed_level ? { failed_level: result.failed_level } : {}),
        ...(result.live_match_count ? { live_match_count: result.live_match_count } : {}),
        ...(result.live_division ? { live_division: result.live_division } : {}),
      });
    }
  }

  reconcile({
    attempted: sourceRows.length,
    candidates: candidates.length,
    noops: noops.length,
    abstentions: abstentions.length,
  });

  const reasonCounts = {};
  for (const a of abstentions) reasonCounts[a.reason] = (reasonCounts[a.reason] ?? 0) + 1;

  return {
    manifest: {
      schema: 'historical-item-mg-reclassification/manifest@1',
      cutoff,
      source_sha256: sourceDigest,
      source_rows: sourceRows.length,
      live_historical_rows: items.rows.length,
      candidates,
      no_ops: noops.map((n) => n.item_id_pk).sort((a, b) => a - b),
      abstentions,
    },
    summary: {
      source_rows: sourceRows.length,
      live_historical_rows: items.rows.length,
      candidates: candidates.length,
      no_ops: noops.length,
      abstentions: abstentions.length,
      abstention_reasons: Object.fromEntries(Object.entries(reasonCounts).sort()),
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), FLAGS);
  if (args.help || !args.source || !args.target || !args.out) {
    console.error('usage: build-manifest.mjs --source <csv> --target preview|production '
      + '--expect-project-ref <ref> --out <private dir>');
    process.exit(2);
  }
  const sourceText = readFileSync(resolve(args.source), 'utf8');
  const sourceDigest = sha256(sourceText);
  const sourceRows = parseCsv(sourceText);

  const { client, projectRef } = await connect({
    target: args.target,
    expectedRef: args.expect_project_ref,
  });
  let out;
  try {
    const identity = await readLiveIdentity(client);
    console.error(`target proof: project ${projectRef}, database ${identity.database}, `
      + `cluster ${identity.system_identifier}`);
    out = await buildManifest({ client, sourceRows, sourceDigest });
    out.manifest.target = args.target;
    out.manifest.project_ref = projectRef;
    out.manifest.cluster_system_identifier = identity.system_identifier;
    out.manifest.generated_at = new Date().toISOString();
  } finally {
    await client.end();
  }

  // `generated_at` is excluded from the digest so the same inputs digest the
  // same way on a later run; the timestamp lives beside it, not inside it.
  const { generated_at: generatedAt, ...digestable } = out.manifest;
  const digest = manifestDigest(digestable);

  const dir = assertPrivateOutputDir(args.out);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), serializeManifest(digestable));
  writeFileSync(join(dir, 'manifest.meta.json'),
    `${JSON.stringify({ generated_at: generatedAt, manifest_sha256: digest, ...out.summary }, null, 2)}\n`);

  console.log(JSON.stringify({ manifest_sha256: digest, ...out.summary }, null, 2));
}

if (process.argv[1]?.endsWith('build-manifest.mjs')) {
  main().catch((err) => { console.error(String(err.message ?? err)); process.exit(1); });
}
