/**
 * Test-support: resolve the LIVE definition of a shared database function.
 *
 * Several tests pin database guarantees this repository cannot execute — manual
 * tag survival, rejected-tombstone protection, the `assets.tags` compatibility
 * array. Reading one hard-coded migration file is wrong: migrations are immutable
 * history, so a later `create or replace` silently supersedes it and the test
 * becomes a permanent green light for semantics that no longer exist.
 *
 * Migration filenames are timestamp-ordered, so the last file that redefines a
 * function holds the live body.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RELATIVE_DIR = join("shared-db", "supabase", "migrations");

/**
 * Walk up from the working directory to the repository root. This runs from both
 * `apps/worker` (node:test) and the repository root (vitest), and vitest rewrites
 * `import.meta.url` to a non-file URL, so a path relative to this module is not
 * usable here.
 */
function migrationsDir(): string {
  let current = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, RELATIVE_DIR);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not locate ${RELATIVE_DIR} from ${process.cwd()}`);
}

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir()).filter((name) => name.endsWith(".sql")).sort();
}

/** Returns the body of the newest `create or replace function public.<name>`. */
export function liveFunctionBody(name: string): { file: string; body: string } {
  const dir = migrationsDir();
  for (const file of migrationFiles().slice().reverse()) {
    const sql = readFileSync(join(dir, file), "utf8");
    const marker = `create or replace function public.${name}`;
    const start = sql.lastIndexOf(marker);
    if (start === -1) continue;
    // Each definition is wrapped in one of the repo's dollar-quoted apply blocks.
    const terminators = ["$applyddl$)", "$ddl$)", "$$;"]
      .map((token) => sql.indexOf(token, start))
      .filter((index) => index > -1);
    const end = terminators.length ? Math.min(...terminators) : sql.length;
    return { file, body: sql.slice(start, end) };
  }
  throw new Error(`No migration defines public.${name}`);
}
