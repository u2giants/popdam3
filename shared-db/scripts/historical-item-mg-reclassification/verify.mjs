#!/usr/bin/env node
// Step 2 (continued): post-apply verification CLI. READ-ONLY.
//
//   node verify.mjs --manifest <file> --target preview|production \
//     --expect-project-ref <ref> [--expect-non-candidate <digest>] \
//     [--expect-non-candidate-rows <n>]
//
// Run it once BEFORE the apply with --baseline-only to record the non-candidate
// digest, then again after, passing the recorded values back in. A green run
// without the recorded baseline proves less, and says so.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nonCandidateDigest, verifyBatch } from './lib/verify.mjs';
import { connect, parseArgs } from './lib/pg.mjs';
import { readLiveIdentity } from './lib/target.mjs';

const FLAGS = [
  'manifest', 'target', 'expect_project_ref', 'expect_non_candidate',
  'expect_non_candidate_rows', 'baseline_only', 'help',
];

async function main() {
  const args = parseArgs(process.argv.slice(2), FLAGS);
  if (args.help || !args.manifest || !args.target) {
    console.error('usage: verify.mjs --manifest <file> --target preview|production '
      + '--expect-project-ref <ref> [--baseline-only] '
      + '[--expect-non-candidate <digest> --expect-non-candidate-rows <n>]');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(resolve(args.manifest), 'utf8'));
  const { client, projectRef } = await connect({
    target: args.target, expectedRef: args.expect_project_ref,
  });
  try {
    const identity = await readLiveIdentity(client);
    console.error(`target proof: project ${projectRef}, database ${identity.database}, `
      + `cluster ${identity.system_identifier}`);
    const ids = manifest.candidates.map((c) => c.item_id_pk);
    if (args.baseline_only) {
      console.log(JSON.stringify(await nonCandidateDigest(client, ids), null, 2));
      return;
    }
    const expectedNonCandidate = args.expect_non_candidate
      ? { digest: args.expect_non_candidate, row_count: Number(args.expect_non_candidate_rows) }
      : null;
    if (!expectedNonCandidate) {
      console.error('WARNING: no recorded non-candidate baseline was supplied, so this run '
        + 'cannot prove that untouched rows are untouched.');
    }
    const result = await verifyBatch(client, manifest, { expectedNonCandidate });
    console.log(JSON.stringify({
      verified: result.verified,
      non_candidate_digest: result.non_candidate.digest,
      non_candidate_rows: result.non_candidate.row_count,
      baseline_compared: Boolean(expectedNonCandidate),
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('verify.mjs')) {
  main().catch((err) => { console.error(String(err.message ?? err)); process.exit(1); });
}
