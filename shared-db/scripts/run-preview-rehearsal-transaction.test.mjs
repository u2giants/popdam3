import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRehearsalSql, PRODUCTION_PROJECT_REF, validateRehearsal } from './run-preview-rehearsal-transaction.mjs'

const good={projectRef:'mvpkijzfmfcxhnzqogzs',fixtureId:'AI-PERF-20260830-inventory',databaseUrl:'postgresql://postgres.mvpkijzfmfcxhnzqogzs:redacted@host/postgres',sql:'insert into dflow.sample (sample_name) values (current_setting(\'app.fixture_id\'));\nselect count(*) from dflow.sample;'}

test('a preview rehearsal is wrapped in one rollback-only transaction',()=>{
  validateRehearsal(good)
  const wrapped=buildRehearsalSql(good)
  assert.match(wrapped,/TARGET_PROOF preview=mvpkijzfmfcxhnzqogzs/)
  assert.ok(wrapped.indexOf('BEGIN;') < wrapped.indexOf(good.sql) && wrapped.indexOf(good.sql) < wrapped.indexOf('ROLLBACK;'))
  assert.match(wrapped,/set_config\('app.fixture_id', 'AI-PERF-20260830-inventory', true\)/)
})

test('production and an unproved connection are hard-refused',()=>{
  assert.throws(()=>validateRehearsal({...good,projectRef:PRODUCTION_PROJECT_REF,databaseUrl:`postgresql://postgres.${PRODUCTION_PROJECT_REF}:x@host/postgres`}),/refusing production/)
  assert.throws(()=>validateRehearsal({...good,databaseUrl:'postgresql://postgres.somewhereelse:x@host/postgres'}),/does not prove/)
  assert.throws(()=>validateRehearsal({...good,databaseUrl:`postgresql://postgres.${PRODUCTION_PROJECT_REF}:mvpkijzfmfcxhnzqogzs@host/postgres`}),/names production/)
  assert.throws(()=>validateRehearsal({...good,databaseUrl:'https://postgres.mvpkijzfmfcxhnzqogzs:x@host/postgres'}),/not a PostgreSQL URL/)
})

test('SQL cannot escape or weaken the rollback boundary',()=>{
  for (const sql of ['commit;','rollback;','begin; select 1;','\\i unsafe.sql','vacuum dflow.sample','alter system set work_mem=1']) {
    assert.throws(()=>validateRehearsal({...good,sql}),/cannot|not allowed/)
  }
})

test('fixture identity is explicit and bounded',()=>{
  for (const fixtureId of ['inventory','AI-PERF-inventory','AI-PERF-20260830-x;drop','AI-PERF-20260830-']) assert.throws(()=>validateRehearsal({...good,fixtureId}),/fixture id/)
})

test('the secret URL is inherited by psql and never placed in its command arguments',()=>{
  const source=new URL('./run-preview-rehearsal-transaction.mjs',import.meta.url)
  return import('node:fs').then(({readFileSync})=>{
    const text=readFileSync(source,'utf8')
    assert.match(text,/PGDATABASE:databaseUrl/)
    assert.doesNotMatch(text,/spawnSync\('psql',[^\n]*databaseUrl/)
  })
})

// The cases external review (grok-4.6, PR #1951) found. Each of these reached
// production, or ended the rehearsal transaction, under the first version.

test('a query parameter cannot redirect the connection past the identity check',()=>{
  const preview='postgresql://postgres.mvpkijzfmfcxhnzqogzs:x@preview-host/postgres'
  for (const suffix of ['?host=db.'+PRODUCTION_PROJECT_REF+'.supabase.co','?hostaddr=203.0.113.9','?user=postgres.'+PRODUCTION_PROJECT_REF,'?port=6543','?dbname=other']) {
    assert.throws(()=>validateRehearsal({...good,databaseUrl:preview+suffix}),/can redirect the connection/)
  }
})

test('a URL with no host is refused instead of letting libpq choose one',()=>{
  assert.throws(()=>validateRehearsal({...good,databaseUrl:'postgresql:///postgres'}),/names no host/)
  assert.throws(()=>validateRehearsal({...good,databaseUrl:'postgresql://postgres.mvpkijzfmfcxhnzqogzs:x@/postgres'}),/names no host|not a valid PostgreSQL URL/)
})

test('production is recognised whatever its case and wherever it appears',()=>{
  const upper=PRODUCTION_PROJECT_REF.toUpperCase()
  assert.throws(()=>validateRehearsal({...good,databaseUrl:'postgresql://postgres.'+upper+':x@preview-host/postgres'}),/names production/)
  assert.throws(()=>validateRehearsal({...good,databaseUrl:'postgresql://postgres.mvpkijzfmfcxhnzqogzs:x@host/'+PRODUCTION_PROJECT_REF}),/names production/)
  assert.throws(()=>validateRehearsal({...good,databaseUrl:'postgresql://postgres.mvpkijzfmfcxhnzqogzs:x@host/postgres#'+PRODUCTION_PROJECT_REF}),/fragment/)
})

test('END and ABORT end the transaction and are refused like COMMIT',()=>{
  for (const sql of ['select 1; end;','select 1; abort;','SELECT 1;  END WORK;','ABORT;']) {
    assert.throws(()=>validateRehearsal({...good,sql}),/cannot end its transaction/)
  }
})

test('a CASE expression is still allowed',()=>{
  validateRehearsal({...good,sql:'select case when 1=1 then 2 else 3 end from dflow.sample;'})
})

test('a meta-command is refused after a semicolon, not only at the start of a line',()=>{
  for (const sql of ['select 1; BSi unsafe.sql','select 1; BSconnect postgres://elsewhere','select 1 BSg','select 1 BS; select 2'].map(v=>v.replaceAll('BS',String.fromCharCode(92)))) {
    assert.throws(()=>validateRehearsal({...good,sql}),/meta-commands are not allowed/)
  }
})

test('the wrapper proves the transaction is still open before it rolls back',()=>{
  const wrapped=buildRehearsalSql(good)
  assert.match(wrapped,/set_config\('app.rehearsal_open', '1', true\)/)
  assert.ok(wrapped.indexOf("current_setting('app.rehearsal_open')") < wrapped.indexOf('ROLLBACK;'))
  assert.ok(wrapped.indexOf(good.sql) < wrapped.indexOf("current_setting('app.rehearsal_open')"))
})
