#!/usr/bin/env node
// Read-only p95 observation for shared-db outcome #5188.
//
// Times `hts_rag.hts_rag_search_rulings` on the production shared project with
// the clock taken INSIDE the database (one statement per sample), so the number
// is the function's own latency and not Management-API round-trip overhead.
// Writes `${RUNNER_TEMP}/shared-db-5188-observation/observation.json`, which the
// application-side publisher (popcre/designflow-backend) verifies and republishes
// as the outcome's live-proof envelope. The app repository never receives a
// database credential. No writes: every statement is a single SELECT.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PROJECT = 'qsllyeztdwjgirsysgai'
const WORK_ISSUE = 5188
const P95_BUDGET_MS = 300
const SAMPLES = 40
const QUERIES = [
  'ceramic decorative article', 'toys principally designed for amusement',
  'textile made up article', 'furniture designed to be placed on the floor',
  'containers of heading 4202', 'porcelain tableware', 'festive article',
  'mixtures and combinations of materials', 'parts and accessories',
  'incomplete unfinished article', 'packing materials', 'classification of sets',
]

const fail = (message) => { throw new Error(message) }
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]

async function query (sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) fail('SUPABASE_ACCESS_TOKEN is required (read-only Management API)')
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  })
  if (!res.ok) fail(`production query refused (${res.status}): ${await res.text()}`)
  return res.json()
}

async function main () {
  const samples = []
  for (let i = 0; i < SAMPLES; i += 1) {
    const phrase = QUERIES[i % QUERIES.length].replace(/'/g, "''")
    const rows = await query(
      `select round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 2) as ms
         from (select clock_timestamp() as t0) s,
              lateral (select count(*) from hts_rag.hts_rag_search_rulings('${phrase}')) r`)
    const ms = Number(rows[0]?.ms)
    if (!Number.isFinite(ms)) fail(`sample ${i} produced no timing`)
    samples.push(ms)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, 95)
  const observedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  console.log(`ruling search p50=${p50}ms p95=${p95}ms n=${samples.length} (server-side)`)
  if (p95 >= P95_BUDGET_MS) fail(`ruling search p95 ${p95}ms is not under ${P95_BUDGET_MS}ms`)

  const observation = {
    schema_version: 1,
    kind: 'search-p95-observation',
    work_issue: WORK_ISSUE,
    environment: 'production',
    result: 'passed',
    observed_at: observedAt,
    p50_ms: p50,
    p95_ms: p95,
    samples: samples.length,
    budget_ms: P95_BUDGET_MS,
    producer: {
      repository: process.env.GITHUB_REPOSITORY || 'popcre/shared-db',
      run_id: Number(process.env.GITHUB_RUN_ID || 0),
      commit_sha: String(process.env.GITHUB_SHA || '').toLowerCase(),
    },
  }
  const dir = path.join(process.env.RUNNER_TEMP || tmpdir(), 'shared-db-5188-observation')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'observation.json'), `${JSON.stringify(observation, null, 2)}\n`)
  console.log(`observation.json written with observed_at=${observedAt}`)
}

main().catch((error) => { console.error(error.message); process.exit(1) })
