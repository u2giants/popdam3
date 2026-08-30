#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOTS = ['scripts', '.github/workflows'];
export const EXTENSIONS = new Set(['.mjs', '.js', '.py', '.sh', '.yml', '.yaml']);
export const PATTERN = /\bmissing\b|never created|not applied|NOT_DERIVABLE|_created_by_applied_dynamic_ddl/gi;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

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
          rows.push({ site: `${sourcePath}:${index + 1}`, semantic_key: `${sourcePath}:${lineSha256}:${occurrence}`, line_sha256: lineSha256 });
        });
      }
    }
  }
  for (const rel of ROOTS) walk(rel);
  return rows.sort((a, b) => a.semantic_key.localeCompare(b.semantic_key));
}

export function disposition(semanticKey, audit) { return audit.sites?.find((value) => value.semantic_key === semanticKey); }

export function run(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const audit = JSON.parse(fs.readFileSync(path.join(root, 'docs/verification/throughput-guard-truth-audit-20260828.json'), 'utf8'));
  if (audit.schema_version !== 3) throw new Error('truth-audit schema_version must be 3 with semantic call-site binding');
  const found = discover(root);
  const semanticKeys = found.map((row) => row.semantic_key);
  const digest = sha256(JSON.stringify(semanticKeys));
  if (found.length !== audit.call_site_count || digest !== audit.call_site_sha256) throw new Error(`truth-audit semantic inventory drift: re-review changed call sites (found ${found.length}, recorded ${audit.call_site_count})`);
  if (!Array.isArray(audit.sites) || audit.sites.length !== found.length || new Set(audit.sites.map((row) => row.semantic_key)).size !== audit.sites.length) throw new Error('truth-audit requires exactly one semantically bound disposition per discovered call site');
  for (const row of found) {
    const reviewed = disposition(row.semantic_key, audit);
    if (!reviewed || reviewed.line_sha256 !== row.line_sha256 || !['enriched', 'excluded'].includes(reviewed.disposition) || typeof reviewed.reason !== 'string' || reviewed.reason.length < 20) throw new Error(`truth-audit call site has no substantive semantically bound disposition: ${row.site}`);
  }
  for (const row of audit.sites) if (!semanticKeys.includes(row.semantic_key)) throw new Error(`truth-audit contains stale semantic site: ${row.site}`);
  return `truth audit OK: call_sites=${found.length}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(run()); } catch (error) { console.error(error.message); process.exit(1); }
}
