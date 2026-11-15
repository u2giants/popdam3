#!/usr/bin/env node
// Writes the production migration ledger (versions only) to a file for
// scripts/automatic_promotion_candidates.py (#6352). Read-only: ONE constant
// SELECT through the existing ledger reader. On any read failure it writes
// nothing and exits 0, so the selector keeps its run-evidence behaviour.
import fs from 'node:fs'
import { fetchAppliedVersions, PROJECT_REFS } from './db-flow/read-preview-ledger.mjs'

const out = process.argv[2]
if (!out) { console.error('usage: write-production-ledger.mjs <out.json>'); process.exit(2) }
try {
  const versions = await fetchAppliedVersions(PROJECT_REFS.production)
  if (!Array.isArray(versions) || versions.length === 0) throw new Error('empty ledger')
  fs.writeFileSync(out, JSON.stringify(versions))
  console.log(`production ledger: ${versions.length} applied versions`)
} catch (error) {
  console.log(`::warning::production ledger unreadable (${error.message}); selector uses run evidence only`)
}
