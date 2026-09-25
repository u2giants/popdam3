import assert from 'node:assert/strict'
import { currentRepository, expectedOperatorAssociation } from './lib/repository-identity.mjs'
// Fixtures follow the resolved repository identity and its operator association (#3255).
const THIS_REPO = currentRepository(), OPERATOR_ASSOCIATION = expectedOperatorAssociation()
import test from 'node:test'
import { parseArgs, runGovernedReview as executeGovernedReview,resolveReviewSource, reserveReviewReceipt, validateSourceReceipt, wrapperFailureReason, wrapperSourceContractArgs, wrapperVerdictContractArgs, wrapperBaseName, codexReportPath, codexGovernedBody, verdictFromOutput, neutraliseVerdictLine, extraVerdictLines, PRESERVED_HEADER } from './run-governed-review.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { anyVerdictFor } from './lib/review-verdict.mjs'

const options={issue:1824,pr:2000,headSha:'a'.repeat(40),reviewer:'glm-5.3',wrapper:'ai-glm',worktree:'C:/review',slot:1,wrapperArgs:['review']}
const fixtureFiles=[{filename:'source.txt',status:'modified'}]
const fixtureSource=(input)=>({repository:THIS_REPO,pr:input.pr,baseRef:'develop',targetSha:'b'.repeat(40),headSha:input.headSha,mergeBase:'c'.repeat(40),files:fixtureFiles,fileSetSha256:createHash('sha256').update(JSON.stringify(fixtureFiles)).digest('hex'),sourceDigest:'d'.repeat(64)})
const fixtureReceipt=(input)=>({schema_version:1,identity:{repository:input.worktree,base:'c'.repeat(40),head:input.headSha,source_digest:'d'.repeat(64)},packet_sha256:'e'.repeat(64)})
const fixturePaths={platform:'win32',realpath:(path)=>path,lstat:()=>({isSymbolicLink:()=>false,isDirectory:()=>true})}
function runGovernedReview(input,deps){return executeGovernedReview(input,{recordStart:()=>'refs/db-review-started/fixture',sourceResolver:fixtureSource,briefPreparer:(input)=>({wrapperArgs:input.wrapperArgs,env:{}}),sourcePathOptions:fixturePaths,receiptFactory:()=>({path:'C:/review/.ai/reviews/source.json',read:()=>fixtureReceipt(input),bind:()=> 'C:/review/.ai/reviews/source.json.binding.json'}),...deps})}

test('all qualified wrappers receive immutable source arguments without rewriting prompt values',()=>{
  const source=fixtureSource(options)
  for(const name of ['ai-claude-review','ai-codex-review','ai-gemini','ai-glm','ai-grok-review','ai-kimi','ai-muse','ai-qwen']){
    for(const wrapper of [name,`C:\\tools\\${name.toUpperCase()}.CMD`,`/usr/bin/${name}.exe`]){
      assert.deepEqual(wrapperSourceContractArgs(wrapper,['new','session','--prompt','--base'],source),['new','session','--prompt','--base','--base',source.mergeBase,'--assert-head',source.headSha])
      assert.deepEqual(wrapperSourceContractArgs(wrapper,['new',`--base=${source.mergeBase}`,'--assert-head',source.headSha],source),['new','--base',source.mergeBase,'--assert-head',source.headSha])
    }
  }
  for(const args of [['--base','f'.repeat(40)],['--assert-head='+ 'f'.repeat(40)],['--base',source.mergeBase,'--base='+source.mergeBase]])assert.throws(()=>wrapperSourceContractArgs('ai-glm',args,source),/does not match|duplicate/)
  assert.throws(()=>wrapperSourceContractArgs('unknown-reviewer',[],source),/no qualified source/)
  for(const wrapper of ['ai-deepseek-agent','C:\\tools\\AI-DEEPSEEK-AGENT.CMD']){
    assert.deepEqual(wrapperSourceContractArgs(wrapper,['send','review this','--review'],source),['send','review this','--review','--base',source.mergeBase,'--assert-head',source.headSha])
    assert.throws(()=>wrapperSourceContractArgs(wrapper,['send','advisory'],source),/requires a formal/)
    assert.throws(()=>wrapperSourceContractArgs(wrapper,['send','advisory','--file','--review'],source),/requires a formal/)
  }
})

function sourceIo(overrides={}){
  const pr={number:options.pr,state:'open',merged:false,base:{ref:'develop',sha:'b'.repeat(40),repo:{full_name:THIS_REPO}},head:{sha:options.headSha},...overrides.pr}
  const seen=[]
  return {seen,digest:()=>overrides.digest??'d'.repeat(64),github:(args)=>({status:0,stdout:JSON.stringify(args[1].includes('/compare/')?{base_commit:{sha:'c'.repeat(40)},merge_base_commit:{sha:'c'.repeat(40)},files:fixtureFiles,...overrides.comparison}:pr)}),git:(_command,args)=>{
    const op=args[2];seen.push(args.slice(2))
    if(overrides.fail===op)return{status:1,stdout:''}
    const stdout={remote:`https://github.com/${THIS_REPO}.git`,'rev-parse':options.headSha,status:'','cat-file':'','merge-base':'c'.repeat(40),diff:'M\0source.txt\0',...overrides.stdout}[op]
    return{status:0,stdout}
  }}
}
test('source resolver binds live non-main PR target to local merge-base',()=>{
  assert.deepEqual(resolveReviewSource(options,sourceIo()),fixtureSource(options))
})
test('source resolver preserves Git SSH transports and refuses other users or hosts',()=>{
  const host='github.com',user='git'
  for(const remote of [`${user}@${host}:${THIS_REPO}.git`,`ssh://${user}@${host}/${THIS_REPO}.git`])assert.deepEqual(resolveReviewSource(options,sourceIo({stdout:{remote}})),fixtureSource(options))
  for(const remote of [`other@${host}:u2giants/shared-db.git`,`ssh://other@${host}/u2giants/shared-db.git`,`${user}@elsewhere:u2giants/shared-db.git`])assert.throws(()=>resolveReviewSource(options,sourceIo({stdout:{remote}})),/repository/)
})
test('source resolver binds exact renamed and deleted files including unquoted paths',()=>{
  const files=[{filename:'gone.txt',status:'removed'},{filename:'new\tname.txt',status:'renamed',previous_filename:'old name.txt'}]
  const source=resolveReviewSource(options,sourceIo({comparison:{files:files.toReversed()},stdout:{diff:'R100\0old name.txt\0new\tname.txt\0D\0gone.txt\0'}}))
  assert.deepEqual(source.files,files)
  assert.equal(source.fileSetSha256,createHash('sha256').update(JSON.stringify(files)).digest('hex'))
})
test('missing truncated or mismatched file evidence refuses before any provider call',()=>{
  for(const overrides of [
    {comparison:{files:null}},{comparison:{files:Array(300).fill(fixtureFiles[0])}},
    {comparison:{base_commit:{sha:'f'.repeat(40)}}},{comparison:{merge_base_commit:{sha:'f'.repeat(40)}}},
    {comparison:{files:[]}},{comparison:{files:[{filename:'wrong.txt',status:'modified'}]}},
    {comparison:{files:[{filename:'source.txt',status:'renamed'}]}},{comparison:{files:[fixtureFiles[0],fixtureFiles[0]]}},
    {stdout:{diff:'M\0source.txt'}},{stdout:{diff:'R100\0source.txt\0'}},{fail:'diff'},{digest:'bad'},
  ]){
    let providerCalls=0
    assert.throws(()=>executeGovernedReview(options,{sourceResolver:(input)=>resolveReviewSource(input,sourceIo(overrides)),preflight:()=>assert.fail('must refuse before preflight'),spawn:()=>{providerCalls++;assert.fail('must not contact provider')}}),/file|comparison|manifest|identity|digest/)
    assert.equal(providerCalls,0)
  }
})
test('source resolver refuses stale or wrong repository evidence before provider work',()=>{
  for(const overrides of [
    {pr:{state:'closed'}},{pr:{head:{sha:'f'.repeat(40)}}},
    {pr:{base:{ref:'develop',sha:'b'.repeat(40),repo:{full_name:'other/repo'}}}},
    {stdout:{remote:'https://github.com/other/repo.git'}},{stdout:{'rev-parse':'f'.repeat(40)}},
    {stdout:{status:' M file'}},{fail:'cat-file'},{stdout:{'merge-base':''}},
  ])assert.throws(()=>resolveReviewSource(options,sourceIo(overrides)),/source|head|repository|dirty|merge-base/)
})
test('source movement after provider completion prevents every publication and recording',()=>{
  let reads=0,calls=0
  assert.throws(()=>runGovernedReview(options,{sourceResolver:(input)=>({...fixtureSource(input),targetSha:(++reads===1?'b':'f').repeat(40)}),preflight:()=>{},resolve:(name)=>name,spawn:()=>{calls++;return{status:0,stdout:`VERDICT: APPROVE ${options.headSha}`}},record:()=>assert.fail('must not record')}),/source changed/)
  assert.equal(calls,1)
})
test('receipt mismatches refuse without publishing a verdict',()=>{
  for(const patch of [{packet_sha256:'bad'},{identity:{...fixtureReceipt(options).identity,base:'f'.repeat(40)}},{identity:{...fixtureReceipt(options).identity,head:'f'.repeat(40)}},{identity:{...fixtureReceipt(options).identity,repository:'C:/other'}},{identity:{...fixtureReceipt(options).identity,source_digest:'f'.repeat(64)}}]){
    let calls=0
    assert.throws(()=>runGovernedReview(options,{receiptFactory:()=>({path:'receipt',read:()=>({...fixtureReceipt(options),...patch}),bind:()=>assert.fail('must not bind')}),preflight:()=>{},resolve:(name)=>name,spawn:()=>{calls++;return{status:0,stdout:`VERDICT: APPROVE ${options.headSha}`}},record:()=>assert.fail('must not record')}),/receipt/)
    assert.equal(calls,1)
  }
})
test('receipt binds Windows drive-letter aliases to the exact worktree',()=>{
  const receipt=fixtureReceipt(options);receipt.identity.repository='/c/review'
  assert.equal(validateSourceReceipt(receipt,fixtureSource(options),'C:\\review',fixturePaths).packetSha256,'e'.repeat(64))
})
test('receipt repository equality preserves case-sensitive non-Windows paths',()=>{
  const receipt=fixtureReceipt({...options,worktree:'/source/Review'})
  const paths={...fixturePaths,platform:'linux'}
  assert.throws(()=>validateSourceReceipt(receipt,fixtureSource(options),'/source/review',paths),/differs/)
  assert.throws(()=>validateSourceReceipt(receipt,fixtureSource(options),'/source\\Review',paths),/differs/)
  assert.equal(validateSourceReceipt(receipt,fixtureSource(options),'/source/Review',paths).packetSha256,'e'.repeat(64))
})
test('receipt repository identity rejects distinct physical roots and linked roots',()=>{
  const root=mkdtempSync(join(tmpdir(),'governed-source-identity-'))
  try{
    const approved=join(root,'approved'),other=join(root,'other'),linked=join(root,'linked')
    mkdirSync(approved);mkdirSync(other)
    const receipt=fixtureReceipt({...options,worktree:approved})
    assert.equal(validateSourceReceipt(receipt,fixtureSource(options),approved).packetSha256,'e'.repeat(64))
    assert.throws(()=>validateSourceReceipt(receipt,fixtureSource(options),other),/differs/)
    assert.throws(()=>validateSourceReceipt(receipt,fixtureSource(options),join(root,'missing')),/unavailable or unsafe/)
    symlinkSync(approved,linked,process.platform==='win32'?'junction':'dir')
    assert.throws(()=>validateSourceReceipt(receipt,fixtureSource(options),linked),/unavailable or unsafe/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('receipt accepts the real Windows short and long spelling of one worktree',{skip:process.platform!=='win32'},(t)=>{
  const root=mkdtempSync(join(tmpdir(),'governed-source-long-alias-'))
  try{
    const short=execFileSync(process.env.ComSpec||'cmd.exe',['/d','/c','for %I in ("%AI_SOURCE_ALIAS_FIXTURE%") do @echo %~sI'],{windowsVerbatimArguments:true,encoding:'utf8',env:{...process.env,AI_SOURCE_ALIAS_FIXTURE:root}}).trim()
    if(short.toLowerCase()===root.toLowerCase()){t.skip('this filesystem has no distinct 8.3 alias');return}
    const receipt=fixtureReceipt({...options,worktree:root})
    assert.equal(validateSourceReceipt(receipt,fixtureSource(options),short).packetSha256,'e'.repeat(64))
    assert.equal(validateSourceReceipt(fixtureReceipt({...options,worktree:short}),fixtureSource(options),root).packetSha256,'e'.repeat(64))
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('receipt storage retains a private create-only PR and packet binding',()=>{
  const root=mkdtempSync(join(tmpdir(),'governed-source-'))
  try{
    const git=(_command,args)=>({status:args[2]==='check-ignore'?0:1,stdout:''})
    const store=reserveReviewReceipt({...options,worktree:root},{git})
    writeFileSync(store.path,JSON.stringify(fixtureReceipt({...options,worktree:root})))
    assert.equal(store.read().packet_sha256,'e'.repeat(64))
    const binding=store.bind(fixtureSource(options))
    assert.equal(JSON.parse(readFileSync(binding,'utf8')).baseRef,'develop')
    assert.throws(()=>store.bind(fixtureSource(options)),/EEXIST/)
    assert.throws(()=>reserveReviewReceipt({...options,worktree:root},{git:()=>({status:1})}),/not private/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('receipt storage refuses a linked private evidence directory',()=>{
  const root=mkdtempSync(join(tmpdir(),'governed-source-link-'))
  try{
    const outside=join(root,'outside');mkdirSync(outside)
    symlinkSync(outside,join(root,'.ai'),process.platform==='win32'?'junction':'dir')
    assert.throws(()=>reserveReviewReceipt({...options,worktree:root}),/linked or unsafe/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('receipt storage rejects missing truncated or oversized receipts',()=>{
  const root=mkdtempSync(join(tmpdir(),'governed-source-invalid-'))
  try{
    const git=(_command,args)=>({status:args[2]==='check-ignore'?0:1,stdout:''})
    const store=reserveReviewReceipt({...options,worktree:root},{git})
    assert.throws(()=>store.read(),/ENOENT/)
    writeFileSync(store.path,'{"schema_version":')
    assert.throws(()=>store.read(),SyntaxError)
    writeFileSync(store.path,' '.repeat(128*1024+1))
    assert.throws(()=>store.read(),/bounded regular file/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('successful governed review retains the trusted PR target and packet receipt',()=>{
  let environment,bound,recorded
  const result=runGovernedReview(options,{preflight:()=>{},resolve:(name)=>name,
    receiptFactory:()=>({path:'C:/review/.ai/reviews/source.json',read:()=>fixtureReceipt(options),bind:(value)=>{bound={...value};return 'binding.json'}}),
    spawn:(command,_args,spawnOptions)=>{
      if(command!=='gh'){environment=spawnOptions.env;return{status:0,stdout:`VERDICT: APPROVE ${options.headSha}`}}
      return{status:0,stdout:JSON.stringify({id:123,html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-123'})}
    },record:(value)=>{recorded=value;return{ref:'ref',sha:'f'.repeat(40)}}})
  assert.equal(environment.AI_REVIEW_SOURCE_RECEIPT_FILE,'C:/review/.ai/reviews/source.json')
  assert.equal(bound.targetSha,'b'.repeat(40));assert.equal(bound.baseRef,'develop')
  assert.equal(result.sourceEvidence.packetSha256,'e'.repeat(64))
  assert.deepEqual(recorded.sourceEvidence,result.sourceEvidence)
})

test('wrapper failure preserves a safe cause without publishing a verdict or raw diagnostics',()=>{
  for(const [stderr,expected] of [
    ["unknown option '--review-kind'; token=private-value",/unsupported option/],
    ['ai-grok-review: Grok cancelled without a final answer. private-value',/provider cancelled/],
    ['reason: provider_cancelled private-value',/provider_cancelled:.*cancelled/],
    ['reason: turn_limit_cancelled private-value',/turn_limit_cancelled:.*turn budget/],
    ['ai-muse: error: start_failed: caller_identity_missing private-value',/start_failed:.*caller identity/],
    ['ai-muse: error: start_failed: invalid_caller_identity private-value',/start_failed:.*caller identity/],
    ['ai-muse: error: start_failed: private-value',/start_failed:.*before the provider turn started/],
    ['reason: unknown_terminal_reason private-value',/unknown_terminal_reason:.*unrecognized/],
    ['terminal reason: content-filter private-value',/provider_unavailable: content-filter/],
    ['[API Error: 400 InternalError.Algo.DataInspectionFailed: private-value]',/provider_unavailable: content-filter/],
    ['provider-unavailable: private-value',/provider_unavailable/],
    ['timed-out private-value',/reported a timeout/],
    ['private-value',/reason was not recognized/],
  ]){
    let calls=0
    assert.throws(()=>runGovernedReview(options,{preflight:()=>{},resolve:(x)=>x,spawn:()=>{calls++;return{status:1,stderr,stdout:`VERDICT: APPROVE ${options.headSha}`}},record:()=>assert.fail('must not record')}),(error)=>{
      assert.match(error.message,expected)
      assert.ok(!error.message.includes('private-value'))
      return true
    })
    assert.equal(calls,1,'failed wrappers never publish to GitHub')
  }
})

test('typed terminal reasons require complete tokens rather than diagnostic substrings',()=>{
  for(const reason of ['provider_cancelled','turn_limit_cancelled','unknown_terminal_reason','start_failed','content-filter','DataInspectionFailed','provider-unavailable']){
    for(const stderr of [`prefix${reason}`,`${reason}_suffix`,`not-${reason}`,`${reason}-suffix`]){
      assert.equal(wrapperFailureReason({stderr}),'wrapper stderr was present but its reason was not recognized; inspect the exact wrapper session')
    }
  }
  assert.equal(wrapperFailureReason({stderr:'start_failed: not-caller_identity_missing'}),'start_failed: the wrapper refused before the provider turn started')
})

test('a precise turn-budget refusal takes precedence over generic cancellation prose',()=>{
  const reason=wrapperFailureReason({stderr:'turn_limit_cancelled: Grok cancelled without a final answer. provider_cancelled'})
  assert.equal(reason,'turn_limit_cancelled: the provider exhausted its declared turn budget')
})

test('DeepSeek receives the exact governed terminal head without changing advisory mode',()=>{
  const head=options.headSha,other='f'.repeat(40)
  assert.deepEqual(wrapperVerdictContractArgs('ai-deepseek-agent',['send','review this','--review'],head),['send','--governed-verdict',head,'review this','--review'])
  assert.deepEqual(wrapperVerdictContractArgs('C:\\tools\\ai-deepseek-agent.cmd',['reply','session','followup','--review'],head),['reply','session','--governed-verdict',head,'followup','--review'])
  assert.deepEqual(wrapperVerdictContractArgs('ai-deepseek-agent',['send',`--governed-verdict=${head}`,'review this','--review'],head),['send',`--governed-verdict=${head}`,'review this','--review'])
  assert.throws(()=>wrapperVerdictContractArgs('ai-deepseek-agent',['send','--governed-verdict',other,'review this','--review'],head),/does not match/)
  assert.throws(()=>wrapperVerdictContractArgs('ai-deepseek-agent',['reply','session',`--governed-verdict=${other}`,'followup','--review'],head),/does not match/)
  assert.throws(()=>wrapperVerdictContractArgs('ai-deepseek-agent',['send','--governed-verdict',head,'review this','--governed-verdict',other],head),/does not match/)
  assert.throws(()=>wrapperVerdictContractArgs('ai-deepseek-agent',['doctor'],head),/send or reply subcommand/)
  assert.deepEqual(wrapperVerdictContractArgs('ai-deepseek-agent-other',['send','x'],head),['send','x'])
})

test('adapter with real process payload shapes posts findings and records before returning output',()=>{
  const order=[],spawn=(command)=>{order.push(command);return command==='gh'?{status:0,stdout:JSON.stringify({html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-123'})}:{status:0,stdout:`Coverage: scripts.\nVERDICT: APPROVE ${options.headSha}`}}
  const result=runGovernedReview(options,{spawn,resolve:(name)=>name,preflight:()=>order.push('preflight'),record:(row)=>{order.push('record');assert.equal(row.verdict,'APPROVE');return{ref:'refs/db-review-verdicts/x',sha:'b'.repeat(40)}}})
  assert.deepEqual(order,['preflight','ai-glm','gh','record'])
  assert.match(result.body,/Coverage/)
  assert.match(result.body,/NON-AUTHORIZING UNLESS/)
})

test('adapter forwards a freshly justified doctor skip to reviewer preflight',()=>{
  let preflightOptions
  const spawn=(command)=>command==='gh'
    ?{status:0,stdout:JSON.stringify({html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-124'})}
    :{status:0,stdout:`Coverage: scripts.\nVERDICT: APPROVE ${options.headSha}`}
  runGovernedReview({...options,skipDoctor:'true'},{spawn,resolve:(name)=>name,preflight:(row)=>{preflightOptions=row},record:()=>({ref:'refs/db-review-verdicts/x',sha:'b'.repeat(40)})})
  assert.equal(preflightOptions.skipDoctor,true)
  runGovernedReview({...options,skipDoctor:'false'},{spawn,resolve:(name)=>name,preflight:(row)=>{preflightOptions=row},record:()=>({ref:'refs/db-review-verdicts/y',sha:'c'.repeat(40)})})
  assert.equal(preflightOptions.skipDoctor,false)
})

test('recording failure leaves an explicit durable non-authorizing notice',()=>{
  const posts=[]
  const spawn=(command,args,spawnOptions)=>{if(command!=='gh')return{status:0,stdout:`VERDICT: APPROVE ${options.headSha}`};if(args[2]==='POST')posts.push(JSON.parse(spawnOptions.input).body);return{status:0,stdout:JSON.stringify({id:123,html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-123'})}}
  assert.throws(()=>runGovernedReview(options,{spawn,resolve:(name)=>name,preflight:()=>{},record:()=>{throw new Error('lease changed')}}),/lease changed/)
  assert.match(posts[0],/NON-AUTHORIZING UNLESS/)
  assert.match(posts[1],/REVIEW RECORDING FAILED/)
})

const findingsText='Coverage: scripts. The lease ref is stale and must be reissued.'
const wrapperOut=`${findingsText}\nVERDICT: APPROVE ${options.headSha}`
const commentJson=JSON.stringify({id:987654,html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-987654'})

function recordingFailureRun({patchFails=false}={}){
  const calls=[]
  const spawn=(command,args,spawnOptions)=>{
    if(command!=='gh')return{status:0,stdout:wrapperOut}
    const verb=args[2]
    calls.push({verb,url:args[3],body:JSON.parse(spawnOptions.input).body})
    if(verb==='PATCH')return patchFails?{status:1,stdout:'',stderr:'gh: 403'}:{status:0,stdout:commentJson}
    return{status:0,stdout:commentJson}
  }
  let thrown
  try{runGovernedReview(options,{spawn,resolve:(name)=>name,preflight:()=>{},record:()=>{throw new Error('lease changed')}})}
  catch(error){thrown=error}
  return{calls,thrown}
}

test('issue 2075: recording failure voids the posted findings comment so the orphan line is no longer a verdict',()=>{
  const{calls,thrown}=recordingFailureRun()
  assert.match(thrown.message,/lease changed/)
  const patch=calls.find((call)=>call.verb==='PATCH')
  assert.ok(patch,'the findings comment must be edited on the recording-failure path')
  assert.equal(patch.url,`repos/${THIS_REPO}/issues/comments/987654`)
  assert.equal(verdictFromOutput(patch.body,options.headSha),null)
  // ENVELOPE FIDELITY (grok r2080c Medium): a GitHub ISSUE comment carries no
  // `commit_id`. The body itself still quotes the head inside the voided line,
  // so this is the real shape a lane parser would see, not a softened one.
  assert.equal(anyVerdictFor([{author_association:'OWNER',body:patch.body}],options.headSha),false)
  assert.ok(patch.body.includes(options.headSha),'the head SHA must still be in the body, so this is a tied-to-head negative')
})

test("issue 2075: voiding the verdict line preserves the reviewer's findings",()=>{
  const{calls}=recordingFailureRun()
  const patch=calls.find((call)=>call.verb==='PATCH')
  assert.ok(patch.body.includes(findingsText),'reviewer analysis must survive the neutralising edit')
  assert.match(patch.body,/VERDICT LINE VOIDED/)
  assert.match(patch.body,/lease changed/)
})

test('issue 2075: a failed voiding edit is announced loudly and the command still refuses',()=>{
  const{calls,thrown}=recordingFailureRun({patchFails:true})
  const follow=calls.filter((call)=>call.verb==='POST').at(-1).body
  assert.match(follow,/REVIEW RECORDING FAILED/)
  assert.match(follow,/STILL LIVE ON COMMENT 987654/)
  assert.match(follow,/BY HAND/)
  assert.match(thrown.message,/still live on comment 987654/)
})

test('issue 2075: the success path posts and records with no edit call',()=>{
  const calls=[]
  const spawn=(command,args)=>{if(command!=='gh')return{status:0,stdout:wrapperOut};calls.push(args[2]);return{status:0,stdout:commentJson}}
  const result=runGovernedReview(options,{spawn,resolve:(name)=>name,preflight:()=>{},record:()=>({ref:'refs/db-review-verdicts/x',sha:'b'.repeat(40)})})
  assert.deepEqual(calls,['POST'])
  assert.match(result.body,/VERDICT: APPROVE/)
})

// REWRITTEN, NOT DELETED (issue #2075, grok r2080c High 2). The previous version
// of this test asserted `out.startsWith('VERDICT: REJECT mentioned in prose')`:
// it REQUIRED that a non-terminal line which `anyVerdictFor` reads as a decision
// be left untouched by the void. That is the defect itself, written down as a
// test -- and it was added by this pull request's own first commit, so it never
// encoded settled behaviour. Voiding one line while another parseable one
// survives is not neutralisation, so the assertion is inverted rather than
// dropped, and the lane parser is asserted alongside the runner parser.
test('issue 2075: neutraliseVerdictLine voids EVERY line a verdict parser would read',()=>{
  assert.equal(neutraliseVerdictLine('Findings only, no terminal verdict.','x'),null)
  const out=neutraliseVerdictLine(`VERDICT: REJECT mentioned in prose\nVERDICT: REVISE ${options.headSha}`,'why')
  assert.ok(!out.startsWith('VERDICT: REJECT mentioned in prose'))
  assert.ok(out.includes('> VOIDED REVIEWER LINE - VERDICT: REJECT mentioned in prose'))
  assert.equal(verdictFromOutput(out,options.headSha),null)
  assert.equal(anyVerdictFor([{author_association:'OWNER',body:out}],options.headSha),false)
})

// ADVERSARIAL FINDINGS BODIES (grok r2080c Medium). Each of these is a shape the
// runner's own strict `verdictFromOutput` ignores but `anyVerdictFor` -- the
// predicate the lanes and the merge gate use -- reads as a decision. Both halves
// must refuse: no verdict is recorded, and nothing readable as one is published.
//
// The runner no longer discards such a review (issue #2207). It refuses to record a
// verdict, exactly as before, but the findings are preserved as a voided,
// non-authorizing comment instead of being thrown away with the reviewer slot
// already spent. Be honest about what that costs. The old assertion `nothing
// reaches GitHub` was an unconditional guarantee; these assertions are stronger in
// what they TEST -- the exact bytes posted are checked against both predicates and
// against the scan that rejected the body -- and weaker in what they GUARANTEE,
// because a published comment can only be inert as far as those predicates are
// correct. The proofs import the live predicates so they cannot drift apart
// silently, and authorization comes from a create-only durable ref, not a comment.
const adversarial=[
  ['blockquoted verdict line',`> VERDICT: APPROVE ${options.headSha}`],
  ['heading verdict line',`## VERDICT: APPROVE ${options.headSha}`],
  ['bold verdict word',`**APPROVE** ${options.headSha}`],
  ['bare verdict word with the SHA elsewhere',`Reviewed at ${options.headSha}.\nAPPROVE`],
]

for(const [name,extra] of adversarial){
  test(`issue 2075/2207: an adversarial ${name} records no verdict, and what is posted is inert`,()=>{
    const wire=[]
    const body=`Findings: lease handling is correct.\n${extra}\n\nVERDICT: REVISE ${options.headSha}`
    assert.throws(()=>runGovernedReview(options,{
      spawn:(command,args,spawnOptions)=>{if(command!=='gh')return{status:0,stdout:body};wire.push(JSON.parse(spawnOptions.input).body);return{status:0,stdout:commentJson}},
      resolve:(nameArg)=>nameArg,preflight:()=>{},record:()=>assert.fail('must not record'),
    }),/a downstream verdict parser would read as a decision/)
    assert.equal(wire.length,1,'the findings are preserved in exactly one comment')
    assert.ok(wire[0].includes('NON-AUTHORIZING'),'the preserved comment says on its face that it authorizes nothing')
    assert.ok(wire[0].includes('lease handling is correct'),'the reviewer findings survive')
    assert.equal(verdictFromOutput(wire[0],options.headSha),null,'the runner cannot read a verdict in what was posted')
    assert.equal(anyVerdictFor([{author_association:'OWNER',body:wire[0]}],options.headSha),false,'nor can the consumer predicate the lanes use')
    assert.deepEqual(extraVerdictLines(wire[0]),[],'and no line the original scan rejected survives')
  })

  test(`issue 2075: the void makes an adversarial ${name} unreadable as a verdict`,()=>{
    const out=neutraliseVerdictLine(`Findings: lease handling is correct.\n${extra}\n\nVERDICT: APPROVE ${options.headSha}`,'lease changed')
    assert.equal(verdictFromOutput(out,options.headSha),null)
    assert.equal(anyVerdictFor([{author_association:'OWNER',body:out}],options.headSha),false)
    assert.ok(out.includes(options.headSha),'the head SHA stays in the body, so this is a tied-to-head negative')
  })
}

test('issue 2075: a reason carrying a newline cannot reconstruct a verdict line',()=>{
  const out=neutraliseVerdictLine(`Findings.\nVERDICT: REVISE ${options.headSha}`,`lease changed\nAPPROVE ${options.headSha}`)
  assert.equal(anyVerdictFor([{author_association:'OWNER',body:out}],options.headSha),false)
  assert.match(out,/lease changed APPROVE/,'the reason must survive as readable text, flattened onto one line')
})

test('honest review output without a verdict artifact path is refused',()=>{
  assert.throws(()=>runGovernedReview(options,{spawn:()=>({status:0,stdout:'I reviewed every file and found no issues.'}),resolve:(name)=>name,preflight:()=>{},record:()=>assert.fail('must not record')}),/did not produce/)
})
test('wrapper refusal forms remain terminal verdicts, not transport failures',()=>{
  assert.equal(verdictFromOutput(`VERDICT: REVISE ${options.headSha}`,options.headSha),'REVISE')
  assert.equal(verdictFromOutput(`VERDICT: REJECT ${options.headSha}`,options.headSha),'REJECT')
  assert.equal(verdictFromOutput(`VERDICT: APPROVE ${options.headSha}\nVERDICT: REJECT ${options.headSha}`,options.headSha),null)
  assert.equal(verdictFromOutput(`VERDICT: APPROVE ${'b'.repeat(40)}`,options.headSha),null)
})

// Issue #2207: preservation must FAIL CLOSED. Whatever is posted is inert, and a
// preservation post that fails is never reported as preserved.
test('issue 2207: whatever is posted for an unprovable body is still inert',()=>{
  const wire=[]
  const body=`APPROVE ${options.headSha}\n\nVERDICT: REVISE ${options.headSha}`
  assert.throws(()=>runGovernedReview(options,{
    spawn:(command,args,spawnOptions)=>{if(command!=='gh')return{status:0,stdout:body};wire.push(JSON.parse(spawnOptions.input).body);return{status:0,stdout:commentJson}},
    resolve:(nameArg)=>nameArg,preflight:()=>{},record:()=>assert.fail('must not record'),
  }),/a downstream verdict parser would read as a decision/)
  for(const posted of wire){
    assert.equal(verdictFromOutput(posted,options.headSha),null)
    assert.equal(anyVerdictFor([{author_association:'OWNER',body:posted}],options.headSha),false)
  }
})

test('issue 2207: a failed preservation post still refuses, and records nothing',()=>{
  const body=`Findings.\nREVISE\n\nVERDICT: REVISE ${options.headSha}`
  assert.throws(()=>runGovernedReview(options,{
    spawn:(command)=>command==='gh'?{status:1,stdout:''}:{status:0,stdout:body},
    resolve:(nameArg)=>nameArg,preflight:()=>{},record:()=>assert.fail('must not record'),
  }),/could not be preserved durably/)
})

// The header is glued in front of the voided findings, so it is part of the bytes a
// verdict parser reads. This test fails if the header is ever edited into something a
// reader would take as a decision, or if the verdict word set widens to match it.
test('issue 2207: the preserved-findings header is inert on its own',()=>{
  const sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  assert.deepEqual(extraVerdictLines(PRESERVED_HEADER),[],'the header carries no line a verdict parser would read as a decision')
  assert.equal(verdictFromOutput(PRESERVED_HEADER,sha),null,'the header is not read as a verdict by the runner')
  assert.equal(anyVerdictFor([{author_association:'OWNER',body:PRESERVED_HEADER}],sha),false,'the header is not read as a verdict by the shared consumer predicate')
})

test('Gemini and Qwen governed reviews are given the head under review as their verdict contract',()=>{
  const head='c'.repeat(40)
  assert.deepEqual(wrapperVerdictContractArgs('ai-gemini',['new','sess','--prompt','x'],head),['new','--governed-verdict',head,'sess','--prompt','x'])
  assert.deepEqual(wrapperVerdictContractArgs('C:/tools/ai-gemini.cmd',['ask','sess'],head),['ask','--governed-verdict',head,'sess'])
  assert.deepEqual(wrapperVerdictContractArgs('ai-qwen',['new','sess','--prompt','x'],head),['new','--governed-verdict',head,'sess','--prompt','x'])
  assert.deepEqual(wrapperVerdictContractArgs('C:/tools/ai-qwen.cmd',['ask','sess'],head),['ask','--governed-verdict',head,'sess'])
})

test('other wrappers keep their arguments untouched',()=>{
  assert.deepEqual(wrapperVerdictContractArgs('ai-glm',['review'],'d'.repeat(40)),['review'])
})

test('a caller-supplied gemini verdict head must match the head under review',()=>{
  const head='e'.repeat(40)
  assert.deepEqual(wrapperVerdictContractArgs('ai-gemini',['new','--governed-verdict',head,'sess'],head),['new','--governed-verdict',head,'sess'])
  assert.throws(()=>wrapperVerdictContractArgs('ai-gemini',['new','--governed-verdict','f'.repeat(40),'sess'],head),/does not match the head under review/)
})

test('every caller-supplied Qwen verdict head spelling is checked',()=>{
  const head='e'.repeat(40),other='f'.repeat(40)
  assert.deepEqual(wrapperVerdictContractArgs('ai-qwen',['new','--governed-verdict',head,'sess'],head),['new','--governed-verdict',head,'sess'])
  assert.deepEqual(wrapperVerdictContractArgs('ai-qwen',['new','--governed-verdict='+head,'sess'],head),['new','--governed-verdict='+head,'sess'])
  assert.throws(()=>wrapperVerdictContractArgs('ai-qwen',['new','--governed-verdict='+other,'sess'],head),/does not match the head under review/)
  assert.throws(()=>wrapperVerdictContractArgs('ai-qwen',['new','--governed-verdict',head,'sess','--governed-verdict',other],head),/does not match the head under review/)
})

test('a Qwen review without new or ask is refused before spawn',()=>{
  assert.throws(()=>wrapperVerdictContractArgs('ai-qwen',['--prompt','x'],'a'.repeat(40)),/new or ask subcommand/)
})

test('a gemini review that does not start with a subcommand is refused',()=>{
  assert.throws(()=>wrapperVerdictContractArgs('ai-gemini',['--prompt','x'],'a'.repeat(40)),/new or ask subcommand/)
})

test('the injected contract reaches the spawned gemini wrapper',()=>{
  const head='a'.repeat(40),seen=[]
  const spawn=(command,args)=>{seen.push([command,args]);return command==='gh'?{status:0,stdout:JSON.stringify({html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-1'})}:{status:0,stdout:`Findings.
VERDICT: APPROVE ${head}`}}
  runGovernedReview({...options,reviewer:'gemini-3.8-flash-high',wrapper:'ai-gemini',wrapperArgs:['new','sess','--prompt','x']},{spawn,resolve:(name)=>name,preflight:()=>{},record:()=>({ref:'refs/db-review-verdicts/x',sha:'b'.repeat(40)})})
  assert.deepEqual(seen[0][1],['new','--governed-verdict',head,'sess','--prompt','x','--base','c'.repeat(40),'--assert-head',head])
})

test('every spelling of a caller-supplied gemini verdict head is checked',()=>{
  const head='e'.repeat(40),other='f'.repeat(40)
  assert.deepEqual(wrapperVerdictContractArgs('ai-gemini',['new','--governed-verdict='+head,'sess'],head),['new','--governed-verdict='+head,'sess'])
  assert.throws(()=>wrapperVerdictContractArgs('ai-gemini',['new','--governed-verdict='+other,'sess'],head),/does not match the head under review/)
  assert.throws(()=>wrapperVerdictContractArgs('ai-gemini',['new','--governed-verdict',head,'sess','--governed-verdict',other],head),/does not match the head under review/)
})

test('the gemini wrapper is recognised through path form, extension and case',()=>{
  const head='a'.repeat(40)
  for(const wrapper of [String.raw`C:\\tools\\AI-Gemini.CMD`,'/usr/local/bin/ai-gemini','ai-gemini.exe'])assert.deepEqual(wrapperVerdictContractArgs(wrapper,['new','sess'],head),['new','--governed-verdict',head,'sess'])
  for(const wrapper of ['ai-gemini-review','my-ai-gemini','ai-geminix'])assert.deepEqual(wrapperVerdictContractArgs(wrapper,['new','sess'],head),['new','sess'])
})

test('a mismatched gemini verdict head stops the review before the wrapper runs',()=>{
  const head='a'.repeat(40),seen=[]
  assert.throws(()=>runGovernedReview({...options,reviewer:'gemini-3.8-flash-high',wrapper:'ai-gemini',wrapperArgs:['new','--governed-verdict','f'.repeat(40),'sess']},{spawn:(c)=>{seen.push(c);return{status:0,stdout:''}},resolve:(name)=>name,preflight:()=>{},record:()=>{throw new Error('must not record')}}),/does not match the head under review/)
  assert.deepEqual(seen,[])
})

test('the gemini path still preflights, then spawns, then records the head under review',()=>{
  const head='a'.repeat(40),order=[],recorded=[]
  const spawn=(command,args)=>{order.push(command==='gh'?'findings':'spawn');return command==='gh'?{status:0,stdout:JSON.stringify({html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-1'})}:{status:0,stdout:`Findings.
VERDICT: APPROVE ${head}`}}
  runGovernedReview({...options,reviewer:'gemini-3.8-flash-high',wrapper:'ai-gemini',wrapperArgs:['new','sess']},{spawn,resolve:(name)=>name,preflight:()=>{order.push('preflight')},record:(input)=>{order.push('record');recorded.push(input);return{ref:'refs/db-review-verdicts/x',sha:'b'.repeat(40)}}})
  assert.equal(order[0],'preflight','preflight runs before the wrapper is spawned')
  assert.equal(order[1],'spawn')
  assert.equal(order.indexOf('record'),order.length-1,'the verdict is recorded last')
  assert.equal(recorded.length,1)
  assert.equal(recorded[0].headSha,head,'the recorded head is the head under review, not one the wrapper chose')
})

// #2464. THE VOID MUST NEVER RUN AFTER THE ARTIFACT WAS CREATED.
// `recordReviewVerdict` marks a post-create failure with `verdictArtifactCreated`.
// The artifact's recorded findings_digest is the sha256 of the comment this run
// posted, so editing that comment permanently invalidates a verdict that exists
// and can never be rewritten. On PR #2409 that burned the (issue, pr, head, slot)
// tuple on four consecutive rounds.
test('a failure AFTER the create-only artifact exists never edits the findings comment (#2464)',()=>{
  const calls=[]
  const spawn=(command,args,spawnOptions)=>{
    if(command!=='gh')return{status:0,stdout:wrapperOut}
    calls.push({verb:args[2],url:args[3],body:JSON.parse(spawnOptions.input).body})
    return{status:0,stdout:commentJson}
  }
  const record=()=>{
    const error=new Error('readback could not confirm the created object')
    error.verdictArtifactCreated={ref:'refs/db-review-verdicts/2334-2000-'+'a'.repeat(40)+'-slot2',sha:'d'.repeat(40)}
    throw error
  }
  let thrown
  try{runGovernedReview(options,{spawn,resolve:(name)=>name,preflight:()=>{},record})}
  catch(error){thrown=error}
  assert.ok(thrown,'the round still fails loudly')
  assert.equal(calls.some((call)=>call.verb==='PATCH'),false,'the findings comment must be left untouched')
  const note=calls.filter((call)=>call.verb==='POST').at(-1).body
  assert.match(note,/THE DURABLE VERDICT ARTIFACT WAS CREATED AND IS LEFT INTACT/)
  assert.match(note,/refs\/db-review-verdicts\/2334-2000-a{40}-slot2/)
  assert.match(note,/left UNTOUCHED on purpose/)
  assert.match(thrown.message,/WAS created/)
  assert.equal(/REVIEW RECORDING FAILED/.test(note),false,'this is not the voiding failure notice')
})

// The marker also arrives UNCONFIRMED, when the read that would have proved the
// ref threw. The behaviour is identical -- nothing is edited -- but the notice
// must not claim the artifact exists. Without this case, code that always
// printed the definite wording would pass the test above (muse-spark, round 3).
test('an UNCONFIRMED marker is reported tentatively and still edits nothing (#2464)',()=>{
  const calls=[]
  const spawn=(command,args,spawnOptions)=>{
    if(command!=='gh')return{status:0,stdout:wrapperOut}
    calls.push({verb:args[2],body:JSON.parse(spawnOptions.input).body})
    return{status:0,stdout:commentJson}
  }
  const record=()=>{
    const error=new Error('the winner read threw after a failed create')
    error.verdictArtifactCreated={ref:'refs/db-review-verdicts/2334-2000-'+'a'.repeat(40)+'-slot2',sha:'d'.repeat(40),confirmed:false}
    throw error
  }
  let thrown
  try{runGovernedReview(options,{spawn,resolve:(name)=>name,preflight:()=>{},record})}
  catch(error){thrown=error}
  assert.ok(thrown)
  assert.equal(calls.some((call)=>call.verb==='PATCH'),false,'an unprovable ref state must not be voided either')
  const note=calls.filter((call)=>call.verb==='POST').at(-1).body
  assert.match(note,/THE DURABLE VERDICT ARTIFACT MAY HAVE BEEN CREATED/)
  assert.equal(/WAS CREATED AND IS LEFT INTACT/.test(note),false,'an unconfirmed artifact must not be reported as created')
  assert.match(thrown.message,/MAY have been created and could not be read back/)
  // glm-5.3, PR #2468 round 4: the HEADLINE was tentative but the body prose
  // still asserted an artifact that exists. The whole notice must hedge.
  assert.equal(/a verdict that already exists/.test(note),false,'the unconfirmed notice body must not assert the artifact exists')
  assert.match(note,/could permanently invalidate a verdict that may already exist/)
  assert.equal(/so its digest stays valid/.test(thrown.message),false,'the unconfirmed throw must not assert a recorded digest')
})


// ---------------------------------------------------------------------------
// Issue #2244: the codex wrapper publishes its verdict in a report file, not on
// standard output. These prove the transcription, and prove it FAILS CLOSED on
// every dirty shape -- a checker that has never been shown a known-bad case is
// not a checker.
// ---------------------------------------------------------------------------

const codexHead='a'.repeat(40)
const codexReport=(overrides={})=>{
  const {head=codexHead,decision='APPROVE',findings='Coverage: scripts/run-governed-review.mjs.\n\nNo blocking finding.',verdictSection=true}=overrides
  return [
    '# Codex review — diff-review','',
    '| field | value |','|---|---|',
    '| repository | `C:/review` |',
    `| reviewed commit | \`${head}\` |`,
    '| source digest | `'+'d'.repeat(64)+'` |',
    '| run | `20260908T190000-1234-5678` |','| caller | `shared-db` |','| elapsed seconds | `41` |','| sandbox | `read-only` |','',
    '## Result','',findings,'',
    ...(verdictSection?['## Verdict',decision]:[]),
  ].join('\n')+'\n'
}
const codexPath='C:/review/.ai/reviews/codex-diff-review-20260908T190000-1234-5678.md'

test('#2244: a published codex report becomes a recordable terminal verdict bound to the pinned head',()=>{
  const body=codexGovernedBody(codexReport(),codexHead,'codex-diff-review-20260908T190000-1234-5678.md')
  assert.equal(verdictFromOutput(body,codexHead),'APPROVE')
  assert.deepEqual(extraVerdictLines(body),[],'the transcription introduces no second decision line')
  assert.match(body,/No blocking finding\./,'the reviewer findings survive transcription')
  assert.equal(verdictFromOutput(codexGovernedBody(codexReport({decision:'REJECT'}),codexHead),codexHead),'REJECT')
})

test('#2244: the wrapper header table is left out so the posted body names one commit only',()=>{
  const body=codexGovernedBody(codexReport(),codexHead)
  const shas=[...body.matchAll(/[0-9a-f]{40}/gi)].map((match)=>match[0].toLowerCase())
  assert.deepEqual([...new Set(shas)],[codexHead],'a 64-hex source digest would read as a foreign commit sha')
})

test('#2244: the head comes only from the runner, and a report about another commit is refused',()=>{
  assert.throws(()=>codexGovernedBody(codexReport({head:'b'.repeat(40)}),codexHead),/reviewed a different commit/)
  assert.throws(()=>codexGovernedBody(codexReport().replace(/\| reviewed commit .*\n/,''),codexHead),/does not declare the commit it reviewed/)
  // The report cannot SUPPLY a head: an unusable pinned head is refused outright,
  // however well-formed the report is.
  assert.throws(()=>codexGovernedBody(codexReport(),''),/not a commit sha/)
})

test('#2244: known-dirty codex reports are refused rather than guessed',()=>{
  assert.throws(()=>codexGovernedBody(codexReport({verdictSection:false}),codexHead),/exactly one verdict section/)
  assert.throws(()=>codexGovernedBody(`${codexReport()}\n## Verdict\nAPPROVE\n`,codexHead),/exactly one verdict section/)
  assert.throws(()=>codexGovernedBody(codexReport({decision:'BLOCKED'}),codexHead),/BLOCKED, which is not a recordable decision/)
  assert.throws(()=>codexGovernedBody(codexReport({decision:'LGTM'}),codexHead),/does not carry a recordable decision/)
  assert.throws(()=>codexGovernedBody(codexReport({findings:''}),codexHead),/carries no findings to record/)
  assert.throws(()=>codexGovernedBody(codexReport().replace('## Result','## Output'),codexHead),/does not carry a result section/)
})

test('#2244: a reviewer that writes its own Result heading keeps its review',()=>{
  const body=codexGovernedBody(codexReport({findings:'## Result\nA nested heading in the reviewer text.'}),codexHead)
  assert.match(body,/A nested heading in the reviewer text\./)
  assert.equal(verdictFromOutput(body,codexHead),'APPROVE')
})

test('#2244: only the wrapper report shape is accepted as a path to read',()=>{
  assert.equal(codexReportPath(`noise\n${codexPath}`),codexPath)
  assert.equal(codexReportPath('C:\\review\\.ai\\reviews\\codex-final-check-20260908T190000-1-2.md'),'C:\\review\\.ai\\reviews\\codex-final-check-20260908T190000-1-2.md')
  assert.throws(()=>codexReportPath(''),/printed no report path/)
  assert.throws(()=>codexReportPath('C:/review/.ai/reviews/notes.md'),/not a published report path/)
  assert.throws(()=>codexReportPath('C:/Users/ahazan/.ssh/codex-diff-review-20260908T190000-1-2.md'),/not inside the wrapper report directory/)
})

test('#2244: the runner records a codex review end to end without relaxing any rule',()=>{
  const order=[]
  const spawn=(command)=>{order.push(command);return command==='gh'
    ?{status:0,stdout:JSON.stringify({html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-244'})}
    :{status:0,stdout:`${codexPath}\n`}}
  let recorded
  const result=runGovernedReview({...options,headSha:codexHead,reviewer:'codex-gpt-5.6-sol',wrapper:'ai-codex-review',wrapperArgs:['diff-review']},{
    spawn,resolve:(name)=>name,preflight:()=>order.push('preflight'),readReport:(path)=>{assert.equal(path,codexPath);order.push('read');return codexReport()},
    record:(row)=>{recorded=row;order.push('record');return{ref:'refs/db-review-verdicts/x',sha:'b'.repeat(40)}},
  })
  assert.deepEqual(order,['preflight','ai-codex-review','read','gh','record'])
  assert.equal(recorded.verdict,'APPROVE')
  assert.equal(recorded.headSha,codexHead)
  assert.match(result.body,/NON-AUTHORIZING UNLESS/)
  assert.ok(!anyVerdictFor([{author_association:'OWNER',body:result.body}],'b'.repeat(40)),'the body ties to no head but the pinned one')
})

test('#2244: a codex report that cannot be transcribed refuses and publishes nothing',()=>{
  for(const [stdout,report,expected] of [
    ['not-a-report-path',codexReport(),/not a published report path/],
    [codexPath,codexReport({decision:'BLOCKED'}),/BLOCKED/],
    [codexPath,codexReport({head:'c'.repeat(40)}),/different commit/],
  ]){
    let ghCalls=0
    assert.throws(()=>runGovernedReview({...options,headSha:codexHead,wrapper:'ai-codex-review',wrapperArgs:['diff-review']},{
      spawn:(command)=>{if(command==='gh')ghCalls++;return command==='gh'?{status:0,stdout:'{}'}:{status:0,stdout:stdout}},
      resolve:(name)=>name,preflight:()=>{},readReport:()=>report,record:()=>assert.fail('must not record'),
    }),(error)=>{assert.match(error.message,/did not produce a recordable terminal verdict/);assert.match(error.message,expected);return true})
    assert.equal(ghCalls,0,'an untranscribable codex round writes nothing to GitHub')
  }
})

test('#2244: a failing codex run is never rescued by a report left behind',()=>{
  assert.throws(()=>runGovernedReview({...options,headSha:codexHead,wrapper:'ai-codex-review',wrapperArgs:['diff-review']},{
    spawn:()=>({status:1,stderr:'timed out',stdout:codexPath}),
    resolve:(name)=>name,preflight:()=>{},readReport:()=>assert.fail('a failed run must not read a report'),record:()=>assert.fail('must not record'),
  }),/reported a timeout/)
})

test('#2244: a codex review whose findings carry a stray decision line still takes the preservation path',()=>{
  const posts=[]
  assert.throws(()=>runGovernedReview({...options,headSha:codexHead,wrapper:'ai-codex-review',wrapperArgs:['diff-review']},{
    spawn:(command,args,opts)=>{if(command!=='gh')return{status:0,stdout:codexPath};posts.push(JSON.parse(opts.input).body);return{status:0,stdout:JSON.stringify({html_url:'https://x/#c1'})}},
    resolve:(name)=>name,preflight:()=>{},
    readReport:()=>codexReport({findings:'APPROVE the change once the index is added.'}),
    record:()=>assert.fail('must not record'),
  }),/would read as a decision/)
  assert.equal(posts.length,1)
  assert.match(posts[0],new RegExp(PRESERVED_HEADER.split('\n')[0]))
  assert.ok(!anyVerdictFor([{author_association:'OWNER',body:posts[0]}],codexHead))
})

test('#2244: other wrappers are untouched by the codex bridge',()=>{
  assert.equal(wrapperBaseName('C:/tools/AI-Codex-Review.CMD'),'ai-codex-review')
  assert.equal(wrapperBaseName('ai-glm'),'ai-glm')
  const order=[]
  runGovernedReview(options,{
    spawn:(command)=>{order.push(command);return command==='gh'?{status:0,stdout:JSON.stringify({html_url:'https://x/#c2'})}:{status:0,stdout:`Fine.\nVERDICT: APPROVE ${options.headSha}`}},
    resolve:(name)=>name,preflight:()=>{},readReport:()=>assert.fail('no report is read for a non-codex wrapper'),
    record:()=>({ref:'refs/db-review-verdicts/z',sha:'e'.repeat(40)}),
  })
  assert.deepEqual(order,['ai-glm','gh'])
})

// ISSUE #2307 — DO NOT MAKE THE CODEX WRAPPER PRINT A TERMINAL VERDICT LINE.
// An abandoned 2026-09-04 branch added an opt-in `VERDICT: <decision> <sha>` line
// to ai-devops/bin/ai-codex-review, because this reviewer looked dead: it printed
// only a report path and every round was refused for "no recordable terminal
// verdict". That was true of an older runner. This one reads the codex verdict
// out of the published report, and it finds the report by taking the LAST line of
// stdout, so appending anything after that path makes every codex review refuse.
// The fix for a dead-looking codex reviewer is never to move its verdict onto
// stdout.
test('issue 2307: a verdict line appended after the codex report path breaks the round',()=>{
  const codexPath='C:/review/.ai/reviews/codex-diff-review-20260908T190000-1-2.md'
  assert.equal(codexReportPath(codexPath),codexPath)
  assert.throws(()=>codexReportPath(`${codexPath}\nVERDICT: APPROVE ${'a'.repeat(40)}`),/not a published report path/)
})

// The assertion above must fail for the RIGHT reason. `codexReportPath` has three
// distinct refusals, and a test matching only "not a published report path" would
// still pass if the appended line had instead emptied the candidate or moved it
// out of the report directory. Pin all three so the regression test cannot drift
// into asserting a different failure than the one issue #2307 is about.
test('issue 2307: the appended-verdict refusal is distinct from the other two',()=>{
  const codexPath='C:/review/.ai/reviews/codex-diff-review-20260908T190000-1-2.md'
  assert.throws(()=>codexReportPath(''),/printed no report path/)
  assert.throws(()=>codexReportPath('C:/review/notes/codex-diff-review-20260908T190000-1-2.md'),/not inside the wrapper report directory/)
  assert.throws(()=>codexReportPath(`${codexPath}\nVERDICT: APPROVE ${'a'.repeat(40)}`),/final line is not a published report path/)
})

// Issue #2729 Step 7: retry once, then reroute; terminal non-verdicts reroute at the same head.
import { GovernedReviewRerouteError, preflightWithTimeoutRetry, reviewAssignmentIdentity } from './run-governed-review.mjs'
const doctorTimeout=()=>{throw new Error('reviewer glm-5.3 preflight failed: doctor reports "doctor did not answer within 60s"')}
const okSpawn=(file)=>file==='gh'?{status:0,stdout:JSON.stringify({html_url:'https://github.com/u2giants/shared-db/pull/2000#issuecomment-1',id:1})}:{status:0,stdout:`VERDICT: APPROVE ${options.headSha}`}

test('issue 2729: one doctor timeout retries the SAME reviewer once and then reviews',()=>{
  let preflights=0,repairs=0,providers=0
  const events=[]
  const result=runGovernedReview(options,{preflight:()=>{if(++preflights===1)doctorTimeout()},repairLocalService:()=>repairs++,appendLifecycle:(e)=>events.push(e),resolve:(x)=>x,spawn:(file)=>{if(file!=='gh')providers++;return okSpawn(file)},record:()=>({ref:'refs/db-review-verdicts/x',sha:'b'.repeat(40)})})
  assert.equal(preflights,2);assert.equal(repairs,1);assert.equal(providers,1);assert.ok(result.artifact)
  assert.deepEqual(events.map((e)=>e.type),['preflight_timeout','review_started'])
})

test('issue 2729: a second doctor timeout reroutes and never contacts the provider',()=>{
  let preflights=0,providers=0
  const events=[]
  assert.throws(()=>runGovernedReview(options,{preflight:()=>{preflights++;doctorTimeout()},appendLifecycle:(e)=>events.push(e),resolve:(x)=>x,spawn:()=>{providers++;assert.fail('must not contact provider')},record:()=>assert.fail('must not record')}),(error)=>{
    assert.ok(error instanceof GovernedReviewRerouteError)
    assert.equal(error.startDecision.action,'governed-return-and-reroute')
    assert.equal(error.startDecision.reason,'local_preflight_timeout')
    assert.equal(error.startDecision.head_sha,options.headSha)
    return true
  })
  assert.equal(preflights,2,'retried exactly once, never more');assert.equal(providers,0)
  assert.deepEqual(events.map((e)=>e.type),['preflight_timeout','preflight_timeout'])
  assert.ok(events.every((e)=>e.assignment_id===reviewAssignmentIdentity(options).id&&e.source==='governed-review-runner'))
})

test('issue 2729: a non-timeout preflight refusal is neither retried nor rerouted',()=>{
  let preflights=0
  assert.throws(()=>runGovernedReview(options,{preflight:()=>{preflights++;throw new Error('reviewer is quarantined')},resolve:(x)=>x,spawn:()=>assert.fail('must not spawn'),record:()=>assert.fail('must not record')}),(error)=>{assert.ok(!(error instanceof GovernedReviewRerouteError));assert.match(error.message,/quarantined/);return true})
  assert.equal(preflights,1)
  assert.throws(()=>preflightWithTimeoutRetry({},reviewAssignmentIdentity(options),{preflight:()=>{throw new Error('doctor answered: broken')}}),/broken/)
})

test('issue 2729: turn_limit_cancelled is a terminal non-verdict eligible for same-head replacement',()=>{
  const events=[]
  assert.throws(()=>runGovernedReview(options,{preflight:()=>{},appendLifecycle:(e)=>events.push(e),resolve:(x)=>x,spawn:()=>({status:1,stderr:'reason: turn_limit_cancelled private-value',stdout:''}),record:()=>assert.fail('must not record')}),(error)=>{
    assert.ok(error instanceof GovernedReviewRerouteError)
    assert.match(error.message,/turn_limit_cancelled:.*turn budget/)
    assert.ok(!error.message.includes('private-value'))
    const d=error.startDecision
    assert.deepEqual([d.action,d.reason,d.head_sha,d.same_head],['governed-return-and-reroute','turn_limit_cancelled',options.headSha,true])
    return true
  })
  assert.deepEqual(events.map((e)=>[e.type,e.reason,e.head_sha]),[['review_started',undefined,undefined],['terminal_non_verdict','turn_limit_cancelled',options.headSha]])
})

test('issue 2729: other wrapper failures stay plain refusals with no reroute decision',()=>{
  for(const stderr of ['reason: provider_cancelled','reason: unknown_terminal_reason','timed-out','private-value']){
    assert.throws(()=>runGovernedReview(options,{preflight:()=>{},resolve:(x)=>x,spawn:()=>({status:1,stderr,stdout:''}),record:()=>assert.fail('must not record')}),(error)=>{assert.equal(error.startDecision,undefined);assert.ok(!(error instanceof GovernedReviewRerouteError));return true})
  }
})

test('parseArgs refuses unknown arguments instead of silently defaulting the slot (#2467)',()=>{
  assert.throws(()=>parseArgs(['--issue','1','--pr','2','--slot','2','--','review']),/unknown governed review argument --slot \(use --review-slot\)/)
  assert.throws(()=>parseArgs(['--issue','1','--bogus','x']),/unknown governed review argument --bogus/)
  assert.throws(()=>parseArgs(['issue','1']),/--name value pairs/)
  const parsed=parseArgs(['--issue','1','--pr','2','--head-sha','a','--reviewer','r','--wrapper','w','--worktree','t','--review-slot','2','--replacement-sequence','3','--assignment-id','x','--skip-doctor','true','--','review','--slot','9'])
  assert.equal(parsed.slot,2);assert.equal(parsed.issue,1);assert.deepEqual(parsed.wrapperArgs,['review','--slot','9'])
  assert.equal(parseArgs(['--issue','1','--pr','2']).slot,1)
})

test('a wrapper call missing new <session-name> is refused with the usage line (#498)',()=>{
  const head='a'.repeat(40)
  assert.throws(()=>wrapperVerdictContractArgs('ai-gemini',['--prompt-file','p.md'],head),/must start with the new or ask subcommand; got "--prompt-file"\. Usage after the runner options: -- new <session-name> --prompt-file <file>/)
  assert.throws(()=>wrapperVerdictContractArgs('ai-qwen',['new','--prompt-file','p.md'],head),/ai-qwen new has no <session-name>\. Usage after the runner options: -- new <session-name>/)
  assert.throws(()=>wrapperVerdictContractArgs('ai-deepseek-agent',['reply','--review'],head),/ai-deepseek-agent reply has no <session-name>.*-- reply <session-name>/)
  assert.throws(()=>wrapperVerdictContractArgs('ai-gemini',[],head),/got no wrapper arguments/)
  assert.deepEqual(wrapperVerdictContractArgs('ai-gemini',['new','review-3100','--prompt-file','p.md'],head),['new','--governed-verdict',head,'review-3100','--prompt-file','p.md'])
})

import { prepareGovernedReview, reviewCallerEnvironment, promptHeadContract } from './run-governed-review.mjs'
// popcre/ai-devops#498 items 16-17: paperwork faults are refused or repaired before any reviewer starts.
test('#498-16 caller variable is kept, detected, or named in a pre-start refusal', () => {
  assert.deepEqual(reviewCallerEnvironment('ai-muse',{AI_MUSE_CALLER:'codex',CLAUDECODE:'1'}),{AI_MUSE_CALLER:'codex'})
  assert.deepEqual(reviewCallerEnvironment('ai-muse',{CLAUDECODE:'1'}),{AI_MUSE_CALLER:'claude'})
  assert.deepEqual(reviewCallerEnvironment('C:/bin/ai-grok-review.cmd',{CODEX_THREAD_ID:'t'}),{AI_GROK_CALLER:'codex'})
  assert.throws(()=>reviewCallerEnvironment('ai-muse',{}),/needs AI_MUSE_CALLER set.*No reviewer was started.*AI_MUSE_CALLER=claude/)
  assert.deepEqual(reviewCallerEnvironment('unlisted-wrapper',{}),{})
})
test('#498-17 live head is injected, a stale named head or stale prompt verdict line refuses before start', () => {
  const live='a'.repeat(40),stale='b'.repeat(40)
  const github=()=>({status:0,stdout:JSON.stringify({head:{sha:live}})})
  const written={}
  const files=(text)=>({readFile:()=>text,writeFile:(p,t)=>{written[p]=t},tempDir:()=>'T'})
  const base={pr:3031,wrapper:'ai-muse',wrapperArgs:['new','s1','--prompt-file','brief.md']}
  const ok=prepareGovernedReview(base,{env:{CLAUDECODE:'1'},github,files:files('Review it.')})
  assert.equal(ok.options.headSha,live)
  assert.deepEqual(ok.callerEnv,{AI_MUSE_CALLER:'claude'})
  const copy=ok.options.wrapperArgs[3]
  assert.notEqual(copy,'brief.md')
  assert.ok(written[copy].startsWith('Review it.')&&written[copy].includes(`VERDICT: APPROVE ${live}`))
  for(const word of ['APPROVE','REVISE','REJECT']){assert.ok(written[copy].includes(`VERDICT: ${word} ${live}`));assert.notEqual(verdictFromOutput(`VERDICT: ${word} ${live}`,live),null)}
  assert.ok(!/REQUEST_CHANGES/.test(written[copy]))
  assert.throws(()=>prepareGovernedReview({...base,headSha:stale},{env:{CLAUDECODE:'1'},github,files:files('x')}),/is stale.*now at a{40}.*No reviewer was started/)
  assert.throws(()=>prepareGovernedReview(base,{env:{CLAUDECODE:'1'},github,files:files(`End with VERDICT: APPROVE ${stale.slice(0,8)}`)}),/names head bbbbbbbb.*No reviewer was started/)
  assert.equal(prepareGovernedReview({...base,headSha:live.toUpperCase()},{env:{CLAUDECODE:'1'},github,files:files(`VERDICT: APPROVE ${live}`)}).options.headSha,live)
  assert.deepEqual(promptHeadContract(['send','--prompt','go','--review'],live)[2].startsWith('go'),true)
  assert.throws(()=>prepareGovernedReview(base,{env:{CLAUDECODE:'1'},github:()=>({status:1,error:new Error('x')}),files:files('x')}),/could not read the live head/)
})

// Issue #3027 Step 7: the durable start marker is written before the provider launches and fails closed.
import { recordReviewStart, reviewStartedRef } from './run-governed-review.mjs'
test('review start marker is recorded before the provider spawns, and a failed record starts nothing',()=>{
  const order=[]
  assert.throws(()=>runGovernedReview(options,{preflight:()=>{},resolve:(name)=>name,recordStart:()=>{order.push('start');throw new Error('review start marker could not be recorded; no reviewer was started')},spawn:()=>{order.push('spawn');return{status:1,stdout:''}},record:()=>assert.fail('must not record')}),/no reviewer was started/)
  assert.deepEqual(order,['start'])
  order.length=0
  try{runGovernedReview(options,{preflight:()=>{},resolve:(name)=>name,recordStart:()=>{order.push('start');return 'ref'},spawn:()=>{order.push('spawn');return{status:1,stdout:''}},record:()=>{}})}catch{}
  assert.deepEqual(order.slice(0,2),['start','spawn'])
  const ref=reviewStartedRef({issue:1,pr:2,headSha:'A'.repeat(40),slot:2},7)
  assert.equal(ref,`refs/db-review-started/1-2-${'a'.repeat(40)}-slot2-seq7`)
  const req={issue:1,pr:2,headSha:'a'.repeat(40),slot:2,reviewer:'kimi'},held=(r)=>({...r,sequence:7})
  const refs=new Map(),commits=new Map(),io={makeOwnerCommit:(message)=>{const sha=String(commits.size+1).padStart(40,'c');commits.set(sha,{message});return sha},createRef:(r,sha)=>{if(refs.has(r))return false;refs.set(r,sha);return true},readRef:(r)=>refs.get(r)??null,getCommit:(sha)=>commits.get(sha)??null}
  assert.equal(recordReviewStart(req,io,123,held),ref)
  assert.match(commits.get(refs.get(ref)).message,/^db-coordination review-started issue=1 pr=2 .* sequence=7 /)
  // A retry of the same lease finds its own marker and proceeds.
  assert.equal(recordReviewStart(req,io,124,held),ref)
  // A lease the unstarted reclaim already returned owns the marker with its release commit: nothing starts.
  refs.set(ref,'r'.repeat(40));commits.set('r'.repeat(40),{message:'db-coordination reviewer-silence-release reviewer=kimi'})
  assert.throws(()=>recordReviewStart(req,io,125,held),/occupied by a reclaim/)
  // No held lease, a lease reclaimed after the write, or unreadable leases: nothing starts.
  assert.throws(()=>recordReviewStart(req,io,126,()=>null),/no held reviewer lease/)
  let calls=0
  assert.throws(()=>recordReviewStart({...req,pr:3},io,127,(r)=>(calls++?null:{...r,sequence:8})),/reclaimed before the provider launched/)
  assert.throws(()=>recordReviewStart(req,io,128,()=>{throw new Error('active reviewer leases are unreadable; review start refused')}),/unreadable/)
  // A runner with no start recorder refuses before any provider launch.
  order.length=0
  assert.throws(()=>runGovernedReview(options,{preflight:()=>{},resolve:(name)=>name,recordStart:undefined,spawn:()=>{order.push('spawn');return{status:1,stdout:''}},record:()=>{}}),/start recorder is required/)
  assert.deepEqual(order,[])
  assert.throws(()=>reviewStartedRef({issue:1,pr:2,headSha:'short'},1),/exact issue/)
})

// ISSUE #2998 item 1 + ISSUE #2923: the brief, checked before a reviewer draw.
import { PROBE_REVIEW_CHECKLIST } from './run-governed-review.mjs'
test('#2998-1 a promptless handoff refuses before a draw; #2923 the probe checklist is front-loaded',()=>{
  const live='a'.repeat(40)
  const github=()=>({status:0,stdout:JSON.stringify({head:{sha:live}})})
  const written={}
  const files=(text)=>({readFile:()=>text,writeFile:(p,t)=>{written[p]=t},tempDir:()=>'T'})

  // #2998 item 1. Wrapper args carrying NEITHER --prompt NOR --prompt-file got no
  // injection at all, so the reviewer was sent a prompt with no terminal VERDICT line
  // and the approval was unrecordable. That now refuses before the draw.
  assert.throws(
    ()=>prepareGovernedReview({pr:2998,wrapper:'ai-muse',wrapperArgs:['new','s1']},{env:{CLAUDECODE:'1'},github,files:files('x')}),
    /carries no terminal VERDICT instruction.*neither --prompt nor --prompt-file.*No reviewer was started/s)
  assert.throws(
    ()=>promptHeadContract(['send','--prompt'],live),
    /carries no terminal VERDICT instruction/)

  // #2923. A single round must be asked for all three probe classes up front.
  const prepared=prepareGovernedReview({pr:2923,wrapper:'ai-muse',wrapperArgs:['new','s1','--prompt-file','brief.md']},{env:{CLAUDECODE:'1'},github,files:files('Review it.')})
  const body=written[prepared.options.wrapperArgs[3]]
  assert.ok(body.startsWith('Review it.'))
  for(const cue of [/\bindex\b/i,/volatilit/i,/IMMUTABLE/,/STABLE/,/VOLATILE/,/[Ee]xact object/])assert.match(body,cue)
  assert.ok(body.includes(PROBE_REVIEW_CHECKLIST.trim().split('\n')[0]))
  // The checklist is additive and the verdict contract still terminates the brief.
  assert.match(body,/report everything else\s*\nyou would normally raise as well; this list is a floor, never a ceiling/i)
  assert.ok(body.trimEnd().endsWith(`VERDICT: APPROVE ${live} | VERDICT: REVISE ${live} | VERDICT: REJECT ${live}`))
  // An inline --prompt carries the same checklist.
  assert.match(promptHeadContract(['send','--prompt','go'],live)[2],/volatilit/i)
})

// GOVERNED REVIEW OF PR #3338 — the two prompt-shape findings, fixed as a class.
import { CODEX_WRAPPER } from './run-governed-review.mjs'
test('#3338 review: the codex wrapper is exempt from the prompt contract, and equals-form prompts carry it',()=>{
  const live='a'.repeat(40)
  const github=()=>({status:0,stdout:JSON.stringify({head:{sha:live}})})
  const written={}
  const files=(text)=>({readFile:()=>text,writeFile:(p,t)=>{written[p]=t},tempDir:()=>'T'})

  // ai-codex-review takes NO prompt argument by design; its verdict is transcribed from
  // its published report. Requiring an injected contract from it refused a supported
  // wrapper. It must pass through untouched rather than throw.
  const codex=prepareGovernedReview({pr:3338,wrapper:CODEX_WRAPPER,wrapperArgs:['diff-review']},{env:{AI_CODEX_REVIEW_CALLER:'claude'},github,files:files('x')})
  assert.deepEqual(codex.options.wrapperArgs,['diff-review'])
  assert.deepEqual(promptHeadContract(['diff-review'],live,undefined,'C:/bin/ai-codex-review.cmd'),['diff-review'])
  // The exemption is ONLY for that wrapper. Every other wrapper still refuses.
  assert.throws(()=>promptHeadContract(['go'],live,undefined,'ai-muse'),/carries no terminal VERDICT instruction/)
  assert.throws(()=>promptHeadContract(['go'],live),/carries no terminal VERDICT instruction/)

  // Equals-form arguments previously fell through the exact-token match, so the brief
  // silently carried neither the checklist nor the verdict contract.
  const inline=promptHeadContract(['send',`--prompt=go`],live,undefined,'ai-muse')
  assert.match(inline[1],/^--prompt=go/)
  assert.match(inline[1],/volatilit/i)
  assert.ok(inline[1].trimEnd().endsWith(`VERDICT: REJECT ${live}`))
  const inlineFile=promptHeadContract(['send','--prompt-file=brief.md'],live,files('Review it.'),'ai-muse')
  assert.match(inlineFile[1],/^--prompt-file=/)
  const copy=inlineFile[1].slice('--prompt-file='.length)
  assert.match(written[copy],/volatilit/i)
  assert.ok(written[copy].startsWith('Review it.'))
  // The stale-head guard still applies to both equals forms.
  assert.throws(()=>promptHeadContract(['--prompt=End with VERDICT: APPROVE bbbbbbbb'],live,undefined,'ai-muse'),/names head bbbbbbbb/)
})

test('#2831: the runner refuses ai-muse review and passes ai-muse new through',()=>{
  const head='b'.repeat(40)
  assert.throws(()=>wrapperVerdictContractArgs('ai-muse',['review','look at this'],head),/ai-muse review subcommand is not one that takes the governed prompt as written[\s\S]*--failure-code reviewer_cannot_emit_governed_verdict/)
  assert.deepEqual(wrapperVerdictContractArgs('ai-muse',['new','look at this'],head),['new','look at this'])
})

// Owner requirement 2026-09-24: an out-of-credit reviewer failure is named, and the
// wrapper's plain-English OUT OF CREDIT line reaches the REFUSED text verbatim.
import { TERMINAL_FAILURE_CODES } from './manage-migration-author-lanes.mjs'
const OUT_OF_CREDIT_FIXTURES=[
  ['grok','OUT OF CREDIT: the xAI (Grok) account has run out of credits or hit its monthly spending limit - add credits at https://console.x.ai'],
  ['muse','OUT OF CREDIT: the Meta (Muse) account has run out of credits or hit its spending limit - add credits in the Meta developer console'],
  ['qwen','OUT OF CREDIT: the Alibaba Model Studio (Qwen) account has run out of credits or is in arrears - top up at https://modelstudio.console.alibabacloud.com'],
  ['gemini','OUT OF CREDIT: the Google Gemini account has run out of prepaid credits - add credits at https://aistudio.google.com'],
  ['deepseek','OUT OF CREDIT: the DeepSeek account has an insufficient balance - top up at https://platform.deepseek.com'],
]
const outOfCreditRun=(stderr)=>{
  const events=[]
  let caught
  assert.throws(()=>runGovernedReview(options,{preflight:()=>{},appendLifecycle:(e)=>events.push(e),resolve:(x)=>x,spawn:()=>({status:92,stderr,stdout:''}),record:()=>assert.fail('must not record')}),(error)=>{caught=error;return true})
  return {error:caught,events}
}
test('out of credit: every rotation provider carries its OUT OF CREDIT line verbatim into REFUSED and reroutes as insufficient_quota',()=>{
  for(const [provider,human] of OUT_OF_CREDIT_FIXTURES){
    const stderr=`raw provider body token=private-value\nAI_REVIEWER_OUT_OF_CREDIT provider=${provider} code=insufficient_quota\n${human}\n`
    const {error,events}=outOfCreditRun(stderr)
    assert.ok(error instanceof GovernedReviewRerouteError,provider)
    const refused=`REFUSED: ${error.message}`
    assert.ok(refused.includes(`insufficient_quota: ${human}`),provider)
    assert.match(refused,/^REFUSED: review wrapper did not produce a recordable terminal verdict \(exit 92\): insufficient_quota: OUT OF CREDIT: /)
    assert.ok(!refused.includes('private-value'),provider)
    assert.ok(!refused.includes('usage limit'),'the precise reason replaces the generic usage-limit text')
    const d=error.startDecision
    assert.deepEqual([d.action,d.reason,d.head_sha,d.same_head],['governed-return-and-reroute','insufficient_quota',options.headSha,true])
    assert.ok(TERMINAL_FAILURE_CODES.includes(d.reason),'the lane accepts --failure-code insufficient_quota')
    const last=events.at(-1)
    assert.deepEqual([last.type,last.reason,last.head_sha],['terminal_non_verdict','insufficient_quota',options.headSha])
  }
})
test('out of credit: a machine line without a valid human line gets fixed text naming the provider',()=>{
  for(const [provider,name] of [['grok','xAI (Grok)'],['muse','Meta (Muse)'],['qwen','Alibaba Model Studio (Qwen)'],['gemini','Google Gemini'],['deepseek','DeepSeek']]){
    const reason=wrapperFailureReason({stderr:`AI_REVIEWER_OUT_OF_CREDIT provider=${provider} code=insufficient_quota\n`})
    assert.equal(reason,`insufficient_quota: OUT OF CREDIT: the ${name} reviewer account has run out of credits or hit its spending limit`)
  }
})
test('out of credit: spoofed, overlong, embedded or non-ASCII lines are never echoed',()=>{
  const machine='AI_REVIEWER_OUT_OF_CREDIT provider=grok code=insufficient_quota'
  const fixed='insufficient_quota: OUT OF CREDIT: the xAI (Grok) reviewer account has run out of credits or hit its spending limit'
  for(const bad of [
    `OUT OF CREDIT: ${'x'.repeat(301)}`,
    'OUT OF CREDIT: short',
    'OUT OF CREDIT: add credits at https://console.x.ai — private-value',
    'OUT OF CREDIT: token\tprivate-value leaked here',
    ' OUT OF CREDIT: leading space private-value line',
    'prefix OUT OF CREDIT: private-value embedded in a provider body',
    'out of credit: lower-case private-value line text',
  ])assert.equal(wrapperFailureReason({stderr:`${machine}\n${bad}\n`}),fixed,JSON.stringify(bad))
  // Without an exact, anchored machine line from the allowlist, no OUT OF CREDIT text is echoed at all.
  for(const spoof of [
    'AI_REVIEWER_OUT_OF_CREDIT provider=evil code=insufficient_quota',
    'AI_REVIEWER_OUT_OF_CREDIT provider=grok code=insufficient_quota private-value',
    'x AI_REVIEWER_OUT_OF_CREDIT provider=grok code=insufficient_quota',
    'AI_REVIEWER_OUT_OF_CREDIT provider=grok code=rate_limited',
  ]){
    const reason=wrapperFailureReason({stderr:`${spoof}\nOUT OF CREDIT: private-value pretending to be the provider\n`})
    assert.ok(!reason.includes('private-value'),spoof)
    assert.ok(!reason.startsWith('insufficient_quota:'),spoof)
  }
})
test('out of credit: raw provider billing text alone is recognized without echoing it',()=>{
  const fixed='insufficient_quota: the provider reported that its account is out of credit or over its spending limit'
  for(const raw of [
    'ai-grok-review: 403 {"code":"The caller does not have permission","error":"Your team private-value has either used all available credits or reached its monthly spending limit."}',
    'Error: monthly spending limit reached for private-value',
    'DeepSeek 402 Insufficient Balance private-value',
    'InvalidParameter.Arrearage: Access denied, private-value account overdue',
    'Your prepayment credits are depleted. private-value',
  ]){
    assert.equal(wrapperFailureReason({stderr:raw}),fixed,raw)
    const {error}=outOfCreditRun(raw)
    assert.ok(error instanceof GovernedReviewRerouteError)
    assert.ok(!error.message.includes('private-value'))
    assert.equal(error.startDecision.reason,'insufficient_quota')
  }
})

test('#3479: a governed DeepSeek send carries the brief in an attached file with the verdict instruction',async()=>{
  const { promptHeadContract: contract, wrapperVerdictContractArgs: verdictArgs, DEEPSEEK_GOVERNED_MESSAGE: MESSAGE } = await import('./run-governed-review.mjs')
  const live='c'.repeat(40),W='C:/bin/ai-deepseek-agent'
  const io=(briefs={})=>{const written={};let n=0;return {written,files:{readFile:(p)=>briefs[p],writeFile:(p,v)=>{written[p]=v},tempDir:()=>`T${n++}`}}}
  const check=(args,expectedTail,expectBrief,briefs)=>{
    const {written,files}=io(briefs)
    const out=contract(args,live,files,W)
    const start=out[0]==='reply'?2:1
    assert.deepEqual(out.slice(start,start+2),[MESSAGE,'--file'])
    const body=written[out[start+2]]
    assert.ok(body.startsWith(expectBrief),body)
    assert.match(body,/volatilit/i)
    assert.ok(body.trimEnd().endsWith(`VERDICT: REJECT ${live}`))
    assert.deepEqual(out.slice(start+3),expectedTail)
    assert.ok(!out.some((a)=>/^--prompt/.test(a)))
    assert.ok(out.every((a)=>a.length<200),'argv never carries the brief')
    return out
  }
  // Positional form: the runner used to refuse it outright.
  check(['send','Review PR 1.','--review'],['--review'],'Review PR 1.')
  // --prompt-file: the wrapper has no such flag and would have sent the literal path.
  check(['send','--prompt-file','brief.md','--review'],['--review'],'Brief body.',{'brief.md':'Brief body.'})
  check(['send','--prompt-file=brief.md','--review'],['--review'],'Brief body.',{'brief.md':'Brief body.'})
  // Every canonical value flag keeps its value; a value is never taken for the brief.
  for(const flag of ['--timeout','--decision','--tests','--review-kind','--model','--file','--base','--assert-head'])
    check(['send',flag,'900','Review this.','--review'],[flag,'900','--review'],'Review this.')
  // Command-line order is kept when both forms are present.
  check(['send','--prompt','First.','Second.','--review'],['--review'],'First.\n\nSecond.')
  // A bare -- ends options; the separator is not forwarded.
  check(['send','--review','--','--looks-like-a-flag'],['--review'],'--looks-like-a-flag')
  // reply keeps the session id before the message.
  const reply=check(['reply','sess-1','--file','d.diff','Again.','--review'],['--file','d.diff','--review'],'Again.')
  assert.deepEqual(reply.slice(0,2),['reply','sess-1'])
  // Composes with the runner's later verdict contract.
  const composed=verdictArgs(W,contract(['send','Go.','--review'],live,io().files,W),live)
  assert.deepEqual(composed.slice(0,4),['send','--governed-verdict',live,MESSAGE])
  // The stale-head guard still applies, and a missing brief is still refused.
  assert.throws(()=>contract(['send','End with VERDICT: APPROVE bbbbbbbb','--review'],live,io().files,W),/names head bbbbbbbb/)
  assert.throws(()=>contract(['send','--review'],live,io().files,W),/carries no terminal VERDICT instruction/)
  assert.throws(()=>contract(['send','--timeout','900','--review'],live,io().files,W),/carries no terminal VERDICT instruction/)
})
