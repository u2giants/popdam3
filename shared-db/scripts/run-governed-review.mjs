#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { recordReviewVerdict, reviewerExecutionPreflight, resolveCommandPath } from './manage-migration-author-lanes.mjs'
import { lineOpensWithVerdictWord, isVerdictFor } from './lib/review-verdict.mjs'

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
export function wrapperSpawnPlan(resolved,args,platform=process.platform){
  if(platform==='win32'&&/\.(cmd|bat)$/i.test(resolved))return{file:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',resolved,...args]}
  return{file:resolved,args}
}
export function runGovernedReview(options,deps={spawn:spawnSync,preflight:reviewerExecutionPreflight,record:recordReviewVerdict,resolve:resolveCommandPath}){
  deps.preflight({reviewer:options.reviewer,wrapper:options.wrapper,worktree:options.worktree,headSha:options.headSha})
  const resolved=(deps.resolve??resolveCommandPath)(options.wrapper)
  if(!resolved)throw new Error(`review wrapper ${options.wrapper} is not executable`)
  const plan=wrapperSpawnPlan(resolved,options.wrapperArgs)
  const run=deps.spawn(plan.file,plan.args,{cwd:options.worktree,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']})
  const rawBody=String(run.stdout??'').trim(),verdict=verdictFromOutput(rawBody,options.headSha)
  if(run.error||run.status!==0||!verdict)throw new Error(`review wrapper did not produce a recordable terminal verdict (exit ${run.status??'unknown'})`)
  // CLOSE THE ORDERING HOLE AT THE ONLY POINT WHERE IT CAN BE CLOSED.
  // Recording BEFORE posting is impossible: `recordReviewVerdict` binds the
  // artifact to `findings_ref` (a durable comment URL on this exact PR) and to
  // `findings_digest` (the sha256 of that comment's body), and validates both.
  // The artifact cannot exist until the comment does. So the comment is made as
  // harmless as possible BEFORE it is posted instead: any line beyond the single
  // terminal verdict line that a downstream parser would read as a decision is
  // refused here, while nothing has been written to GitHub yet.
  const extra=extraVerdictLines(rawBody)
  if(extra.length)throw new Error(`review findings carry ${extra.length} line(s) a downstream verdict parser would read as a decision besides the terminal verdict line (first: ${JSON.stringify(extra[0].trim().slice(0,120))}); nothing was posted and no verdict was recorded`)
  const body=`GOVERNED REVIEW FINDINGS — NON-AUTHORIZING UNLESS THE MATCHING CREATE-ONLY VERDICT ARTIFACT EXISTS\n\n${rawBody}`
  const posted=deps.spawn('gh',['api','-X','POST',`repos/u2giants/shared-db/issues/${options.pr}/comments`,'--input','-'],{encoding:'utf8',input:JSON.stringify({body}),maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']})
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
      const patch=deps.spawn('gh',['api','-X','PATCH',`repos/u2giants/shared-db/issues/comments/${comment.id}`,'--input','-'],{encoding:'utf8',input:JSON.stringify({body:edited}),maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']})
      if(patch.error||patch.status!==0)throw new Error(`gh exited ${patch.status??'unknown'}${patch.error?` (${patch.error.message})`:''}`)
    }catch(voidError){voidStatus=`FAILED: ${voidError.message}`}
    const stillLive=voidStatus!=='voided'
    const note=stillLive
      ? `\n\nTHE VOIDING EDIT ITSELF ${voidStatus}. A PARSEABLE VERDICT LINE IS STILL LIVE ON COMMENT ${comment.id} (${comment.html_url}). Lane tooling will read it as a real verdict at ${options.headSha} and deadlock this pull request. That line must be neutralised BY HAND on comment ${comment.id} before this pull request can proceed.`
      : `\n\nEvery parseable verdict line on comment ${comment.id} was voided so no tool can read it as a verdict at ${options.headSha}. The reviewer's findings were left intact.`
    deps.spawn('gh',['api','-X','POST',`repos/u2giants/shared-db/issues/${options.pr}/comments`,'--input','-'],{encoding:'utf8',input:JSON.stringify({body:`REVIEW RECORDING FAILED — the preceding findings comment is non-authorizing and no verdict artifact was recorded. Reason: ${error.message}${note}`}),maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']})
    if(stillLive)throw new Error(`${error.message} — and the voiding edit ${voidStatus}; a parseable verdict line is still live on comment ${comment.id} and must be neutralised by hand`)
    throw error
  }
  return {artifact,body}
}
export function main(argv=process.argv.slice(2)){
  try{const result=runGovernedReview(parseArgs(argv));process.stdout.write(`${result.body}\n\nDURABLE VERDICT: ${result.artifact.ref} ${result.artifact.sha}\n`);return 0}catch(error){process.stderr.write(`REFUSED: ${error.message}\n`);return 2}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)process.exitCode=main()
