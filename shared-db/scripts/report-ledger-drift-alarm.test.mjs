import test from 'node:test'
import assert from 'node:assert/strict'
import { publishAlarm, fingerprint, TITLE } from './report-ledger-drift-alarm.mjs'
const version = '20261006170117'
const result = () => ({ target:'production', projectRef:'production', baseRef:'origin/main', drift:{ mergedCount:2, appliedCount:1, mergedNotApplied:[version], intentionallyExcluded:[], foreignTarget:[], actionableMergedNotApplied:[version], appliedNotMerged:[], driftFound:true }, fileByVersion:{[version]:`supabase/migrations/${version}_test.sql`}, pendingClassifications:{[version]:{kind:'genuinely-pending',reason:'requires governed promotion'}} })
const args = () => ({result:result(),report:'Verified actionable version; promotion owner remains unchanged.',repository:'popcre/shared-db',runUrl:'https://github.com/popcre/shared-db/actions/runs/123',event:'push'})
function fixture() {
  let issue={number:2508,title:TITLE,state:'open',body:'Original alarm'}, comments=[], writes=0
  const io={listIssues:()=>[issue],readIssue:()=>issue,listComments:()=>comments,comment:(n,body)=>{writes++;const row={id:writes,body,user:{login:'github-actions[bot]'}};comments.push(row);return row},readComment:id=>comments.find(c=>c.id===id),createIssue:(title,body)=>{writes++;issue={number:2508,title,state:'open',body,user:{login:'github-actions[bot]'}};return issue}}
  return {io,writes:()=>writes,setIssue:row=>{issue=row},setComments:rows=>{comments=rows}}
}
test('automatic push and schedule publish verified drift without claiming clean',()=>{for(const event of ['push','schedule']){const f=fixture();const out=publishAlarm({...args(),event},f.io);assert.equal(out.issue,2508);assert.match(out.message,/NOT a clean/);assert.equal(f.writes(),1)}})
test('unchanged drift produces no daily comment churn',()=>{const f=fixture();publishAlarm(args(),f.io);publishAlarm(args(),f.io);assert.equal(f.writes(),1)})
test('changed reason creates new actionable report',()=>{const f=fixture();publishAlarm(args(),f.io);const next=args();next.result.pendingClassifications[version].reason='new exact dependency';publishAlarm(next,f.io);assert.equal(f.writes(),2)})
test('older matching report never masks intervening changed drift',()=>{const f=fixture();publishAlarm(args(),f.io);const next=args();next.result.pendingClassifications[version].reason='changed';publishAlarm(next,f.io);publishAlarm(args(),f.io);assert.equal(f.writes(),3)})
test('new alarm is durably read back with unchanged title',()=>{const f=fixture();f.io.listIssues=()=>[];assert.equal(publishAlarm(args(),f.io).issue,2508);assert.equal(f.writes(),1)})
test('publication and readback failures refuse success',()=>{for(const method of ['listIssues','readIssue','listComments','comment','readComment']){const f=fixture();f.io[method]=()=>{throw Error('unreadable')};assert.throws(()=>publishAlarm(args(),f.io))}})
test('closed and ambiguous alarms refuse success',()=>{const f=fixture();f.io.listIssues=()=>[{number:2508,state:'open',title:TITLE},{number:2,state:'open',title:TITLE}];assert.throws(()=>publishAlarm(args(),f.io),/multiple/);const g=fixture();g.io.readIssue=()=>({number:2508,state:'closed',title:TITLE});assert.throws(()=>publishAlarm(args(),g.io),/no longer open/)})
test('manual dispatch, preview, invalid data and missing report never become reported success',()=>{for(const modify of [a=>a.event='workflow_dispatch',a=>a.result.target='preview',a=>a.result.drift.appliedCount=0,a=>a.report='',a=>a.runUrl='https://evil.example/123']){const a=args();modify(a);assert.throws(()=>publishAlarm(a,fixture().io))}})
test('actionable fingerprint ignores workflow identity and ordering',()=>{assert.equal(fingerprint(result()),fingerprint(result()))})

test('workflow keeps unknown/manual failures red and gates automatic success on durable publication', async()=>{
  const {readFileSync}=await import('node:fs')
  const s=readFileSync(new URL('../.github/workflows/migration-ledger-drift.yml',import.meta.url),'utf8')
  assert.match(s,/REPORT_CODE.*-ne.*CODE/)
  assert.match(s,/EVENT_NAME.*= "push".*EVENT_NAME.*= "schedule"/)
  assert.match(s,/if: steps\.check\.outputs\.drift == 'true'/)
  assert.match(s,/node scripts\/report-ledger-drift-alarm\.mjs \/tmp\/drift\.json \/tmp\/drift\.txt/)
  assert.match(s,/exit "\$CODE"/)
  assert.doesNotMatch(s,/continue-on-error:/)
})

test('untrusted fingerprint comments do not suppress actionable publication',()=>{const f=fixture();f.setComments([{id:999,body:`<!-- ledger-drift-fingerprint:${fingerprint(result())} -->\nhttps://github.com/popcre/shared-db/actions/runs/1`,user:{login:'outsider'}}]);publishAlarm(args(),f.io);assert.equal(f.writes(),1)})
