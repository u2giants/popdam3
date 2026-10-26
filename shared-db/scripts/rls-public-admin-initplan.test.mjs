import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { inspectPrStructuralChange, structuralWritesMatch } from './db-flow/admission.mjs'
import { validateClaimObjects } from './lib/lanes/claims.mjs'
import { probeShapeProblem } from './check-live-proof-probe.mjs'

const migration = 'supabase/migrations/20261021190604_public_admin_rls_initplans.sql'
const sql = readFileSync(new URL('../' + migration, import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../docs/verification/rls-initplan/4427/manifest.json', import.meta.url)))
const contract = JSON.parse(readFileSync(new URL('../.agent/work/4427/20/contract.json', import.meta.url)))
const quote = value => '"' + value.replaceAll('"', '""') + '"'

test('the canonical DDL inspector recognizes exactly the admitted policy and table writes', () => {
  const inspected = inspectPrStructuralChange([{ filename: migration, status: 'added', content: sql }])
  assert.equal(structuralWritesMatch(inspected, validateClaimObjects(contract.db_writes)), true)
})

test('each of 44 qualified policies wraps the entire helper and retains absent clauses', () => {
  assert.equal(manifest.target_policies.length, 46)
  assert.equal(new Set(manifest.tables).size, 39)
  assert.equal(manifest.all_overlapping_policies.length, 72)
  assert.equal(manifest.rewrite_tables.length, 37)
  assert.equal(manifest.false_positives.length, 2)
  assert.doesNotMatch(sql, /^ALTER POLICY .* ON "archive"\./m)
  const alters = [...sql.matchAll(/^ALTER POLICY ([\s\S]*?);$/gm)].map(match => match[0])
  assert.equal(alters.length, 44)
  for (const policy of manifest.rewritten_policies) {
    const prefix = `ALTER POLICY ${quote(policy.policyname)} ON ${quote(policy.schemaname)}.${quote(policy.tablename)}\n  `
    const clauses = []
    for (const [field, keyword] of [['qual', 'USING'], ['with_check', 'WITH CHECK']]) {
      if (policy[field] !== null) {
        assert.equal(policy[field], "has_role(auth.uid(), 'admin'::app_role)")
        clauses.push(`${keyword} ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))`)
      }
    }
    assert.ok(alters.includes(prefix + clauses.join('\n  ') + ';'), policy.policyname)
  }
})

test('drift checks cover complete original predicates and preserve metadata and policy unions', () => {
  const targetLiterals = [...sql.matchAll(/\$targets\$([\s\S]*?)\$targets\$::jsonb/g)]
  assert.equal(targetLiterals.length, 2)
  for (const match of targetLiterals) assert.deepEqual(JSON.parse(match[1]), manifest.rewritten_policies)
  assert.match(sql, /actual IS DISTINCT FROM expected/)
  assert.match(sql, /snapshot IS DISTINCT FROM current_setting\('shared_db\.rls4427_before'\)::jsonb/)
  for (const field of ['relowner', 'relacl', 'relrowsecurity', 'relforcerowsecurity', 'attacl', 'pg_get_functiondef', 'proowner', 'proacl', 'proconfig', 'provolatile', 'prosecdef', 'p.roles', 'p.cmd', 'p.permissive', 'p.qual', 'p.with_check']) assert.ok(sql.includes(field), field)
  assert.match(sql, /regexp_replace\(actual\.qual/)
  assert.match(sql, /regexp_replace\(actual\.with_check/)
  assert.doesNotMatch(sql, /\b(?:CREATE|DROP|GRANT|REVOKE|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|FUNCTION|ROLE|POLICY|INTO|FROM)\b/i)
})

// Historical evidence remains tied to the exact archived executable SQL that produced it.
test('retained historical runtime evidence matches its archived SQL and complete measured results', () => {
  const base = new URL('../docs/verification/rls-initplan/4427/', import.meta.url)
  const summary = JSON.parse(readFileSync(new URL('source-runtime-summary.json', base)))
  const packed = readFileSync(new URL('source-runtime-evidence.json.gz', base))
  const raw = gunzipSync(packed)
  const hash = value => createHash('sha256').update(value).digest('hex')
  assert.equal(hash(packed), summary.compressed_sha256)
  assert.equal(hash(raw), summary.uncompressed_sha256)
  const evidence = JSON.parse(raw)
  assert.equal(evidence.ci_run_id, 39154055887)
  assert.equal(evidence.tested_head, '2fbc889e50ccc59090742531e049a1c3232b1778')
  for (const [file, digest] of Object.entries(evidence.source_sha256)) {
    const source = file === 'supabase/tests/rls_public_admin_initplan_contracts.sql'
      ? 'docs/verification/rls-initplan/4427/source-runtime-test-legacy.sql'
      : file
    assert.equal(hash(readFileSync(new URL('../' + source, import.meta.url))), digest, file)
  }
  assert.equal(evidence.access.length, 2124)
  const outcomes = new Map(evidence.access.map(row => [row.phase + ':' + row.context + ':' + row.probe, row.result]))
  assert.equal(outcomes.size, 2124)
  for (const row of evidence.access.filter(row => row.phase === 'original')) {
    assert.deepEqual(outcomes.get('candidate:' + row.context + ':' + row.probe), row.result)
  }
  assert.equal(evidence.performance.samples.length, 198)
  assert.equal(evidence.performance.summary.length, 9)
  assert.equal(evidence.performance.any_regression_requires_investigation, false)
  for (const measured of evidence.performance.summary) assert.equal(measured.requires_regression_investigation, false)
  for (const [name, stats] of Object.entries(summary.initplan_execution_counts)) {
    assert.equal(stats.samples, 33)
    assert.equal(stats.loops_above_1, 0)
    if (name.startsWith('candidate ')) assert.equal(stats.initplans, stats.loops_equal_1)
  }
})

test('current batched runtime evidence binds the complete current source and plan matrix', () => {
  const base = new URL('../docs/verification/rls-initplan/4427/batched-20261025/', import.meta.url)
  const summary = JSON.parse(readFileSync(new URL('source-runtime-summary.json', base)))
  const packed = readFileSync(new URL('source-runtime-evidence.json.gz', base))
  const raw = gunzipSync(packed)
  const hash = value => createHash('sha256').update(value).digest('hex')
  assert.equal(hash(packed), summary.compressed_sha256)
  assert.equal(hash(raw), summary.uncompressed_sha256)
  const evidence = JSON.parse(raw)
  const sourceFiles = [
    'supabase/migrations/20261021190604_public_admin_rls_initplans.sql',
    'supabase/tests/rls_public_admin_initplan_contracts.sql',
  ]
  assert.equal(evidence.ci_run_id, 40231840088)
  assert.equal(evidence.tested_head, 'feca7cdb0f1fcb0dc4601a2383a9adcfd1508a12')
  assert.equal(summary.ci_run_id, evidence.ci_run_id)
  assert.equal(summary.tested_head, evidence.tested_head)
  assert.deepEqual(Object.keys(evidence.source_sha256).sort(), sourceFiles)
  assert.deepEqual(evidence.source_sha256, summary.source_sha256)
  for (const file of sourceFiles) {
    assert.equal(hash(readFileSync(new URL('../' + file, import.meta.url))), evidence.source_sha256[file], file)
  }
  assert.equal(evidence.production_proof, false)
  assert.equal(summary.production_proof, false)
  assert.deepEqual(summary.provenance, evidence.provenance)
  assert.equal(evidence.provenance.raw_log_sha256, '5479ff706e85ce50a9c2883828916c0316d4a2b49d40adb2612d3fde7e740d13')
  assert.equal(evidence.provenance.artifact_id, 12613812802)
  assert.equal(evidence.provenance.artifact_digest, 'sha256:304c204ffe6205c714c9ba85b8485aa75c6885ac8e54ecaffda0a648cdfaf035')

  assert.equal(evidence.access.length, 2124)
  const outcomes = new Map(evidence.access.map(row => [row.phase + ':' + row.context + ':' + row.probe, row.result]))
  assert.equal(outcomes.size, 2124)
  assert.equal(evidence.access.filter(row => row.phase === 'original').length, 1062)
  assert.equal(evidence.access.filter(row => row.phase === 'candidate').length, 1062)
  for (const row of evidence.access.filter(row => row.phase === 'original')) {
    assert.deepEqual(outcomes.get('candidate:' + row.context + ':' + row.probe), row.result)
  }

  const samples = evidence.performance.samples
  assert.equal(samples.length, 198)
  const sampleKeys = samples.map(row => [row.cardinality, row.command, row.sample, row.variant].join(':'))
  assert.equal(new Set(sampleKeys).size, 198)
  assert.deepEqual([...new Set(samples.map(row => row.cardinality))].sort((a, b) => a - b), [1, 100, 10000])
  assert.deepEqual([...new Set(samples.map(row => row.command))].sort(), ['DELETE', 'INSERT', 'UPDATE'])
  assert.deepEqual([...new Set(samples.map(row => row.sample))].sort((a, b) => a - b), [...Array(11).keys()])
  assert.deepEqual([...new Set(samples.map(row => row.variant))].sort(), ['candidate', 'original'])
  for (const row of samples) {
    assert.equal(row.returned_rows, row.cardinality)
    assert.equal(row.raw_plan[0].Plan['Actual Rows'], row.cardinality)
    assert.equal(row.warmup, row.sample === 0)
  }
  assert.equal(evidence.performance.summary.length, 9)
  assert.equal(evidence.performance.any_regression_requires_investigation, false)
  for (const measured of evidence.performance.summary) {
    assert.equal(measured.original_samples, 10)
    assert.equal(measured.candidate_samples, 10)
    assert.equal(measured.requires_regression_investigation, false)
  }

  const initplanStats = {}
  for (const row of samples) {
    const key = `${row.variant} admin_config ${row.command}`
    const stats = initplanStats[key] ??= { samples: 0, initplans: 0, loops_equal_1: 0, loops_above_1: 0 }
    stats.samples += 1
    const visit = plan => {
      if (plan['Parent Relationship'] === 'InitPlan') {
        stats.initplans += 1
        if (plan['Actual Loops'] === 1) stats.loops_equal_1 += 1
        if (plan['Actual Loops'] > 1) stats.loops_above_1 += 1
      }
      for (const child of plan.Plans ?? []) visit(child)
    }
    for (const plan of row.raw_plan) visit(plan.Plan)
  }
  assert.deepEqual(initplanStats, summary.initplan_execution_counts)
  assert.deepEqual(Object.values(initplanStats).map(stats => stats.samples), [33, 33, 33, 33, 33, 33])
  const candidateStats = Object.entries(initplanStats).filter(([name]) => name.startsWith('candidate '))
  assert.equal(candidateStats.reduce((total, [, stats]) => total + stats.initplans, 0), 264)
  assert.equal(candidateStats.filter(([name]) => name.endsWith(' UPDATE'))
    .every(([, stats]) => stats.initplans === 132), true)
  assert.equal(candidateStats.filter(([name]) => name.endsWith(' INSERT') || name.endsWith(' DELETE'))
    .every(([, stats]) => stats.initplans === 66), true)
  assert.equal(candidateStats.every(([, stats]) => stats.loops_above_1 === 0 && stats.loops_equal_1 === stats.initplans), true)
  assert.equal(Object.entries(initplanStats).filter(([name]) => name.startsWith('original '))
    .every(([, stats]) => stats.initplans === 0), true)
})

test('automatic live probe binds the complete installed catalog without authorizing closure', () => {
  const probe = readFileSync(new URL('../.github/live-proofs/4427.sql', import.meta.url), 'utf8')
  assert.equal(probeShapeProblem(probe), null)
  const snapshots = [...probe.matchAll(/\$baseline\$([\s\S]*?)\$baseline\$::jsonb/g)].map(match => JSON.parse(match[1]))
  assert.equal(snapshots.length, 3)
  const [policies, tables, helpers] = snapshots
  assert.equal(policies.length, 72)
  assert.equal(new Set(policies.map(p => p.oid)).size, 72)
  assert.equal(tables.length, 39)
  assert.equal(helpers.length, 2)
  const key = p => [p.schemaname, p.tablename, p.policyname].join(':')
  const rewritten = new Set(manifest.rewritten_policies.map(key))
  for (const baseline of manifest.all_overlapping_policies) {
    const actual = policies.find(p => key(p) === key(baseline))
    assert.ok(actual)
    for (const field of ['cmd','roles','permissive']) assert.deepEqual(actual[field], baseline[field])
    for (const field of ['qual','with_check']) {
      assert.equal(actual[field], rewritten.has(key(baseline)) && baseline[field] !== null
        ? "( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)" : baseline[field])
    }
  }
  for (const field of ['e.column_acl','c.relacl','c.relrowsecurity','c.relforcerowsecurity','p.proconfig','p.proacl','pg_get_functiondef','pg_has_role','has_schema_privilege','has_table_privilege']) assert.ok(probe.includes(field), field)
  assert.match(probe, /version='20261021190604'/)
  assert.match(probe, /r\.oid<>c\.relowner or c\.relforcerowsecurity/)
  assert.match(probe, /Passing does not close4427 or release4428/)
})

// The retained-evidence checks must run in the required offline CI context.
test('required offline CI executes the admin qualification suite on engineering changes', () => {
  const workflow = readFileSync(new URL('../.github/workflows/tools-offline-tests.yml', import.meta.url), 'utf8')
  const step = workflow.split('      - name: ').find(value => value.startsWith('Verify RLS admin source and retained runtime evidence (#4427)\n'))
  assert.ok(step, 'missing required offline CI step')
  assert.match(step, /^        if: steps\.route\.outputs\.pure_prose != 'true'$/m)
  assert.match(step, /set -euo pipefail\n          node --test scripts\/rls-public-admin-initplan\.test\.mjs\n/)
  assert.doesNotMatch(step, /continue-on-error|\|\| true/)
})
