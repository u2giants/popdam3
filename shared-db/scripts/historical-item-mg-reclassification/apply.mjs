#!/usr/bin/env node
// Step 2: the guarded executor CLI.
//
//   node apply.mjs --manifest <private manifest.json> --target preview|production \
//     --expect-project-ref <ref> --expect-manifest-sha256 <digest> \
//     --backup-out <PRIVATE dir> [--authorization <file>] [--apply]
//
// WITHOUT --apply this is a dry run: it opens a transaction, locks and
// revalidates every candidate row, and ROLLS BACK. Nothing is written.
//
// --apply writes rows. Running it against preview or production requires
// Albert's separate explicit authorization; building and testing this tool did
// not authorize running it. For production an authorization artifact naming the
// exact manifest digest is additionally required by lib/manifest.mjs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WRITABLE_FIELDS } from './lib/constants.mjs';
import { assertManifestBoundToTarget, manifestDigest } from './lib/manifest.mjs';
import { runBatch } from './lib/execute.mjs';
import { connect, parseArgs } from './lib/pg.mjs';
import { assertLiveIdentity, readLiveIdentity } from './lib/target.mjs';
import { assertPrivateOutputDir } from './lib/private-path.mjs';

const FLAGS = [
  'manifest', 'target', 'expect_project_ref', 'expect_manifest_sha256',
  'expect_cluster_id', 'backup_out', 'authorization', 'apply', 'help',
];

/**
 * The before-state backup, built from the rows a locked, revalidated plan is
 * about to write. It is deliberately NOT a pre-lock SELECT: see the comment in
 * lib/execute.mjs where `onPlanned` is called.
 */
export function buildBackup(toChange, { target, digest, projectRef, cluster }) {
  return {
    schema: 'historical-item-mg-reclassification/backup@1',
    target,
    project_ref: projectRef,
    cluster_system_identifier: cluster,
    manifest_sha256: digest,
    captured_at: new Date().toISOString(),
    rows: toChange.map((c) => ({
      item_id_pk: Number(c.item_id_pk),
      before: Object.fromEntries(WRITABLE_FIELDS.map((f) => [f, c.before[f] ?? null])),
      after: Object.fromEntries(WRITABLE_FIELDS.map((f) => [f, c.after[f] ?? null])),
    })),
  };
}

/**
 * A manifest names the exact database it was built against. Refuse to execute it
 * anywhere else. Without this, a preview-built manifest whose digest was placed
 * in a production authorization artifact would have been executed against
 * production, because nothing compared the manifest to the live destination.
 */
export function assertManifestMatchesTarget(manifest, live) {
  return assertManifestBoundToTarget(manifest, live);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), FLAGS);
  if (args.help || !args.manifest || !args.target || !args.backup_out) {
    console.error('usage: apply.mjs --manifest <file> --target preview|production '
      + '--expect-project-ref <ref> --expect-manifest-sha256 <digest> '
      + '--backup-out <private dir> [--authorization <file>] [--apply]');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(resolve(args.manifest), 'utf8'));
  const digest = manifestDigest(manifest);
  if (!args.expect_manifest_sha256) {
    throw new Error('REFUSED: --expect-manifest-sha256 is required; the file name is not approval');
  }
  const authorization = args.authorization
    ? JSON.parse(readFileSync(resolve(args.authorization), 'utf8'))
    : undefined;

  const { client, projectRef } = await connect({
    target: args.target, expectedRef: args.expect_project_ref,
  });
  try {
    const identity = assertLiveIdentity(await readLiveIdentity(client), args.expect_cluster_id);
    console.error(`target proof: project ${projectRef}, database ${identity.database}, `
      + `cluster ${identity.system_identifier}`);

    assertManifestMatchesTarget(manifest, {
      target: args.target, projectRef, cluster: identity.system_identifier,
    });

    const dir = assertPrivateOutputDir(args.backup_out);
    mkdirSync(dir, { recursive: true });

    const result = await runBatch(client, manifest, {
      target: args.target,
      projectRef,
      mode: args.apply ? 'apply' : 'plan',
      expectedDigest: args.expect_manifest_sha256,
      authorization,
      // Written under the lock, before the UPDATE, and only over the rows this
      // batch will actually write.
      onPlanned: async (toChange) => {
        const backup = buildBackup(toChange, {
          target: args.target, digest, projectRef, cluster: identity.system_identifier,
        });
        // One file per RUN, never one per manifest. Re-running the same
        // manifest plans zero changes, and a shared filename replaced the
        // real before-state with an empty backup, silently destroying the
        // only rollback artifact this tooling produces.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = join(dir, `backup-${digest.slice(0, 12)}-${stamp}.json`);
        if (existsSync(backupPath)) {
          throw new Error(`REFUSED: ${backupPath} already exists; a backup is never overwritten`);
        }
        writeFileSync(backupPath, JSON.stringify(backup, null, 2) + "\n");
        console.error(`before-state backup written (${backup.rows.length} rows)`);
      },
    });
    console.log(JSON.stringify({
      mode: result.mode,
      manifest_sha256: result.manifest_sha256,
      attempted: result.attempted,
      to_change: result.to_change.length,
      already_equal: result.already_equal.length,
      drift: result.drift.length,
      drift_reasons: result.drift.reduce((a, d) => {
        a[d.reason] = (a[d.reason] ?? 0) + 1; return a;
      }, {}),
      changed: result.changed,
    }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('apply.mjs')) {
  main().catch((err) => { console.error(String(err.message ?? err)); process.exit(1); });
}
