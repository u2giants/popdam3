import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probeShapeProblem } from './check-live-proof-probe.mjs';

const sql = readFileSync(new URL('../.github/live-proofs/2863.sql', import.meta.url), 'utf8');
// Strip only comments so predicates hidden in comments cannot satisfy assertions.
function stripComments(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}
const code = stripComments(sql);

// Split CTEs so each endpoint can be pinned alone.
function cteBody(name, source = code) {
  const re = new RegExp(`${name} AS \\(([\\s\\S]*?)\\)\\s*,?\\s*(?:prod_replay|SELECT)`, 'i');
  const m = source.match(re);
  assert.ok(m, `CTE ${name} must exist in the probe`);
  return m[1];
}
const prepack = cteBody('prepack_replay');
const prod = cteBody('prod_replay');

test('recovered replay proof passes the production single-read-statement guard', () => {
  assert.equal(probeShapeProblem(sql), null);
});

test('both required endpoint witnesses are conjunctive, never alternative evidence', () => {
  assert.match(code, /SELECT EXISTS \(SELECT 1 FROM prepack_replay\)\s+AND EXISTS \(SELECT 1 FROM prod_replay\)/);
  assert.doesNotMatch(code, /\b(?:10111|10119|17303|7263)\b/);
});

test('each CTE names its own endpoint and succeeded status', () => {
  assert.match(prepack, /r\.endpoint = '\/prepackDetail'/);
  assert.match(prod, /r\.endpoint = '\/proddetails'/);
  assert.match(prepack, /r\.status = 'succeeded'/);
  assert.match(prod, /r\.status = 'succeeded'/);
});

test('both replay CTEs read current and prior runs from coldlion.sync_run', () => {
  for (const cte of [prepack, prod]) {
    assert.match(cte, /FROM coldlion\.sync_run r\b/);
    assert.match(cte, /FROM coldlion\.sync_run prior\b/);
  }
});

test('prepack replay run requires fullSnapshot, independent of its prior run', () => {
  assert.match(prepack, /\br\.request_params->>'fullSnapshot' = 'true'/);
});

test('positivity and ordering guards are pinned on the replay run', () => {
  assert.match(prepack, /r\.rows_unchanged > 0/);
  assert.match(prepack, /r\.rows_fetched >= r\.rows_unchanged/);
  assert.match(prepack, /r\.finished_at >= r\.started_at/);
  assert.match(prod, /r\.rows_fetched > 0/);
  assert.match(prod, /r\.rows_fetched = r\.rows_unchanged/);
  assert.match(prod, /r\.finished_at >= r\.started_at/);
});

test('idempotent replay: the replay run (r., not prior.) inserts and updates nothing', () => {
  for (const cte of [prepack, prod]) {
    assert.match(cte, /(?<![a-z])r\.rows_inserted = 0/);
    assert.match(cte, /(?<![a-z])r\.rows_updated = 0/);
  }
});

test('no duplicate collapse: every replay run has an empty change_log', () => {
  for (const cte of [prepack, prod]) {
    assert.match(cte, /NOT EXISTS \(SELECT 1 FROM coldlion\.change_log c WHERE c\.run_id = r\.id\)/);
  }
});

test('stable row counts: prior run counts match or conserve the replay', () => {
  assert.match(prepack, /prior\.rows_fetched = r\.rows_fetched/);
  assert.match(prepack, /prior\.rows_unchanged = r\.rows_unchanged/);
  assert.match(prod, /prior\.rows_fetched = r\.rows_fetched/);
  assert.match(prod, /prior\.rows_fetched = prior\.rows_inserted \+ prior\.rows_updated \+ prior\.rows_unchanged/);
});

test('lands and re-lands: each CTE requires its own prior succeeded run with matching identity', () => {
  for (const cte of [prepack, prod]) {
    assert.match(cte, /prior\.status = 'succeeded' AND prior\.finished_at < r\.started_at/);
    assert.match(cte, /prior\.endpoint = r\.endpoint/);
    assert.match(cte, /prior\.company_code = r\.company_code/);
  }
});

test('prior sample identity is pinned for both endpoints', () => {
  assert.match(prepack, /prior\.request_params->>'fullSnapshot' = 'true'/);
  assert.match(prepack, /prior\.request_params->'coveredKeys' = r\.request_params->'coveredKeys'/);
  assert.match(prod, /prior\.request_params->>'prodOrderNo' = r\.request_params->>'prodOrderNo'/);
});

test('prior idempotence and history are pinned', () => {
  assert.match(prepack, /prior\.rows_inserted = 0 AND prior\.rows_updated = 0/);
  assert.match(prepack, /NOT EXISTS \(SELECT 1 FROM coldlion\.change_log c WHERE c\.run_id = prior\.id\)/);
});

test('table counts equal run counts on both the run-scoped and population-scoped sides', () => {
  assert.match(prepack, /count\(\*\) FROM coldlion\.prepack_detail d[\s\S]*?d\.run_id = r\.id\)\s*= r\.rows_unchanged/);
  assert.match(prepack, /count\(\*\) FROM coldlion\.prepack_detail d[\s\S]*?d\.company_code = r\.company_code\)\s*= r\.rows_unchanged/);
  assert.match(prod, /count\(\*\) FROM coldlion\.prod_detail d[\s\S]*?d\.run_id = r\.id\)\s*= r\.rows_fetched/);
  // Full comparison including RHS — not just the prefix.
  assert.match(prod, /d\.prod_order_no::text = r\.request_params->>'prodOrderNo'\)\s*= r\.rows_fetched/);
});

test('sample identity keys are pinned for both endpoints', () => {
  assert.match(prepack, /fullSnapshot/);
  assert.match(prepack, /coveredKeys/);
  assert.match(prod, /prodOrderNo/);
});

// A landing-table count compared to a bare integer is a hardcoded total.
const LANDING_COUNT = /\(SELECT count\(\*\) FROM coldlion\.(?:prepack_detail|prod_detail)(?:(?!\(SELECT)[\s\S])*?\)\s*=\s*\d+/;
test('counts are derived from loader evidence, never hardcoded expected totals', () => {
  assert.doesNotMatch(stripComments(sql), LANDING_COUNT);
});

// ---- false controls: mutate a real copy of the probe, then assert the SAME
// structural checks against the weakened copy. Each one must fail.

function assertStructuralComplete(text) {
  const noise = stripComments(text);
  // Conjunctive witnesses.
  assert.match(noise, /SELECT EXISTS \(SELECT 1 FROM prepack_replay\)\s+AND EXISTS \(SELECT 1 FROM prod_replay\)/);
  for (const name of ['prepack_replay', 'prod_replay']) {
    const body = cteBody(name, noise);
    assert.match(body, /FROM coldlion\.sync_run r\b/);
    assert.match(body, /FROM coldlion\.sync_run prior\b/);
  }
  assert.match(cteBody('prepack_replay', noise), /\br\.request_params->>'fullSnapshot' = 'true'/);
  // Idempotence on the replay run.
  assert.match(noise, /(?<![a-z])r\.rows_inserted = 0/);
  assert.match(noise, /(?<![a-z])r\.rows_updated = 0/);
  // Empty change_log.
  assert.match(noise, /NOT EXISTS \(SELECT 1 FROM coldlion\.change_log c WHERE c\.run_id = r\.id\)/);
  // Prior-run binding.
  assert.match(noise, /prior\.rows_fetched = r\.rows_fetched/);
  assert.match(noise, /prior\.endpoint = r\.endpoint/);
  assert.match(noise, /prior\.company_code = r\.company_code/);
  // Positivity/ordering.
  assert.match(noise, /r\.rows_unchanged > 0/);
  assert.match(noise, /r\.finished_at >= r\.started_at/);
  // Table counts.
  assert.match(noise, /count\(\*\) FROM coldlion\.prepack_detail/);
  assert.match(noise, /count\(\*\) FROM coldlion\.prod_detail/);
  // Hardcoded-total ban.
  assert.doesNotMatch(stripComments(text), LANDING_COUNT);
}

function replaceInCte(text, name, target, replacement) {
  const body = cteBody(name, text);
  assert.ok(body.includes(target), `${name} must contain the mutation target`);
  return text.replace(body, body.replace(target, replacement));
}

test('false controls: swapping any replay or prior run source breaks the structural gate', () => {
  for (const name of ['prepack_replay', 'prod_replay']) {
    for (const alias of ['r', 'prior']) {
      const weakened = replaceInCte(sql, name,
        `FROM coldlion.sync_run ${alias}`, `FROM ingest.sync_run ${alias}`);
      assert.throws(() => assertStructuralComplete(weakened), /did not match/);
    }
  }
});

test('false control: dropping replay fullSnapshot breaks the structural gate', () => {
  const weakened = replaceInCte(sql, 'prepack_replay',
    "AND r.request_params->>'fullSnapshot' = 'true'",
    "-- AND r.request_params->>'fullSnapshot' = 'true'");
  assert.throws(() => assertStructuralComplete(weakened), /did not match/);
});

test('false control: dropping the prepack witness breaks the structural gate', () => {
  const weakened = sql.replace(/SELECT EXISTS \(SELECT 1 FROM prepack_replay\)\s+AND EXISTS \(SELECT 1 FROM prod_replay\)/,
    'SELECT EXISTS (SELECT 1 FROM prod_replay)');
  assert.throws(() => assertStructuralComplete(weakened), /did not match/);
});

test('false control: dropping the prod witness breaks the structural gate', () => {
  const weakened = sql.replace(/SELECT EXISTS \(SELECT 1 FROM prepack_replay\)\s+AND EXISTS \(SELECT 1 FROM prod_replay\)/,
    'SELECT EXISTS (SELECT 1 FROM prepack_replay)');
  assert.throws(() => assertStructuralComplete(weakened), /did not match/);
});

test('false control: commenting out rows_updated alone breaks the structural gate', () => {
  const weakened = sql.replaceAll('AND r.rows_updated = 0', '-- AND r.rows_updated = 0');
  assert.throws(() => assertStructuralComplete(weakened), /did not match/);
});

test('false control: commenting out prior identity breaks the structural gate', () => {
  const weakened = sql.replaceAll('prior.endpoint = r.endpoint', '-- prior.endpoint = r.endpoint');
  assert.throws(() => assertStructuralComplete(weakened), /did not match/);
});

test('false control: commenting out positivity breaks the structural gate', () => {
  const weakened = sql.replace('AND r.rows_unchanged > 0', '-- AND r.rows_unchanged > 0');
  assert.throws(() => assertStructuralComplete(weakened), /did not match/);
});

test('false control: a hardcoded count trips the landing-count shape', () => {
  const weakened = sql.replace(') = r.rows_unchanged', ') = 42');
  assert.match(stripComments(weakened), LANDING_COUNT);
  assert.doesNotMatch(stripComments(sql), LANDING_COUNT);
});

test('false control: a write statement is refused by the probe shape guard', () => {
  assert.notEqual(probeShapeProblem('DELETE FROM coldlion.prepack_detail'), null);
  assert.notEqual(probeShapeProblem('SELECT true as passed; DROP TABLE coldlion.prod_detail'), null);
});

test('RLS on both named landing tables and privilege denial posture are pinned', () => {
  // Both named landing tables have RLS; this is not a schema-wide census.
  assert.match(code, /n\.nspname = 'coldlion'/);
  assert.match(code, /c\.relname IN \('prepack_detail','prod_detail'\)/);
  assert.match(code, /c\.relkind = 'r' AND c\.relrowsecurity\)\s*=\s*2/);
  // Privilege denial: anon and authenticated hold no table privilege.
  assert.match(code, /NOT EXISTS \(\s*SELECT 1 FROM \(VALUES \('coldlion\.prepack_detail'\),\('coldlion\.prod_detail'\)\) t\(name\)/);
  assert.match(code, /CROSS JOIN \(VALUES \('anon'\),\('authenticated'\)\) roles\(name\)/);
  assert.match(code, /has_table_privilege\(roles\.name, t\.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'\)/);
  // service_role retains SELECT.
  assert.match(code, /has_table_privilege\('service_role','coldlion\.prepack_detail','SELECT'\)/);
  assert.match(code, /has_table_privilege\('service_role','coldlion\.prod_detail','SELECT'\)/);
});
