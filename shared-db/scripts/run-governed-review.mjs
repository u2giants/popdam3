#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { recordReviewVerdict, reviewerExecutionPreflight, resolveCommandPath } from './manage-migration-author-lanes.mjs'
import { lineOpensWithVerdictWord, isVerdictFor } from './lib/review-verdict.mjs'
// Issue #2342: one shared transport owns the never-replay-a-write policy.
import { spawnGitHub } from './lib/github-transport.mjs'

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
  if(!['ai-gemini','ai-qwen'].includes(name))return args
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
  if(!['new','ask'].includes(String(list[0]??'')))throw new Error(`${name} governed reviews must start with the new or ask subcommand`)
  list.splice(1,0,'--governed-verdict',String(headSha))
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
  if(run.error)reasons.push('the wrapper process could not complete')
  if(run.signal)reasons.push('the wrapper process was terminated by a signal')
  if(/unknown option/i.test(stderr))reasons.push('the wrapper rejected an unsupported option; check its --help')
  if(/cancelled without a final answer/i.test(stderr))reasons.push('the provider cancelled without a final answer')
  if(/timed-out|timed out|deadline|time limit/i.test(stderr))reasons.push('the wrapper reported a timeout')
  if(/local_dependency_unavailable/i.test(stderr))reasons.push('a local reviewer dependency is unavailable')
  if(/execution-context-denied/i.test(stderr))reasons.push('the wrapper reported execution-context-denied')
  if(/usage-limit|insufficient.quota|quota exceeded|usage limit/i.test(stderr))reasons.push('the wrapper reported a usage limit')
  if(/already active|already in progress|held for reconciliation|retained/i.test(stderr))reasons.push('the wrapper reported retained or active work; inspect that exact session')
  return reasons.join('; ')||(stderr?'wrapper stderr was present but its reason was not recognized; inspect the exact wrapper session':'the wrapper supplied no recognized diagnostic')
}
export function runGovernedReview(options,deps={spawn:spawnSync,preflight:reviewerExecutionPreflight,record:recordReviewVerdict,resolve:resolveCommandPath,readReport:(path)=>readFileSync(path,'utf8')}){
  const skipDoctor=options.skipDoctor===true||options.skipDoctor==='true'
  deps.preflight({reviewer:options.reviewer,wrapper:options.wrapper,worktree:options.worktree,headSha:options.headSha,skipDoctor})
  const resolved=(deps.resolve??resolveCommandPath)(options.wrapper)
  if(!resolved)throw new Error(`review wrapper ${options.wrapper} is not executable`)
  const plan=wrapperSpawnPlan(resolved,wrapperVerdictContractArgs(options.wrapper,options.wrapperArgs,options.headSha))
  const run=deps.spawn(plan.file,plan.args,{cwd:options.worktree,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']})
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
  if(run.error||run.status!==0||!verdict)throw new Error(`review wrapper did not produce a recordable terminal verdict (exit ${run.status??'unknown'}): ${wrapperFailureReason(run)}`)
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
  try{artifact=deps.record({...options,verdict,findingsRef:comment.html_url,replacementSequence:options.replacementSequence??null})}
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
  return {artifact,body}
}
export function main(argv=process.argv.slice(2)){
  try{const result=runGovernedReview(parseArgs(argv));process.stdout.write(`${result.body}\n\nDURABLE VERDICT: ${result.artifact.ref} ${result.artifact.sha}\n`);return 0}catch(error){process.stderr.write(`REFUSED: ${error.message}\n`);return 2}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)process.exitCode=main()
