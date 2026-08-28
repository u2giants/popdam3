#!/usr/bin/env node
import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { validateAll } from './throughput-guard/ledger-lib.mjs';
export function run(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) { const r=validateAll(root); return `blocker ledger OK: incidents=${r.entries.length} fixtures=${r.fixtures.length}`; }
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) { try { console.log(run()); } catch(e) { console.error(`INVALID: ${e.message}`); process.exit(1); } }
