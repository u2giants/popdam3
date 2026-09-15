#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, lstatSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { REPO, recordReviewVerdict, reviewerExecutionPreflight, resolveCommandPath, githubIo, withMergedPrIssueBinding } from './manage-migration-author-lanes.mjs'
import { lineOpensWithVerdictWord, isVerdictFor } from './lib/review-verdict.mjs'
// Issue #2342: one shared transport owns the never-replay-a-write policy.
import { runGitHubCommand, spawnGitHub } from './lib/github-transport.mjs'
// Issue #2729 Step 7: one lifecycle source of truth decides retry versus reroute.
import { reviewerStartDecision, NON_VERDICT_TERMINAL_REASONS } from './orchestrator-flow/start-reroute.mjs'

export function parseArgs(argv){
  const split=argv.indexOf('--'),own=split<0?argv:argv.slice(0,split),wrapperArgs=split<0?[]:argv.slice(split+1),out={wrapperArgs,slot:1}
  for(let i=0;i<own.length;i+=2){const key=own[i]?.replace(/^--/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());if(!key||i+1>=own.length)throw new Error('governed review arguments must be --name value pairs followed by -- and wrapper arguments');out[key]=own[i+1]}
  out.issue=Number(out.issue);out.pr=Number(out.pr);out.slot=Number(out.reviewSlot??1)
  return out
}
export function verdictFromOutput(body,headSha){
  const lines=String(body??'').split(/\r?\n/).map((line)=>line.trim()).filter(Boolean)
  const verdictLines=lines.filter((line)=>/^VERDICT\s*:\s*(?:APPROVE|REVISE|REJECT)\b/i.test(line))
  if(verdictLines.length!==1||verdictLines[0]!==lines.at(-1))return null
  const match=/^VERDICT\s*:\s*(APPROVE|REVISE|REJECT)(?:\s+([0-9a-f]{40}))?\s*$/i.exec(verdictLines[0])
  if(!match||!match[2]||match[2].toLowerCase()!==String(headSha??'').toLowerCase())return null
  return match[1].toUpperCase()
}
export const VOID_MARKER='VERDICT LINE VOIDED BY THE GOVERNED REVIEW RUNNER'
export const VOID_LINE_PREFIX='> VOIDED REVIEWER LINE - '
// The header on a preserved-but-unrecordable findings comment (issue #2207). It is
// exported so a test can prove the header ITSELF is inert, independently of any
// findings body it is glued to.
export const PRESERVED_HEADER='GOVERNED REVIEW FINDINGS PRESERVED - NON-AUTHORIZING, NO VERDICT WAS RECORDED\n\nThis round cannot be recorded as a verdict, so none was. The reviewer findings are kept below with every parseable decision line voided. Acting on them requires a fresh governed review at this head.'

// Every line a DOWNSTREAM consumer would read as a verdict, other than the one
// terminal strict `VERDICT:` line this runner itself recorded. `verdictFromOutput`
// above accepts exactly one unprefixed terminal `VERDICT:` line, but
// `anyVerdictFor`/`isVerdictFor` in lib/review-verdict.mjs accept ANY line that
// opens with a decision word once leading `[\s>*_#-]` punctuation and an optional
// `VERDICT:` label are stripped. So `> VERDICT: APPROVE <sha>`, `## VERDICT:
// APPROVE <sha>`, `**APPROVE** <sha>` and a bare `APPROVE` line are all verdicts
// to the lane tooling while being invisible to the recorder (issue #2075, round 2).
// Such a body is REFUSED BEFORE THE COMMENT IS POSTED: that is the only way the
// extra copy never exists on the pull request at all, and it fails in the safe
// direction (a review that must be re-run, never a verdict nobody recorded).
export function extraVerdictLines(body){
  const lines=String(body??'').split(/\r?\n/)
  let terminal=-1
  for(let i=lines.length-1;i>=0;i-=1){if(lines[i].trim()){terminal=i;break}}
  return lines.filter((line,index)=>index!==terminal&&lineOpensWithVerdictWord(line))
}

// `error.message` is attacker-adjacent text: it can carry a newline followed by
// `APPROVE <sha>`, which would reconstruct a parseable verdict line inside the
// replacement block itself. Newlines are the whole attack, so they are removed
// rather than escaped, and the result is bounded.
export function sanitizeVoidReason(reason){
  const flat=String(reason??'').replace(/[\r\n\u2028\u2029]+/g,' ').replace(/\s+/g,' ').trim()
  return (flat.length>500?`${flat.slice(0,500)}...`:flat)||'no reason was reported'
}

// Rewrites EVERY line of an already-posted findings comment that any consumer
// would read as a verdict -- not only the terminal strict `VERDICT:` line -- into
// a clearly-marked voided form, and appends an explanation. The reviewer's
// analysis is evidence: the text of each voided line is preserved verbatim after
// a prefix, and every other line is untouched.
//
// The prefix is `> VOIDED REVIEWER LINE - `. `stripVerdictLabel` removes leading
// `[\s>*_#-]` punctuation and an optional `VERDICT:` label, so the surviving line
// opens with the WORD "VOIDED" and no consumer reads it as a decision. A bare `>`
// would NOT have been enough: it is stripped.
//
// This claim is not left to the comment. `runGovernedReview` re-parses the result
// with the real consumer predicate and refuses to call the void successful unless
// it comes back clean.
export function neutraliseVerdictLine(body,reason){
  const lines=String(body??'').split(/\r?\n/)
  const targets=lines.map((line,index)=>index).filter((index)=>lineOpensWithVerdictWord(lines[index]))
  if(!targets.length)return null
  const decisions=[...new Set(targets.map((index)=>/(APPROVE|REVISE|REJECT|REQUEST[_\s]CHANGES)/i.exec(lines[index])?.[1]?.toUpperCase()??'UNKNOWN'))]
  for(const index of targets)lines[index]=`${VOID_LINE_PREFIX}${lines[index].trim()}`
  return [
    ...lines,
    '',
    `> ${VOID_MARKER}.`,
    '>',
    `> ${targets.length} line(s) that a verdict parser would have read as a decision (${decisions.join(', ')}) at this head were rewritten so that no tool can read them as a verdict. They were voided because the durable verdict artifact could not be recorded, so this comment authorizes nothing. Reason: ${sanitizeVoidReason(reason)}`,
    '>',
    "> The reviewer's findings are otherwise unchanged and remain readable as evidence. A real decision requires a fresh governed review that records a create-only verdict artifact."
  ].join('\n')
}
// A wrapper may speak its own verdict grammar. `ai-gemini` normally asks Gemini
// to OPEN its reply with a `## Verdict` heading and a bare decision word, which
// this runner voids as a stray decision line, and it prints a PASS summary line
// instead of the review. Its `--governed-verdict <head>` mode switches both the
// prompt contract and its own verdict gate to the terminal
// `VERDICT: <DECISION> <head>` line this runner records, and emits the review on
// standard output. The caller must not have to remember that, and a caller that
// passes the wrong head must not be silently accepted, so the flag is injected
// here from the head this review is actually recording against.
export function wrapperBaseName(wrapper){
  return String(wrapper??'').split(/[\\/]/).pop().replace(/\.(cmd|bat|exe)$/i,'').toLowerCase()
}

// Source authority is the live PR, never a caller's remembered branch name.
// No fetch, ref update, lease change, or provider invocation happens here.
function readReviewSourceDigest(worktree){
  const executable=resolveCommandPath('ai-review-sandbox')
  if(!executable)throw new Error('trusted review source digest tool is unavailable')
  const plan=wrapperSpawnPlan(executable,['digest',worktree])
  const result=spawnSync(plan.file,plan.args,{cwd:worktree,encoding:'utf8',maxBuffer:64*1024,stdio:['ignore','pipe','pipe']})
  if(result.error||result.status!==0)throw new Error('trusted review source digest is unavailable')
  return String(result.stdout??'').trim()
}
function readGitHub(args){
  try{return {status:0,stdout:runGitHubCommand(args,{executor:execFileSync})}}
  catch(error){return {status:1,error,stderr:String(error?.stderr??'')}}
}
export function resolveReviewSource(options,{git=spawnSync,github=readGitHub,digest=readReviewSourceDigest}={}){
  if(!Number.isSafeInteger(Number(options.pr))||Number(options.pr)<1)throw new Error('source identity requires a pull request number')
  const head=String(options.headSha??'').toLowerCase()
  if(!/^[0-9a-f]{40}$/.test(head)||!options.worktree)throw new Error('source identity requires an exact head and worktree')
  const response=github(['api',`repos/${REPO}/pulls/${Number(options.pr)}`])
  if(response.error||response.status!==0)throw new Error('could not resolve live pull request source identity')
  let pr
  try{pr=JSON.parse(response.stdout)}catch{throw new Error('live pull request source identity is unreadable')}
  if(pr.state!=='open'||pr.merged||pr.number!==Number(options.pr)||pr.base?.repo?.full_name?.toLowerCase()!==REPO.toLowerCase())throw new Error('pull request source repository or state does not match this review')
  const target=String(pr.base?.sha??'').toLowerCase(),baseRef=String(pr.base?.ref??'')
  if(pr.head?.sha?.toLowerCase()!==head)throw new Error('live pull request head differs from the assigned review head')
  if(!/^[0-9a-f]{40}$/.test(target)||!baseRef)throw new Error('live pull request target is missing or invalid')
  const local=(args)=>{
    const result=git('git',['-C',options.worktree,...args],{encoding:'utf8',maxBuffer:4*1024*1024})
    if(result.error||result.status!==0)throw new Error('local source identity is unavailable; fetch the exact PR target and head before review')
    return String(result.stdout??'').trim()
  }
  const remote=local(['remote','get-url','origin']).replace(/\\/g,'/').replace(/\.git\/?$/i,'').replace(/\/$/,'').toLowerCase()
    .replace(/^git@([^:]+):/,'ssh://$1/').replace(/^ssh:\/\/git@/,'ssh://')
  if(![`https://github.com/${REPO}`,`ssh://github.com/${REPO}`].map((x)=>x.toLowerCase()).includes(remote))throw new Error('review worktree origin is not the pull request repository')
  if(local(['rev-parse','--verify','HEAD^{commit}']).toLowerCase()!==head)throw new Error('local review head differs from the assigned review head')
  if(local(['status','--porcelain']))throw new Error('review source worktree is dirty')
  local(['cat-file','-e',`${target}^{commit}`])
  const mergeBase=local(['merge-base','--all',target,head]).toLowerCase()
  if(!/^[0-9a-f]{40}$/.test(mergeBase))throw new Error('review source has no unique merge-base')
  const compared=github(['api',`repos/${REPO}/compare/${mergeBase}...${head}`])
  if(compared.error||compared.status!==0)throw new Error('could not resolve exact pull request changed files')
  let comparison
  try{comparison=JSON.parse(compared.stdout)}catch{throw new Error('exact pull request changed files are unreadable')}
  if(comparison.base_commit?.sha!==mergeBase||comparison.merge_base_commit?.sha!==mergeBase||!Array.isArray(comparison.files)||comparison.files.length>=300)throw new Error('exact pull request file comparison is missing, mismatched, or truncated')
  const statuses={A:'added',M:'modified',D:'removed',R:'renamed',C:'copied',T:'changed'},localFiles=[]
  const fields=local(['diff','--name-status','-z','--find-renames',mergeBase,head]).split('\0')
  if(fields.pop()!=='')throw new Error('local changed-file comparison is truncated')
  while(fields.length){
    const code=fields.shift(),status=statuses[code?.[0]],previous=fields.shift()
    if(!status||!previous)throw new Error('local changed-file comparison is malformed')
    const filename=['renamed','copied'].includes(status)?fields.shift():previous
    if(!filename)throw new Error('local changed-file comparison is truncated')
    localFiles.push({filename,status,...(['renamed','copied'].includes(status)?{previous_filename:previous}:{})})
  }
  const normalize=(files)=>{
    const seen=new Set()
    return files.map((file)=>{
      if(typeof file?.filename!=='string'||!file.filename||file.filename.includes('\0')||!Object.values(statuses).includes(file.status)||seen.has(file.filename))throw new Error('exact changed-file manifest is malformed')
      seen.add(file.filename)
      const renamed=['renamed','copied'].includes(file.status)
      if(renamed&&(typeof file.previous_filename!=='string'||!file.previous_filename||file.previous_filename.includes('\0')))throw new Error('exact changed-file manifest is missing rename evidence')
      return {filename:file.filename,status:file.status,...(renamed?{previous_filename:file.previous_filename}:{})}
    }).sort((a,b)=>a.filename<b.filename?-1:a.filename>b.filename?1:0)
  }
  const files=normalize(comparison.files),encoded=JSON.stringify(files)
  if(encoded!==JSON.stringify(normalize(localFiles)))throw new Error('local changed-file manifest differs from exact GitHub comparison')
  const sourceDigest=digest(options.worktree)
  if(!/^[0-9a-f]{64}$/.test(sourceDigest))throw new Error('trusted review source digest is malformed')
  return {repository:REPO,pr:Number(options.pr),baseRef,targetSha:target,headSha:head,mergeBase,files,fileSetSha256:createHash('sha256').update(encoded).digest('hex'),sourceDigest}
}

const SOURCE_WRAPPERS=new Set(['ai-claude-review','ai-codex-review','ai-deepseek-agent','ai-gemini','ai-glm','ai-grok-review','ai-kimi','ai-muse','ai-qwen'])
const OPAQUE_VALUE_OPTIONS=new Set(['--prompt','--prompt-file','--decision','--tests','--system','--file','--model','--timeout','--review-kind','--governed-verdict'])
function canonicalSourcePath(value,platform=process.platform){
  let path=String(value)
  if(platform==='win32')path=path.replace(/\\/g,'/').replace(/^\/([a-z])\//i,'$1:/').toLowerCase()
  path=path.replace(/\/$/,'')
  return path
}
function physicalSourcePath(value,{realpath=realpathSync.native,lstat=lstatSync,platform=process.platform}={}){
  if(typeof value!=='string'||!value)throw new Error('wrapper source receipt repository is unavailable or unsafe')
  const path=platform==='win32'?value.replace(/^\/([a-z])\//i,'$1:/'):value
  try{
    const stat=lstat(path)
    if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('unsafe repository')
    return canonicalSourcePath(realpath(path),platform)
  }catch{throw new Error('wrapper source receipt repository is unavailable or unsafe')}
}
export function reserveReviewReceipt(options,{git=spawnSync}={}){
  const root=realpathSync(options.worktree)
  const ensureDirectory=(path)=>{
    try{mkdirSync(path,{mode:0o700})}catch(error){if(error.code!=='EEXIST')throw error}
    const stat=lstatSync(path)
    if(stat.isSymbolicLink()||!stat.isDirectory()||canonicalSourcePath(realpathSync(path))!==canonicalSourcePath(resolvePath(path)))throw new Error('source receipt directory is linked or unsafe')
  }
  ensureDirectory(join(root,'.ai'));ensureDirectory(join(root,'.ai','reviews'))
  const path=join(root,'.ai','reviews',`governed-source-${randomUUID()}.json`),bindingPath=`${path}.binding.json`
  const guarded=()=>{
    ensureDirectory(join(root,'.ai'));ensureDirectory(join(root,'.ai','reviews'))
    for(const file of [path,bindingPath]){
      const ignored=git('git',['-C',root,'check-ignore','--no-index','-q','--',file],{encoding:'utf8'})
      const tracked=git('git',['-C',root,'ls-files','--error-unmatch','--',file],{encoding:'utf8'})
      if(ignored.error||ignored.status!==0||tracked.error||tracked.status!==1)throw new Error('source receipt destination is not private untracked evidence')
    }
  }
  guarded()
  for(const file of [path,bindingPath]){try{lstatSync(file);throw new Error('source receipt destination already exists')}catch(error){if(error.code!=='ENOENT')throw error}}
  return {path,read(){
    guarded()
    const stat=lstatSync(path)
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)throw new Error('source receipt is not a bounded regular file')
    return JSON.parse(readFileSync(path,'utf8'))
  },bind(sourceEvidence){guarded();writeFileSync(bindingPath,`${JSON.stringify(sourceEvidence,null,2)}\n`,{flag:'wx',mode:0o600});return bindingPath}}
}
export function validateSourceReceipt(receipt,source,worktree,pathOptions){
  if(receipt?.schema_version!==1||!/^[0-9a-f]{64}$/.test(receipt.packet_sha256??''))throw new Error('wrapper source receipt is missing a complete packet digest')
  const identity=receipt.identity
  if(identity?.head!==source.headSha||identity?.base!==source.mergeBase||physicalSourcePath(identity?.repository,pathOptions)!==physicalSourcePath(worktree,pathOptions)||!/^[0-9a-f]{64}$/.test(identity?.source_digest??'')||identity.source_digest!==source.sourceDigest)throw new Error('wrapper source receipt differs from trusted PR source')
  return {...source,packetSha256:receipt.packet_sha256,sourceDigest:identity.source_digest}
}
export function wrapperSourceContractArgs(wrapper,args,source){
  if(!SOURCE_WRAPPERS.has(wrapperBaseName(wrapper)))throw new Error('review wrapper has no qualified source identity contract')
  if(wrapperBaseName(wrapper)==='ai-deepseek-agent'){
    let formal=false
    for(let i=1;i<args.length;i++){
      if(OPAQUE_VALUE_OPTIONS.has(args[i])){i++;continue}
      if(args[i]==='--review')formal=true
    }
    if(!['send','reply'].includes(args[0])||!formal)throw new Error('governed DeepSeek requires a formal send or reply with --review')
  }
  const expected={'--base':source.mergeBase,'--assert-head':source.headSha},seen=new Set(),out=[]
  for(let i=0;i<args.length;i++){
    const token=String(args[i]),key=token.split('=')[0]
    if(Object.hasOwn(expected,key)){
      const value=token.includes('=')?token.slice(key.length+1):String(args[++i]??'')
      if(seen.has(key))throw new Error(`duplicate wrapper ${key} source option`)
      if(value.toLowerCase()!==expected[key])throw new Error(`wrapper ${key} does not match the trusted pull request source`)
      seen.add(key)
      continue
    }
    out.push(args[i])
    if(OPAQUE_VALUE_OPTIONS.has(token)&&i+1<args.length)out.push(args[++i])
  }
  return [...out,'--base',source.mergeBase,'--assert-head',source.headSha]
}

// `ai-codex-review` (issue #2244) speaks a verdict grammar this runner cannot
// record and CANNOT BE TALKED OUT OF IT: it takes no prompt argument, so there is
// no way to hand it the runner's output contract the way `--governed-verdict`
// does for `ai-gemini`. What it does do is publish a complete report to
// `.ai/reviews/codex-<mode>-<runid>.md` and print THAT PATH as its final line of
// standard output. The report carries the reviewer's whole findings under a
// `## Result` heading and closes with the wrapper's own final two-line
// `## Verdict` / `<APPROVE|REJECT|BLOCKED>` section.
//
// So the bridge is TRANSCRIPTION, not relaxation. Nothing about the runner's own
// rules moves: the recorded verdict is still the single terminal
// `VERDICT: <DECISION> <head>` line, the head still comes ONLY from
// `options.headSha` and never from reviewer text, the transcribed findings still
// go through `extraVerdictLines` before anything is posted, and the auto-void
// path is untouched. Two checks are ADDED rather than removed: the report must
// declare the same reviewed commit the runner is recording against, and the path
// the wrapper printed must have the wrapper's own published shape.
export const CODEX_WRAPPER='ai-codex-review'
export const CODEX_REPORT_BASENAME=/^codex-[a-z][a-z-]*-\d{8}T\d{6}-\d+-\d+\.md$/

// The path is READ FROM WRAPPER OUTPUT, so it is untrusted: it selects a file this
// process will read. Only the wrapper's own published shape is accepted -- a
// `.ai/reviews/` parent and a `codex-<mode>-<runid>.md` basename -- so a mangled
// or injected line cannot point the runner at an arbitrary file.
export function codexReportPath(stdout){
  const lines=String(stdout??'').split(/\r?\n/).map((line)=>line.trim()).filter(Boolean)
  const candidate=lines.at(-1)
  if(!candidate)throw new Error('the codex wrapper printed no report path')
  const parts=candidate.replace(/\\/g,'/').split('/')
  const base=parts.pop()??''
  if(!CODEX_REPORT_BASENAME.test(base))throw new Error('the codex wrapper final line is not a published report path')
  if(parts.slice(-2).join('/').toLowerCase()!=='.ai/reviews')throw new Error('the codex report path is not inside the wrapper report directory')
  return candidate
}

// Turns one published codex report into a body this runner can record. It THROWS
// rather than guessing whenever the report is not the exact shape the wrapper
// publishes, so a partial or unexpected report refuses the round instead of
// producing a verdict nobody wrote.
export function codexGovernedBody(report,headSha,reportName='the codex report'){
  const head=String(headSha??'').toLowerCase()
  if(!/^[0-9a-f]{40}$/.test(head))throw new Error('the head under review is not a commit sha')
  const lines=String(report??'').split(/\r?\n/).map((line)=>line.replace(/\s+$/,''))
  // The head binding NEVER comes from the report. This check only REFUSES a report
  // that reviewed a different commit than the one being recorded against; it can
  // never supply the head.
  const reviewed=lines.map((line)=>/^\|\s*reviewed commit\s*\|\s*`?([0-9a-f]{40})`?\s*\|$/i.exec(line)).find(Boolean)
  if(!reviewed)throw new Error('the codex report does not declare the commit it reviewed')
  if(reviewed[1].toLowerCase()!==head)throw new Error('the codex report reviewed a different commit than the head under review')
  const headings=lines.map((line,index)=>index).filter((index)=>/^##\s*Verdict$/i.test(lines[index]))
  if(headings.length!==1)throw new Error('the codex report does not carry exactly one verdict section')
  const heading=headings[0]
  const decision=(lines.slice(heading+1).find((line)=>line.trim())??'').trim().toUpperCase()
  if(decision==='BLOCKED')throw new Error('the codex reviewer returned BLOCKED, which is not a recordable decision')
  if(!['APPROVE','REJECT'].includes(decision))throw new Error('the codex verdict section does not carry a recordable decision')
  // `## Result` is written by the wrapper immediately before the provider text, so
  // the FIRST occurrence is always the wrapper's own heading and a reviewer who
  // happens to write the same heading cannot destroy its own review.
  const result=lines.findIndex((line)=>/^##\s*Result$/i.test(line))
  if(result<0)throw new Error('the codex report does not carry a result section')
  const findings=lines.slice(result+1,heading).join('\n').trim()
  if(!findings)throw new Error('the codex report carries no findings to record')
  // Only the findings are carried over. The wrapper's header table is left behind
  // on purpose: its `source digest` is a 64-character hex value whose first 40
  // characters read as a foreign commit sha to `unambiguouslyTiedToHead`, which
  // would make the posted comment ambiguous about the head it belongs to.
  return `Transcribed from the codex wrapper report ${reportName}, which declares the same reviewed commit as the head under review. The wrapper publishes its decision as a two-line \`## Verdict\` section carrying no head; this runner restates that decision as its own terminal verdict line, bound to the head it pinned.\n\n${findings}\n\nVERDICT: ${decision} ${head}`
}

export function wrapperVerdictContractArgs(wrapper,args,headSha){
  const name=wrapperBaseName(wrapper)
  if(!['ai-gemini','ai-qwen','ai-deepseek-agent'].includes(name))return args
  const list=[...args],head=String(headSha??'').toLowerCase()
  // EVERY spelling of the flag is checked, not the first one found: `--x value`,
  // `--x=value`, and a repeat later in the argument list. A single unchecked
  // occurrence would let a caller bind the wrapper's verdict grammar to a head
  // this review is not recording against.
  let supplied=false
  for(let i=0;i<list.length;i+=1){
    const token=String(list[i]??'')
    let value=null
    if(token==='--governed-verdict')value=String(list[i+1]??'')
    else if(token.startsWith('--governed-verdict='))value=token.slice('--governed-verdict='.length)
    else continue
    if(value.toLowerCase()!==head)throw new Error('the wrapper --governed-verdict head does not match the head under review')
    supplied=true
  }
  if(supplied)return list
  const commands=name==='ai-deepseek-agent'?['send','reply']:['new','ask']
  if(!commands.includes(String(list[0]??'')))throw new Error(`${name} governed reviews must start with the ${commands.join(' or ')} subcommand`)
  list.splice(name==='ai-deepseek-agent'&&list[0]==='reply'?2:1,0,'--governed-verdict',String(headSha))
  return list
}
export function wrapperSpawnPlan(resolved,args,platform=process.platform){
  if(platform==='win32'&&/\.(cmd|bat)$/i.test(resolved))return{file:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',resolved,...args]}
  return{file:resolved,args}
}
// Provider diagnostics may contain credentials or private repository text. Only
// fixed, recognized reasons cross into the refusal; never echo raw stderr.
export function wrapperFailureReason(run){
  const stderr=String(run.stderr??'')
  const reasons=[]
  const hasReason=(reason)=>new RegExp(`(?:^|[^A-Za-z0-9_-])${reason}(?=$|[^A-Za-z0-9_-])`,'i').test(stderr)
  if(run.error)reasons.push('the wrapper process could not complete')
  if(run.signal)reasons.push('the wrapper process was terminated by a signal')
  if(/unknown option/i.test(stderr))reasons.push('the wrapper rejected an unsupported option; check its --help')
  if(hasReason('turn_limit_cancelled'))reasons.push('turn_limit_cancelled: the provider exhausted its declared turn budget')
  else if(hasReason('provider_cancelled')||/cancelled without a final answer/i.test(stderr))reasons.push('provider_cancelled: the provider cancelled without a final answer')
  if(hasReason('unknown_terminal_reason'))reasons.push('unknown_terminal_reason: the provider returned an unrecognized terminal state')
  if(hasReason('start_failed')){
    reasons.push(hasReason('caller_identity_missing')||hasReason('invalid_caller_identity')
      ?'start_failed: the wrapper caller identity is missing or invalid'
      :'start_failed: the wrapper refused before the provider turn started')
  }
  if(/timed-out|timed out|deadline|time limit/i.test(stderr))reasons.push('the wrapper reported a timeout')
  if(/local_dependency_unavailable/i.test(stderr))reasons.push('a local reviewer dependency is unavailable')
  if(/execution-context-denied/i.test(stderr))reasons.push('the wrapper reported execution-context-denied')
  if(hasReason('content-filter')||hasReason('DataInspectionFailed'))reasons.push('provider_unavailable: content-filter rejected the request')
  else if(hasReason('provider-unavailable'))reasons.push('provider_unavailable: the provider refused the request')
  if(/usage-limit|insufficient.quota|quota exceeded|usage limit/i.test(stderr))reasons.push('the wrapper reported a usage limit')
  if(/already active|already in progress|held for reconciliation|retained/i.test(stderr))reasons.push('the wrapper reported retained or active work; inspect that exact session')
  return reasons.join('; ')||(stderr?'wrapper stderr was present but its reason was not recognized; inspect the exact wrapper session':'the wrapper supplied no recognized diagnostic')
}
// ISSUE #2729 STEP 7 -- RETRY ONCE, THEN REROUTE, DECIDED BY THE LIFECYCLE.
// The manager's preflight throws `doctor did not answer within 60s` when the local
// reviewer service hangs. That says nothing about the provider, so the SAME reviewer
// is retried once (after an optional local repair hook). A second timeout is handed
// to `reviewerStartDecision`, which returns a governed return-and-reroute. A wrapper
// that ends with a recognised non-verdict terminal (turn_limit_cancelled) is also
// handed over: the assignment is finished without a verdict and may be replaced at
// the same head. The runner never draws or releases a reviewer itself; it attaches
// the decision to its refusal so the lane manager can act on it.
export const DOCTOR_TIMEOUT=/doctor did not answer within/i
export class GovernedReviewRerouteError extends Error{
  constructor(message,{startDecision,lifecycle}){super(message);this.name='GovernedReviewRerouteError';this.startDecision=startDecision;this.lifecycle=lifecycle}
}
export function reviewAssignmentIdentity(options){
  const head=String(options.headSha??'').toLowerCase()
  return {id:String(options.assignmentId??`review-${Number(options.issue)}-${Number(options.pr)}-slot${Number(options.slot??1)}-${head.slice(0,12)}`),head_sha:head}
}
const nowOf=(deps)=>(deps.now??(()=>new Date().toISOString()))()
function lifecycleEvent(deps,assignment,type,extra={}){
  const event={assignment_id:assignment.id,type,at:nowOf(deps),source:'governed-review-runner',...extra}
  deps.appendLifecycle?.(event)
  return event
}
function startDecisionFor(assignment,lifecycle,deps){
  const at=nowOf(deps)
  return reviewerStartDecision({...assignment,assigned_at:at},{now:at,provider_state:'confirmed-not-started',lifecycle})
}
export function preflightWithTimeoutRetry(args,assignment,deps,lifecycle=[]){
  for(;;){
    try{deps.preflight(args);return lifecycle}
    catch(error){
      if(!DOCTOR_TIMEOUT.test(String(error?.message??'')))throw error
      lifecycle.push(lifecycleEvent(deps,assignment,'preflight_timeout'))
      const decision=startDecisionFor(assignment,lifecycle,deps)
      if(decision.action==='retry-same-reviewer'){deps.repairLocalService?.(args);continue}
      const count=lifecycle.filter((e)=>e.type==='preflight_timeout').length
      throw new GovernedReviewRerouteError(`reviewer preflight timed out ${count} times at ${assignment.head_sha}; the same reviewer was retried once and this assignment must now be returned and rerouted (${sanitizeVoidReason(error.message)})`,{startDecision:decision,lifecycle:[...lifecycle]})
    }
  }
}
export function runGovernedReview(options,deps={spawn:spawnSync,preflight:reviewerExecutionPreflight,record:recordReviewVerdict,resolve:resolveCommandPath,readReport:(path)=>readFileSync(path,'utf8')}){
  const resolveSource=deps.sourceResolver??resolveReviewSource
  const sourceIdentity=resolveSource(options)
  const wrapperArgs=wrapperSourceContractArgs(options.wrapper,wrapperVerdictContractArgs(options.wrapper,options.wrapperArgs,options.headSha),sourceIdentity)
  const skipDoctor=options.skipDoctor===true||options.skipDoctor==='true'
  const assignment=reviewAssignmentIdentity(options),lifecycle=[]
  preflightWithTimeoutRetry({reviewer:options.reviewer,wrapper:options.wrapper,worktree:options.worktree,headSha:options.headSha,skipDoctor},assignment,deps,lifecycle)
  const resolved=(deps.resolve??resolveCommandPath)(options.wrapper)
  if(!resolved)throw new Error(`review wrapper ${options.wrapper} is not executable`)
  const receipt=(deps.receiptFactory??reserveReviewReceipt)(options)
  const plan=wrapperSpawnPlan(resolved,wrapperArgs)
  const run=deps.spawn(plan.file,plan.args,{cwd:options.worktree,env:{...process.env,AI_REVIEW_SOURCE_RECEIPT_FILE:receipt.path},encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']})
  let rawBody=String(run.stdout??'').trim()
  // Issue #2244: the codex wrapper's verdict lives in its published report, not on
  // standard output. Transcribe it into this runner's grammar BEFORE parsing, and
  // only for a run that actually succeeded -- a failed run keeps the ordinary
  // refusal, so a stale report left by an earlier run can never be picked up.
  if(!run.error&&run.status===0&&wrapperBaseName(options.wrapper)===CODEX_WRAPPER){
    try{
      const path=codexReportPath(rawBody)
      const read=deps.readReport??((file)=>readFileSync(file,'utf8'))
      rawBody=codexGovernedBody(read(path),options.headSha,path.replace(/\\/g,'/').split('/').pop())
    }catch(error){throw new Error(`review wrapper did not produce a recordable terminal verdict (exit ${run.status??'unknown'}): ${sanitizeVoidReason(error.message)}`)}
  }
  const verdict=verdictFromOutput(rawBody,options.headSha)
  if(run.error||run.status!==0||!verdict){
    const reason=wrapperFailureReason(run),message=`review wrapper did not produce a recordable terminal verdict (exit ${run.status??'unknown'}): ${reason}`
    const terminal=NON_VERDICT_TERMINAL_REASONS.find((code)=>reason.split('; ').some((part)=>part.startsWith(`${code}:`)))
    if(terminal){
      lifecycle.push(lifecycleEvent(deps,assignment,'terminal_non_verdict',{reason:terminal,head_sha:assignment.head_sha}))
      throw new GovernedReviewRerouteError(`${message}; this is a terminal non-verdict, so the assignment is eligible for a same-head replacement`,{startDecision:startDecisionFor(assignment,lifecycle,deps),lifecycle:[...lifecycle]})
    }
    throw new Error(message)
  }
  if(JSON.stringify(resolveSource(options))!==JSON.stringify(sourceIdentity))throw new Error('pull request source changed during review; no verdict was published or recorded')
  const sourceEvidence=validateSourceReceipt(receipt.read(),sourceIdentity,options.worktree,deps.sourcePathOptions)
  sourceEvidence.receiptPath=receipt.path
  sourceEvidence.bindingPath=receipt.bind(sourceEvidence)
  // CLOSE THE ORDERING HOLE AT THE ONLY POINT WHERE IT CAN BE CLOSED.
  // Recording BEFORE posting is impossible: `recordReviewVerdict` binds the
  // artifact to `findings_ref` (a durable comment URL on this exact PR) and to
  // `findings_digest` (the sha256 of that comment's body), and validates both.
  // The artifact cannot exist until the comment does. So the comment is made as
  // harmless as possible BEFORE it is posted instead: any line beyond the single
  // terminal verdict line that a downstream parser would read as a decision is
  // refused here, while nothing has been written to GitHub yet.
  const extra=extraVerdictLines(rawBody)
  if(extra.length){
    // PRESERVE THE FINDINGS, AUTHORIZE NOTHING (issue #2207).
    //
    // This round can never produce a verdict: a body carrying a second parseable
    // decision line is exactly the shape that deadlocks a pull request (#2075), and
    // that judgement is NOT relaxed here. What changed is the DISPOSAL. Throwing the
    // whole review away also destroyed findings that were correct and expensive --
    // the reviewer slot was already spent, the lease was already held, and the only
    // surviving copy was in the wrapper's own transcript, outside the governed path.
    //
    // So the findings are posted with EVERY parseable decision line voided by the
    // same routine the post-record failure path uses, and no verdict artifact is
    // recorded. The round still fails; it just no longer fails silently.
    //
    // FAIL CLOSED. The EXACT BYTES THAT WILL BE POSTED -- header and voided body
    // together, not the voided body alone -- are proved inert against all three
    // readers BEFORE anything reaches GitHub: the runner's own parser, the consumer
    // predicate the lanes and the merge gate use, and the scan that rejected the body
    // in the first place. Proving the voided body alone would have left the header
    // outside the proof, so a later edit to the header, or a widening of the verdict
    // word set to match it, could make the composite readable while the proved part
    // stayed inert (external review, muse-spark-1.2, PR #2298). If any proof fails,
    // nothing is posted and the original refusal stands unchanged.
    //
    // HONEST ABOUT THE TRADE. Posting nothing was an unconditional guarantee; this is
    // a checked one, and a check can rot. It holds only while `neutraliseVerdictLine`
    // stays aligned with every reader, and an already-posted comment cannot be voided
    // again later. Two things bound that: the proofs import the LIVE predicates rather
    // than re-deriving them, so they move together; and authorization now comes from a
    // create-only durable ref, so even a misread comment cannot authorize a merge.
    // What is traded is a hard property for a checked one. What is bought is that an
    // expensive, correct review is no longer destroyed by its own wording.
    const reason=`the findings carry ${extra.length} line(s) a verdict parser would read as a decision besides the terminal verdict line`
    const detail=`review findings carry ${extra.length} line(s) a downstream verdict parser would read as a decision besides the terminal verdict line (first: ${JSON.stringify(extra[0].trim().slice(0,120))}); no verdict was recorded`
    let preserved=null
    try{
      const edited=neutraliseVerdictLine(rawBody,reason)
      if(edited===null)throw new Error('carried no line to void')
      const candidate=`${PRESERVED_HEADER}\n\n${edited}`
      if(extraVerdictLines(candidate).length)throw new Error('a decision line survived the void')
      if(verdictFromOutput(candidate,options.headSha)!==null)throw new Error('the body to be posted is still read as a verdict by the runner')
      if(isVerdictFor({author_association:'OWNER',body:candidate},options.headSha))throw new Error('the body to be posted is still read as a verdict by the shared consumer predicate')
      preserved=candidate
    }catch{preserved=null}
    if(preserved===null)throw new Error(`${detail}; nothing was posted because the findings could not be made inert`)
    const kept=spawnGitHub(['api','-X','POST',`repos/u2giants/shared-db/issues/${options.pr}/comments`,'--input','-'],{executor:deps.spawn,input:JSON.stringify({body:preserved})})
    if(kept.error||kept.status!==0)throw new Error(`${detail}; the findings could not be preserved durably either`)
    let keptUrl=null
    try{keptUrl=JSON.parse(kept.stdout).html_url}catch{keptUrl=null}
    throw new Error(`${detail}; the findings were preserved as a non-authorizing comment${keptUrl?` (${keptUrl})`:''} and this head needs a fresh governed review`)
  }
  const preflightNote=skipDoctor?'REVIEW PREFLIGHT: automated doctor skipped; the caller must retain the fresh external doctor proof that justified this exception.\n\n':''
  const body=`GOVERNED REVIEW FINDINGS — NON-AUTHORIZING UNLESS THE MATCHING CREATE-ONLY VERDICT ARTIFACT EXISTS\n\n${preflightNote}${rawBody}`
  const posted=spawnGitHub(['api','-X','POST',`repos/u2giants/shared-db/issues/${options.pr}/comments`,'--input','-'],{executor:deps.spawn,input:JSON.stringify({body})})
  if(posted.error||posted.status!==0)throw new Error('review findings could not be posted durably; no verdict was recorded')
  let comment
  try{comment=JSON.parse(posted.stdout)}catch{throw new Error('durable findings response was unreadable; no verdict was recorded')}
  let artifact
  try{artifact=deps.record({...options,sourceIdentity,sourceEvidence,verdict,findingsRef:comment.html_url,replacementSequence:options.replacementSequence??null})}
  catch(error){
    // DEFENCE IN DEPTH, NOT THE FIX. The cause of issue #2075 was that the lane
    // tooling read a decision word in comment PROSE as a verdict; that is now
    // repaired at the readers (hasVerdictForHead reads the create-only durable
    // artifact). This void still runs, because a stale comment claiming a verdict
    // that was never recorded is misleading to humans and to any reader that has
    // not been converted. Every line a verdict parser would read as a decision is
    // rewritten -- not only the terminal one -- and the result is re-parsed with
    // the real consumer predicate before the void is called a success.
    // #2464. NEVER VOID AFTER THE ARTIFACT WAS CREATED.
    // `recordReviewVerdict` marks any failure that happens AFTER the create-only
    // ref landed. The artifact records `findings_digest` -- the sha256 of THIS
    // comment's body -- so voiding the comment permanently invalidates a verdict
    // that exists, is valid, and can never be rewritten, burning the whole
    // (issue, pr, head, slot) tuple. On PR #2409 that happened four rounds in a
    // row. The correct behaviour is to report loudly and STOP: the artifact and
    // the comment are both left exactly as they are, and a human decides.
    if(error.verdictArtifactCreated){
      // The marker also arrives UNCONFIRMED: the read that would have proved the
      // ref threw, so we cannot say the artifact exists -- only that it may. The
      // behaviour is identical either way, because voiding is irreversible and
      // not voiding is not, but the notice must not claim more than was proved.
      const {ref,sha,confirmed}=error.verdictArtifactCreated
      const state=confirmed===false?'MAY HAVE BEEN CREATED':'WAS CREATED AND IS LEFT INTACT'
      spawnGitHub(['api','-X','POST',`repos/u2giants/shared-db/issues/${options.pr}/comments`,'--input','-'],{executor:deps.spawn,input:JSON.stringify({body:`REVIEW RECORDING INCOMPLETE — THE DURABLE VERDICT ARTIFACT ${state}.

Artifact: \`${ref}\` = \`${sha}\`

The step AFTER the create failed: ${error.message}

The preceding findings comment (${comment.html_url}) has been left UNTOUCHED on purpose. Its body is what ${confirmed===false?'any artifact recorded by this round would have computed its findings_digest over, so editing it could permanently invalidate a verdict that may already exist':"the artifact's recorded findings_digest was computed over, so editing it would permanently invalidate a verdict that already exists"} and cannot be rewritten. Do not re-run this review at this head and do not edit that comment. Confirm the artifact with:

    gh api repos/u2giants/shared-db/git/ref/${ref.replace(/^refs\//,'')}
`})})
      throw new Error(`${error.message} — the durable verdict artifact ${ref} = ${sha} ${confirmed===false?'MAY have been created and could not be read back':'WAS created'}; the findings comment ${comment.id} was deliberately left untouched so ${confirmed===false?'any digest recorded over it stays valid':'its digest stays valid'}. Nothing was voided.`)
    }
    let voidStatus='voided'
    try{
      const edited=neutraliseVerdictLine(body,error.message)
      if(edited===null)throw new Error('the posted findings comment carried no line a verdict parser would read as a decision')
      // Prove the replacement against the REAL consumer predicate before calling
      // the void a success. A trusted association and the head SHA are assumed,
      // because the runner posts as a repository member and the body quotes the
      // head: those are exactly the conditions under which the lane tooling reads
      // a comment, so they are the conditions the void has to survive.
      if(isVerdictFor({author_association:'OWNER',body:edited},options.headSha))throw new Error('the neutralised body is still read as a verdict by the shared verdict predicate')
      const patch=spawnGitHub(['api','-X','PATCH',`repos/u2giants/shared-db/issues/comments/${comment.id}`,'--input','-'],{executor:deps.spawn,input:JSON.stringify({body:edited})})
      if(patch.error||patch.status!==0)throw new Error(`gh exited ${patch.status??'unknown'}${patch.error?` (${patch.error.message})`:''}`)
    }catch(voidError){voidStatus=`FAILED: ${voidError.message}`}
    const stillLive=voidStatus!=='voided'
    const note=stillLive
      ? `\n\nTHE VOIDING EDIT ITSELF ${voidStatus}. A PARSEABLE VERDICT LINE IS STILL LIVE ON COMMENT ${comment.id} (${comment.html_url}). Lane tooling will read it as a real verdict at ${options.headSha} and deadlock this pull request. That line must be neutralised BY HAND on comment ${comment.id} before this pull request can proceed.`
      : `\n\nEvery parseable verdict line on comment ${comment.id} was voided so no tool can read it as a verdict at ${options.headSha}. The reviewer's findings were left intact.`
    spawnGitHub(['api','-X','POST',`repos/u2giants/shared-db/issues/${options.pr}/comments`,'--input','-'],{executor:deps.spawn,input:JSON.stringify({body:`REVIEW RECORDING FAILED — the preceding findings comment is non-authorizing and no verdict artifact was recorded. Reason: ${error.message}${note}`})})
    if(stillLive)throw new Error(`${error.message} — and the voiding edit ${voidStatus}; a parseable verdict line is still live on comment ${comment.id} and must be neutralised by hand`)
    throw error
  }
  return {artifact,body,sourceIdentity,sourceEvidence}
}
// The lane CLI applies SHARED_DB_MERGED_PR_ISSUE_BINDING to its io; verdict recording
// here runs in-process, so it must see the same verified binding or it refuses a merged
// pull request that reviewer assignment accepted.
export function governedReviewDeps(env=process.env){
  const value=String(env.SHARED_DB_MERGED_PR_ISSUE_BINDING??'').trim()
  const io=value?withMergedPrIssueBinding(githubIo,value):githubIo
  return {spawn:spawnSync,preflight:(o)=>reviewerExecutionPreflight(o,io),record:(o)=>recordReviewVerdict(o,io),resolve:resolveCommandPath,readReport:(path)=>readFileSync(path,'utf8'),io}
}
export function main(argv=process.argv.slice(2)){
  try{const result=runGovernedReview(parseArgs(argv),governedReviewDeps());process.stdout.write(`${result.body}\n\nDURABLE VERDICT: ${result.artifact.ref} ${result.artifact.sha}\nSOURCE EVIDENCE: ${JSON.stringify(result.sourceEvidence)}\n`);return 0}catch(error){if(error?.startDecision)process.stderr.write(`REROUTE: ${JSON.stringify(error.startDecision)}\n`);process.stderr.write(`REFUSED: ${error.message}\n`);return 2}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)process.exitCode=main()
