// Postgres connection helper.
//
// This repository has no package.json and no node_modules, so `pg` is NOT a
// dependency of the public tooling. It is resolved at run time from a path the
// operator supplies (`MGRC_PG_MODULE`), which keeps every test in this directory
// offline and keeps CI free of database packages. `psql` is not installed on the
// Windows dev machines (see docs/agents/runbooks-credentials-cli-and-gotchas.md),
// so Node + pg against the Supabase pooler is the supported path.
//
// The connection string is read from the environment and never logged, echoed,
// written into a manifest, or included in an error message.

import { pathToFileURL } from 'node:url';
import { assertTarget } from './target.mjs';

export const CONNECTION_ENV = 'MGRC_DATABASE_URL';

export async function loadPg() {
  const spec = process.env.MGRC_PG_MODULE;
  if (!spec) {
    throw new Error(
      'REFUSED: set MGRC_PG_MODULE to the resolved path of an installed `pg` package '
      + '(this repository intentionally has no node_modules)',
    );
  }
  // A Windows path such as C:/... is not a URL the ESM loader accepts, so an
  // absolute path is converted to a file:// URL. A bare package name is passed
  // through untouched.
  const target = /^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/')
    ? pathToFileURL(spec).href
    : spec;
  const mod = await import(target);
  return mod.default ?? mod;
}

/**
 * Connect, proving the target first. The proof runs BEFORE the connection is
 * opened and the derived ref is returned so the caller can quote it.
 */
export async function connect({ target, expectedRef }) {
  const connectionString = process.env[CONNECTION_ENV];
  if (!connectionString) {
    throw new Error(`REFUSED: ${CONNECTION_ENV} is not set`);
  }
  const ref = assertTarget({ target, connectionString, expectedRef });
  const pg = await loadPg();
  const client = new pg.Client({ connectionString });
  await client.connect();
  return { client, projectRef: ref };
}

/** Minimal flag parser; unknown flags are refused rather than ignored. */
export function parseArgs(argv, allowed) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`REFUSED: unexpected argument "${a}"`);
    const [rawKey, inlineValue] = a.slice(2).split('=');
    const key = rawKey.replace(/-/g, '_');
    if (!allowed.includes(key)) throw new Error(`REFUSED: unknown flag "--${rawKey}"`);
    if (inlineValue !== undefined) { out[key] = inlineValue; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i += 1;
  }
  return out;
}
