#!/usr/bin/env node
// Step 2 (continued): conditional rollback CLI.
//
//   node rollback.mjs --backup <private backup file> --target preview|production \
//     --expect-project-ref <ref> --expect-manifest-sha256 <digest> [--apply]
//
// Without --apply this reports what WOULD be restored and rolls back.
//
// A row is restored only if its six merch-group values still equal exactly what
// this batch wrote. Anything edited since is reported as INTERVENING_EDIT and
// left alone: a rollback must never silently discard another party's work.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runRollback } from './lib/execute.mjs';
import { connect, parseArgs } from './lib/pg.mjs';
import { readLiveIdentity } from './lib/target.mjs';

const FLAGS = ['backup', 'target', 'expect_project_ref', 'expect_manifest_sha256', 'apply', 'help'];

async function main() {
  const args = parseArgs(process.argv.slice(2), FLAGS);
  // A rollback writes rows. It must be bound to the manifest it is undoing for
  // exactly the reason apply.mjs is: a file name is not an approval.
  if (args.help || !args.backup || !args.target || !args.expect_manifest_sha256) {
    console.error('usage: rollback.mjs --backup <file> --target preview|production '
      + '--expect-project-ref <ref> --expect-manifest-sha256 <digest> [--apply]');
    process.exit(2);
  }
  const backup = JSON.parse(readFileSync(resolve(args.backup), 'utf8'));
  const { client, projectRef } = await connect({
    target: args.target, expectedRef: args.expect_project_ref,
  });
  try {
    const identity = await readLiveIdentity(client);
    console.error(`target proof: project ${projectRef}, database ${identity.database}, `
      + `cluster ${identity.system_identifier}`);
    if (backup.cluster_system_identifier
      && String(backup.cluster_system_identifier) !== String(identity.system_identifier)) {
      throw new Error('REFUSED: the backup was taken against a different Postgres cluster');
    }
    const result = await runRollback(client, backup, {
      target: args.target,
      expectedDigest: args.expect_manifest_sha256,
      mode: args.apply ? 'apply' : 'plan',
    });
    console.log(JSON.stringify({
      mode: result.mode,
      restorable: result.restorable,
      restored: result.restored,
      abstained: result.abstained.length,
      abstained_reasons: result.abstained.reduce((a, d) => {
        a[d.reason] = (a[d.reason] ?? 0) + 1; return a;
      }, {}),
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('rollback.mjs')) {
  main().catch((err) => { console.error(String(err.message ?? err)); process.exit(1); });
}
