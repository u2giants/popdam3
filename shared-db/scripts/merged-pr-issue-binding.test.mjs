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
  const projected={state:'merged',merged:true,head:{sha:HEAD}}
  assert.equal(reviewTargetIsRecordable(projected,{pr:2726,issue:2506,headSha:HEAD},bound),true,'the production GraphQL projection is recordable through the same binding')
  assert.equal(reviewTargetIsRecordable(projected,{pr:2726,issue:2506,headSha:HEAD},io),false,'merged flag without binding is insufficient')
  assert.equal(reviewTargetIsRecordable({...projected,merged:false},{pr:2726,issue:2506,headSha:HEAD},bound),false)
  assert.equal(reviewTargetIsRecordable(merged,{pr:2726,issue:2507,headSha:HEAD},bound),false,'a different issue refuses')
  assert.equal(reviewTargetIsRecordable(merged,{pr:2727,issue:2506,headSha:HEAD},bound),false,'a different PR refuses')
  assert.equal(reviewTargetIsRecordable({...merged,head:{sha:'1'.repeat(40)}},{pr:2726,issue:2506,headSha:HEAD},bound),false,'a different head refuses')
  assert.equal(reviewTargetIsRecordable({state:'closed',head:{sha:HEAD}},{pr:2726,issue:2506,headSha:HEAD},bound),false,'closed unmerged refuses')
  const closedIssue=fixture({issueState:'closed'})
  assert.throws(()=>reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},withMergedPrIssueBinding(closedIssue.io,'2726:2506',()=>{})),/is not open/)
})

test('mergedPrReviewTarget trusts a real closing link without evidence-pair verification (#4125)',()=>{
  // A merged PR whose changed files carry NO evidence pair (state 'inherited')
  // but whose GitHub closing link matches: verdict recording must succeed
  // exactly as closingIssuesForPr already accepts that link.
  const merged={state:'closed',merged_at:'2026-10-09T02:44:07Z',head:{sha:HEAD}}
  const linked=fixture({files:[
    {filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'added'},
  ],linked:[{number:2506,state:'open'}],completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429']}})
  // No evidence pair in the changed-file list: verifyMergedPrIssueBinding would
  // refuse with "evidence is inherited" if it ran.  The real closing link must
  // prevent it from running at all.
  const bound=withMergedPrIssueBinding(linked.io,'2726:2506',()=>{})
  assert.equal(reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},bound),true)
  // A disagreeing real link still refuses.
  const disagree=fixture({files:[
    {filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'added'},
  ],linked:[{number:77,state:'open'}],completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429']}})
  assert.throws(()=>reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},withMergedPrIssueBinding(disagree.io,'2726:2506',()=>{})),/already closes #77/)
  // With NO real closing link the full verification still runs and still refuses
  // an inherited pair.
  const noLink=fixture({files:[
    {filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'added'},
  ],linked:[],completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429']}})
  assert.throws(()=>reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},withMergedPrIssueBinding(noLink.io,'2726:2506',()=>{})),/evidence is inherited/)
  // A link-reported closed state refuses even when the live issue is open.
  const closedLink=fixture({files:[
    {filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'added'},
  ],linked:[{number:2506,state:'closed'}],completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429']}})
  assert.equal(reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},withMergedPrIssueBinding(closedLink.io,'2726:2506',()=>{})),false)
  // A live closed issue refuses even when the link reports open.
  const liveClosed=fixture({files:[
    {filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'added'},
  ],linked:[{number:2506,state:'open'}],issueState:'closed',completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429']}})
  assert.equal(reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},withMergedPrIssueBinding(liveClosed.io,'2726:2506',()=>{})),false)
  // A stateless link still checks the live issue state.
  const stateless=fixture({files:[
    {filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'added'},
  ],linked:[{number:2506}],issueState:'closed',completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429']}})
  assert.equal(reviewTargetIsRecordable(merged,{pr:2726,issue:2506,headSha:HEAD},withMergedPrIssueBinding(stateless.io,'2726:2506',()=>{})),false)
})

const HEAD='f'.repeat(40)
function fixture(overrides={}){
  const state={
    pr:{number:2726,merged_at:'2026-09-11T22:49:13Z',merge_commit_sha:'e'.repeat(40),head:{sha:HEAD,ref:'codex/issue-2506-production-performance-2714'},body:'Repairs #2506.\n\nWork issue #2506; active claim #2722; orchestrator #2714.'},
    completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429']},
    contract:{schema_version:1,work_type:'structural',route:'shared-db-orchestrator',work_issue:2506,generation:1,goal:'bind the merged pull request',base_sha:'e'.repeat(40),dispatcher:'d',worker:'w',branch:'codex/x',worktree:'worktrees/x',allowed_paths:['supabase/**'],file_writes:['supabase/migrations/20260911213429_popsg_search.sql'],db_reads:[],db_writes:['supabase/migrations/20260911213429_popsg_search.sql'],prohibited_actions:['no production'],required_checks:['node --test'],assumptions:[],stop_conditions:['stop on scope change']},
    files:[{filename:'.agent/contract.json',status:'added'},{filename:'.agent/completion.json',status:'added'},{filename:'supabase/migrations/20260911213429_popsg_search.sql',status:'added'}],
    linked:[],
    refs:new Set(['refs/db-claims/20260911213429','refs/db-contracts/2506/2']),
    ...overrides,
  }
  const io={
    getPr:()=>state.pr?{changed_files:state.files.length,...state.pr}:state.pr,
    getIssue:(n)=>({number:n,state:state.issueState??'open'}),
    getFileAt:(file,ref)=>{
      assert.equal(ref,HEAD)
      if(file===(state.completionPath??'.agent/completion.json'))return typeof state.completion==='string'?state.completion:JSON.stringify(state.completion)
      if(file===(state.contractPath??'.agent/contract.json'))return typeof state.contract==='string'?state.contract:JSON.stringify(state.contract)
      throw new Error(`unexpected getFileAt ${file}`)
    },
    getCommit:()=>({message:`db-agent-contract issue=2506 generation=2 sha256=0000000000000000000000000000000000000000000000000000000000000000\n\n${JSON.stringify(state.contract)}`}),
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
  const f=fixture({completionPath:`${path}/completion.json`,contractPath:`${path}/contract.json`,completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429'],contract_ref:`refs/db-contracts/${key}`}})
  f.state.files=f.state.files.map(file=>({...file,filename:file.filename.replace('.agent/',`${path}/`)}))
  assert.equal(verifyMergedPrIssueBinding({pr:2726,issue:2506},f.io).issue,2506)
  f.state.completion.contract_ref='refs/db-contracts/2506/1'
  assert.throws(()=>verifyMergedPrIssueBinding({pr:2726,issue:2506},f.io),/contract_ref does not match/)
})

// #3380: the binding reads real evidence. A malformed lineage record, an
// unpublished keyed contract ref, or a contract that differs from the immutable
// published record all refuse instead of binding.
test('a contract with invalid lineage, an unpublished ref, or a mutated published record refuses the binding (#3380)',()=>{
  const bad=fixture({contract:{schema_version:99,work_issue:2506}})
  assert.throws(()=>verifyMergedPrIssueBinding({pr:2726,issue:2506},bad.io),/contract lineage .* is invalid/)
  const unreadable=fixture({contract:'not json'})
  assert.throws(()=>verifyMergedPrIssueBinding({pr:2726,issue:2506},unreadable.io),/contract.* unreadable/)
  const key='2506/2',path=`.agent/work/${key}`
  const keyed=()=>{
    const f=fixture({completionPath:`${path}/completion.json`,contractPath:`${path}/contract.json`,completion:{work_issue:2506,pr:2726,migration_versions:['20260911213429'],contract_ref:`refs/db-contracts/${key}`}})
    f.state.files=f.state.files.map(file=>({...file,filename:file.filename.replace('.agent/',`${path}/`)}))
    return f
  }
  const unpublished=keyed()
  unpublished.state.refs.delete(`refs/db-contracts/${key}`)
  assert.throws(()=>verifyMergedPrIssueBinding({pr:2726,issue:2506},unpublished.io),/contract ref .* is not published/)
  const mutated=keyed()
  mutated.io.getCommit=()=>({message:`db-agent-contract issue=2506 generation=2 sha256=1111111111111111111111111111111111111111111111111111111111111111\n\n${JSON.stringify({...mutated.state.contract,goal:'changed after publication'})}`})
  assert.throws(()=>verifyMergedPrIssueBinding({pr:2726,issue:2506},mutated.io),/is immutable/)
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
