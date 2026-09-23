import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMergedPrIssueBinding, verifyMergedPrIssueBinding, withMergedPrIssueBinding, resolveAdmittedIssueForPr, reviewTargetIsRecordable } from './manage-migration-author-lanes.mjs'

test('verdict recording accepts a merged PR only through the same verified binding',()=>{
  const open={state:'open',head:{sha:HEAD}}
  const {io}=fixture()
  assert.equal(reviewTargetIsRecordable(open,{pr:9,issue:1,headSha:HEAD},io),true,'an open exact head is unchanged')
  assert.equal(reviewTargetIsRecordable({...open,head:{sha:'1'.repeat(40)}},{pr:9,issue:1,headSha:HEAD},io),false)
  const merged={state:'closed',merged_at:'2026-09-11T22:49:13Z',head:{sha:HEAD}}
  assert.equal(reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},io),false,'no binding, no merged verdict')
  const bound=withMergedPrIssueBinding(io,'2726:2506',()=>{})
  assert.equal(reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},bound),true)
  assert.equal(reviewTargetIsRecordable(merged,{pr:2726,issue:2507,headSha:HEAD},bound),false,'a different issue refuses')
  assert.equal(reviewTargetIsRecordable(merged,{pr:2727,issue:2506,headSha:HEAD},bound),false,'a different PR refuses')
  assert.equal(reviewTargetIsRecordable({...merged,head:{sha:'1'.repeat(40)}},{pr:2726,issue:2506,headSha:HEAD},bound),false,'a different head refuses')
  assert.equal(reviewTargetIsRecordable({state:'closed',head:{sha:HEAD}},{pr:2726,issue:2506,headSha:HEAD},bound),false,'closed unmerged refuses')
  const closedIssue=fixture({issueState:'closed'})
  assert.throws(()=>reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},withMergedPrIssueBinding(closedIssue.io,'2726:2506',()=>{})),/is not open/)
})

const HEAD='f'.repeat(40)
function fixture(overrides={}){
  const state={
    pr:{number:2726,merged_at:'2026-09-11T22:49:13Z',merge_commit_sha:'e'.repeat(40),head:{sha:HEAD,ref:'codex/issue-2506-production-performance-2714'},body:'Repairs #2506.\n\nWork issue #2506; active claim #2722; orchestrator #2714.'},
    completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429']},
    files:[{filename:'.agent/contract.json',status:'added'},{filename:'.agent/completion.json',status:'added'},{filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'added'}],
    linked:[],
    refs:new Set(['refs/db-claims/20260911213429']),
    ...overrides,
  }
  const io={
    getPr:()=>state.pr?{changed_files:state.files.length,...state.pr}:state.pr,
    getIssue:(n)=>({number:n,state:state.issueState??'open'}),
    getFileAt:(file,ref)=>{assert.equal(file,state.completionPath??'.agent/completion.json');assert.equal(ref,HEAD);return typeof state.completion==='string'?state.completion:JSON.stringify(state.completion)},
    getPrFiles:()=>state.files,
    readRef:(ref)=>state.refs.has(ref)?'a'.repeat(40):null,
    closingIssuesForPr:(n)=>{state.closingCalls=(state.closingCalls??0)+1;return state.linked},
  }
  return {io,state}
}

test('binding parses only exact PR:ISSUE',()=>{
  assert.deepEqual(parseMergedPrIssueBinding('2726:2506'),{pr:2726,issue:2506})
  for(const bad of ['2506','2726:','x:1','0:1','2726:2506:1','2726, 2506'])assert.throws(()=>parseMergedPrIssueBinding(bad),/exactly PR:ISSUE/)
})

test('a merged PR with no closing link binds when every record agrees',()=>{
  const {io}=fixture(),lines=[]
  const bound=withMergedPrIssueBinding(io,'2726:2506',(line)=>lines.push(line))
  assert.deepEqual(bound.closingIssuesForPr(2726),[{number:2506,state:'open',bound:true}])
  assert.match(lines[0],/PR #2726 -> issue #2506/)
  assert.deepEqual(bound.closingIssuesForPr(9),[],'other PRs keep their real closing links')
  const lazy=fixture({pr:null}),other=withMergedPrIssueBinding(lazy.io,'2726:2506')
  assert.deepEqual(other.closingIssuesForPr(9),[],'an unrelated PR never triggers verification')
  assert.equal(bound.getPr().number,2726,'every other io method is inherited')
})

test('a real matching closing link wins and a disagreeing one refuses',()=>{
  assert.deepEqual(withMergedPrIssueBinding(fixture({linked:[{number:2506,state:'open'}]}).io,'2726:2506').closingIssuesForPr(2726),[{number:2506,state:'open'}])
  assert.throws(()=>withMergedPrIssueBinding(fixture({linked:[{number:77}]}).io,'2726:2506').closingIssuesForPr(2726),/already closes #77/)
})

test('every mismatch refuses the binding',()=>{
  const cases=[
    [{pr:{...fixture().state.pr,merged_at:null}},/not merged/],
    [{pr:{...fixture().state.pr,body:'no work line'}},/exactly one "Work issue #2506"; found none/],
    [{pr:{...fixture().state.pr,body:'Work issue #2506. Work issue #2507.'}},/found 2506,2507/],
    [{pr:{...fixture().state.pr,head:{sha:HEAD,ref:'codex/issue-2507-x'}}},/names issue #2507/],
    [{completion:'not json'},/completion.json .* unreadable/],
    [{completion:{work_issue:2507,pr:2726,migration_versions:['20260911213429']}},/completion record names issue #2507/],
    [{completion:{work_issue:2506,pr:2725,migration_versions:['20260911213429']}},/PR #2725/],
    [{completion:{work_issue:2506,pr:2726,migration_versions:['20260911213430']}},/do not equal completion record/],
    [{files:[{filename:'.agent/contract.json',status:'added'},{filename:'.agent/completion.json',status:'added'},{filename:'docs/x.md',status:'added'}],completion:{work_issue:2506,pr:2726,migration_versions:[]}},/PR migrations none/],
    [{refs:new Set()},/no permanent claim reservation/],
    [{pr:{...fixture().state.pr,changed_files:99}},/inventory is incomplete/],
    [{pr:{...fixture().state.pr,head:{sha:HEAD,ref:'codex/ISSUE-2507-x'}}},/names issue #2507/],
    [{pr:{...fixture().state.pr,body:'Work issue #2506.\nWork issue #2506.'}},/found 2506,2506/],
    [{issueState:'closed'},/is not open/],
    [{files:[{filename:'supabase/migrations/20260911213429_popsg_search.sql',previous_filename:'supabase/migrations/20260911213428_old.sql',status:'renamed'}]},/is renamed/],
    [{files:[{filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'removed'}]},/is removed/],
  ]
  for(const [override,pattern] of cases){
    const {io}=fixture(override)
    assert.throws(()=>verifyMergedPrIssueBinding({pr:2726,issue:2506},io),pattern)
    assert.throws(()=>withMergedPrIssueBinding(io,'2726:2506').closingIssuesForPr(2726),pattern)
  }
})

test('the resolver still refuses a merged PR with no link and no binding',()=>{
  assert.throws(()=>resolveAdmittedIssueForPr(2726,fixture().io),/must close exactly one structural work issue; found 0/)
})

test('reviewer assignment snapshot accepts the same verified binding and nothing looser',()=>{
  const snap=(linkedIssues)=>({pr:{state:'merged',merged_at:'2026-09-11T22:49:13Z',head:{sha:HEAD}},files:[],linkedIssues})
  const withRoute=(override={},linkedIssues=[])=>{const f=fixture(override);f.io.readReviewerOperationRoute=()=>snap(linkedIssues);return f}
  const lines=[]
  const bound=withMergedPrIssueBinding(withRoute().io,'2726:2506',(line)=>lines.push(line))
  assert.deepEqual(bound.readReviewerOperationRoute(2726).linkedIssues,[{number:2506,state:'open',bound:true}])
  assert.match(lines[0],/PR #2726 -> issue #2506/)
  assert.deepEqual(bound.readReviewerOperationRoute(9).linkedIssues,[],'other PRs keep their real snapshot')
  assert.deepEqual(withMergedPrIssueBinding(withRoute({},[{number:2506,state:'open'}]).io,'2726:2506').readReviewerOperationRoute(2726).linkedIssues,[{number:2506,state:'open'}])
  assert.throws(()=>withMergedPrIssueBinding(withRoute({},[{number:77}]).io,'2726:2506').readReviewerOperationRoute(2726),/already closes #77/)
  for(const [override,pattern] of [[{issueState:'closed'},/is not open/],[{refs:new Set()},/no permanent claim reservation/],[{pr:{...fixture().state.pr,merged_at:null}},/not merged/]])
    assert.throws(()=>withMergedPrIssueBinding(withRoute(override).io,'2726:2506').readReviewerOperationRoute(2726),pattern)
})


test('scoped merged evidence uses only the complete PR-owned pair at the exact head',()=>{
  const key='2506/2',path=`.agent/work/${key}`
  const f=fixture({completionPath:`${path}/completion.json`,completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429'],contract_ref:`refs/db-contracts/${key}`}})
  f.state.files=f.state.files.map(file=>({...file,filename:file.filename.replace('.agent/',`${path}/`)}))
  assert.equal(verifyMergedPrIssueBinding({pr:2726,issue:2506},f.io).issue,2506)
  f.state.completion.contract_ref='refs/db-contracts/2506/1'
  assert.throws(()=>verifyMergedPrIssueBinding({pr:2726,issue:2506},f.io),/contract_ref does not match/)
})

test('inherited, partial, ambiguous, foreign and removed evidence never bind',()=>{
  const pair=fixture().state.files.slice(0,2),migration=fixture().state.files.slice(2)
  const keyed=pair.map(f=>({...f,filename:f.filename.replace('.agent/','.agent/work/2506/1/')}))
  const cases=[
    [migration,/evidence is inherited/],
    [[pair[0],...migration],/evidence is partial/],
    [[...pair,...keyed,...migration],/evidence is conflicted/],
    [[...keyed.map(f=>({...f,filename:f.filename.replace('/2506/','/2507/')})),...migration],/path names issue #2507/],
    [[{...pair[0],status:'removed'},pair[1],...migration],/evidence file .* is removed/],
    [[{...pair[0],status:'renamed',previous_filename:'old.json'},pair[1],...migration],/evidence file .* is renamed/],
    [[...pair,...migration,{}],/inventory is unreadable/],
  ]
  for(const [files,pattern] of cases)assert.throws(()=>verifyMergedPrIssueBinding({pr:2726,issue:2506},fixture({files}).io),pattern)
})
