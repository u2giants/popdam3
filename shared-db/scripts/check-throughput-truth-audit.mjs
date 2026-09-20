#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOTS = ['scripts', '.github/workflows'];
export const EXTENSIONS = new Set(['.mjs', '.js', '.py', '.sh', '.yml', '.yaml']);
export const PATTERN = /\bmissing\b|never created|not applied|NOT_DERIVABLE|_created_by_applied_dynamic_ddl/gi;

/** Partitioned dispositions: one reviewed catalogue per source file, so two unrelated
 *  source changes never edit a common count, digest or file (issue #2832). */
export const DISPOSITION_DIR = 'docs/verification/throughput-dispositions';
export const DISPOSITION_SCHEMA_VERSION = 1;
/** The pre-partition aggregate is retained as historical evidence only; it is never read. */
export const HISTORICAL_AUDIT = 'docs/verification/throughput-guard-truth-audit-20260828.json';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/** Injective source-path -> catalogue filename mapping. `~` is rejected in source paths,
 *  so it is a safe separator and no two sources can claim one catalogue file. */
export function dispositionFileName(sourcePath) {
  if (typeof sourcePath !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(sourcePath)) throw new Error(`unsafe disposition source path: ${sourcePath}`);
  if (sourcePath.startsWith('/') || sourcePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) throw new Error(`unsafe disposition source path: ${sourcePath}`);
  if (!ROOTS.some((root) => sourcePath === root || sourcePath.startsWith(`${root}/`))) throw new Error(`disposition source path is outside the discovery roots: ${sourcePath}`);
  return `${sourcePath.replaceAll('/', '~')}.json`;
}

export function discover(root) {
  const rows = [];
  function walk(rel) {
    const full = path.join(root, rel);
    for (const item of fs.readdirSync(full, { withFileTypes: true })) {
      const child = path.join(rel, item.name);
      if (item.isDirectory()) walk(child);
      else if (EXTENSIONS.has(path.extname(item.name)) && !/\.test\./.test(item.name) && !item.name.startsWith('test_')) {
        const sourcePath = child.replaceAll('\\', '/');
        const occurrences = new Map();
        const lines = fs.readFileSync(path.join(root, child), 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
          if (!PATTERN.test(line)) return;
          PATTERN.lastIndex = 0;
          const lineSha256 = sha256(line);
          const occurrence = (occurrences.get(lineSha256) ?? 0) + 1;
          occurrences.set(lineSha256, occurrence);
          rows.push({ source: sourcePath, site: `${sourcePath}:${index + 1}`, semantic_key: `${sourcePath}:${lineSha256}:${occurrence}`, line_sha256: lineSha256 });
        });
      }
    }
  }
  for (const rel of ROOTS) walk(rel);
  return rows.sort((a, b) => a.semantic_key.localeCompare(b.semantic_key));
}

export function groupBySource(rows) {
  const bySource = new Map();
  for (const row of rows) {
    if (!bySource.has(row.source)) bySource.set(row.source, []);
    bySource.get(row.source).push(row);
  }
  return bySource;
}

export function disposition(semanticKey, catalogue) { return catalogue.sites?.find((value) => value.semantic_key === semanticKey); }

/** Reviewed catalogues present on disk, keyed by their declared source path. */
export function readCatalogues(root) {
  const dir = path.join(root, DISPOSITION_DIR);
  const catalogues = new Map();
  if (!fs.existsSync(dir)) return catalogues;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!item.isFile()) throw new Error(`unexpected entry in ${DISPOSITION_DIR}: ${item.name}`);
    if (item.name === 'README.md') continue;
    if (!item.name.endsWith('.json')) throw new Error(`unexpected entry in ${DISPOSITION_DIR}: ${item.name}`);
    const catalogue = JSON.parse(fs.readFileSync(path.join(dir, item.name), 'utf8'));
    if (catalogue.schema_version !== DISPOSITION_SCHEMA_VERSION) throw new Error(`disposition catalogue ${item.name} must declare schema_version ${DISPOSITION_SCHEMA_VERSION}`);
    if (dispositionFileName(catalogue.source) !== item.name) throw new Error(`disposition catalogue ${item.name} does not match its declared source ${catalogue.source}`);
    if (catalogues.has(catalogue.source)) throw new Error(`duplicate disposition catalogue for source ${catalogue.source}`);
    catalogues.set(catalogue.source, catalogue);
  }
  return catalogues;
}

export function run(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const found = discover(root);
  const bySource = groupBySource(found);
  const catalogues = readCatalogues(root);

  for (const [source, catalogue] of catalogues) {
    if (!bySource.has(source)) throw new Error(`truth-audit disposition catalogue describes a source with no discovered call sites and must be retired: ${source}`);
    if (!Array.isArray(catalogue.sites) || catalogue.sites.length === 0) throw new Error(`truth-audit disposition catalogue has no sites: ${source}`);
    if (new Set(catalogue.sites.map((row) => row.semantic_key)).size !== catalogue.sites.length) throw new Error(`truth-audit disposition catalogue has duplicate semantic identities: ${source}`);
    const discoveredKeys = new Set(bySource.get(source).map((row) => row.semantic_key));
    if (catalogue.sites.length !== discoveredKeys.size) throw new Error(`truth-audit semantic inventory drift in ${source}: re-review changed call sites (found ${discoveredKeys.size}, recorded ${catalogue.sites.length})`);
    for (const row of catalogue.sites) if (!discoveredKeys.has(row.semantic_key)) throw new Error(`truth-audit semantic inventory drift in ${source}: contains stale semantic site ${row.site ?? row.semantic_key}`);
  }

  for (const [source, rows] of bySource) {
    const catalogue = catalogues.get(source);
    if (!catalogue) throw new Error(`truth-audit has no reviewed disposition catalogue for ${source}: expected ${DISPOSITION_DIR}/${dispositionFileName(source)}`);
    for (const row of rows) {
      const reviewed = disposition(row.semantic_key, catalogue);
      if (!reviewed || reviewed.line_sha256 !== row.line_sha256 || !['enriched', 'excluded'].includes(reviewed.disposition) || typeof reviewed.reason !== 'string' || reviewed.reason.length < 20) throw new Error(`truth-audit call site has no substantive semantically bound disposition: ${row.site}`);
    }
  }

  // Global count and digest are DERIVED for reporting. They are deliberately not stored in any
  // shared artifact, so unrelated pull requests no longer serialise on one file (issue #2832).
  const digest = sha256(JSON.stringify(found.map((row) => row.semantic_key)));
  return `truth audit OK: call_sites=${found.length} sources=${bySource.size} derived_digest=${digest.slice(0, 12)}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(run()); } catch (error) { console.error(error.message); process.exit(1); }
}
