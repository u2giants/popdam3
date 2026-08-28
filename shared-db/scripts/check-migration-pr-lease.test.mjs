import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { declarationCoversActual, flattenPages, validateMigrationLease } from './check-migration-pr-lease.mjs'
import { claimBody } from './manage-migration-author-lanes.mjs'
const now=new Date('2026-08-14T20:00:00Z')
const claim=(overrides={})=>({number:12,body:claimBody({version:'20260814170219',objects:['table core.x'],owner:'a',branch:'codex/x',worktree:'C:/w',expiresAt:new Date('2026-08-15T00:00:00Z'),...overrides})})
const file=(sql='create table core.x(id bigint);')=>({filename:'supabase/migrations/20260814170219_x.sql',status:'added',sql})
const run=(x={})=>validateMigrationLease({claims:[claim()],branch:'codex/x',files:[file()],now,reservationExists:()=>true,...x})
test('valid migration is bound to branch, exact version, object claim and reservation',()=>assert.equal(run().claim,12))
test('migration PR without a claim fails',()=>assert.throws(()=>run({claims:[]}),/exactly one/))
test('exact issue 1750 code-truth restoration needs no structural claim but altered bytes do',()=>{
  const filename='supabase/migrations/20260828052706_sync_dflow_columns_onto_plm_designflow_copies.sql'
  const sql=readFileSync(filename,'utf8')
  const result=run({claims:[],files:[{filename,status:'added',sql}]})
  assert.equal(result.relevant,false)
  assert.equal(result.historicalCodeTruth,true)
  assert.throws(()=>run({claims:[],files:[{filename,status:'added',sql:sql+'-- changed\n'}]}),/exactly one/)
})
test('legacy-only claim fails',()=>assert.throws(()=>run({claims:[{number:1,body:'```db-claim\nversion: none\nobjects:\n - table core.x\n```'}]}),/exactly one/))
test('wrong branch fails',()=>assert.throws(()=>run({branch:'codex/other'}),/exactly one/))
test('expired lease fails',()=>assert.throws(()=>run({claims:[claim({expiresAt:new Date('2026-08-14T19:00:00Z')})]}),/expired/))
test('wrong version and missing reservation fail',()=>{assert.throws(()=>run({files:[{...file(),filename:'supabase/migrations/20260814170220_x.sql'}]}),/version/);assert.throws(()=>run({reservationExists:()=>false}),/reservation/)})
test('undeclared written object fails',()=>assert.throws(()=>run({files:[file('alter table core.y add column x text;')]}),/undeclared.*core.y/))
test('declared parent table covers parsed columns on that table',()=>{
  const result=run({files:[file("comment on column core.x.code is 'owned by core.x';")]})
  assert.deepEqual(result.objects,['column core.x.code','table core.x'])
  assert.equal(declarationCoversActual(new Set(['table core.x']),'column core.x.code'),true)
})
test('declared parent table does not cover another table columns',()=>{
  assert.equal(declarationCoversActual(new Set(['table core.x']),'column core.y.code'),false)
  assert.throws(()=>run({files:[file("comment on column core.y.code is 'not core.x';")]}),/undeclared.*column core.y.code/)
})
test('empty SQL fails closed',()=>assert.throws(()=>run({files:[file('')]}),/empty SQL/))
test('non-migration PR is not relevant',()=>assert.equal(run({claims:[],files:[{filename:'README.md',status:'modified',sql:''}]}).relevant,false))
test('pagination includes more than 100 records',()=>{
  const rows=flattenPages([Array.from({length:100},(_,i)=>i),[100]])
  assert.equal(rows.length,101);assert.equal(rows.at(-1),100)
})
test('malformed or missing later page fails closed',()=>{
  assert.throws(()=>flattenPages([Array(100),null],'page two'),/malformed/)
  assert.throws(()=>flattenPages({items:[]},'not pages'),/malformed/)
})
test('101 migration files are all validated, including the last file',()=>{
  const files=Array.from({length:101},(_,i)=>({filename:`supabase/migrations/20260814170219_${i}.sql`,status:'added',sql:i===100?'alter table core.y add column z int;':'alter table core.x add column z int;'}))
  assert.throws(()=>run({files}),/undeclared.*core.y/)
})
