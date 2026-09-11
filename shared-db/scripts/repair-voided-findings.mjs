#!/usr/bin/env node
// RECOVERY FOR A VERDICT ARTIFACT THIS TOOLING INVALIDATED ITSELF (issue #2464).
//
// `run-governed-review.mjs` used to react to a recording failure by rewriting the findings
// comment to void its decision lines -- even when the create-only verdict ref had ALREADY
// been created and had recorded the sha256 of those exact bytes. The rewrite changed the
// bytes, so `validateVerdictArtifact` could never match again; and because the ref is
// create-only, the tuple could never be re-recorded. Observed on PR #2461 slot 2 (artifact
// 43340d95) and PR #2415 (head 0fab4ace). The runner no longer does this. Tuples burned
// BEFORE that fix still exist, and their reviews were real, complete and paid for.
//
// This repairs exactly that, and nothing else. The void is a deterministic transform, so it
// is invertible: this un-voids the live comment and PROVES the restoration is correct by
// re-deriving the sha256 and requiring it to equal the digest the artifact already recorded.
// That digest is the artifact's own evidence, written before the damage -- it cannot be
// satisfied by a body this script invented. If the digest does not match, nothing is
// written and the refusal names what it compared.
//
// It asserts nothing on the operator's behalf. It does not create, move or delete a ref, it
// does not record a verdict, and it cannot manufacture one: it only restores bytes that the
// artifact already attests to.
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ghJson, spawnGitHub } from './lib/github-transport.mjs'
import { findingsDigest, parseVerdictCommit, parseVerdictRef } from './lib/review-verdict-artifact.mjs'
import { VOID_MARKER, VOID_LINE_PREFIX } from './run-governed-review.mjs'

export const REPO='u2giants/shared-db'

// The exact inverse of `neutraliseVerdictLine`: drop the appended void block, then strip the
// `> VOIDED REVIEWER LINE - ` prefix from every line that carries it. It is deliberately
// unforgiving -- a body that does not carry the marker, or that carries no voided line, is
// not a body this tool damaged, so it returns null rather than guessing.
export function unvoidFindingsBody(body){
  const lines=String(body??'').split(/\r?\n/)
  const marker=lines.findIndex((line)=>line.includes(VOID_MARKER))
  if(marker<1)return null
  const tail=lines.at(-1)??''
  if(!tail.startsWith('> The reviewer\'s findings are otherwise unchanged'))return null
  let cut=marker
  if(lines[cut-1]==='')cut-=1
  let restored=0
  const kept=lines.slice(0,cut).map((line)=>{
    if(!line.startsWith(VOID_LINE_PREFIX))return line
    restored+=1
    return line.slice(VOID_LINE_PREFIX.length)
  })
  if(!restored)return null
  return kept.join('\n')
}

export function commentIdFromFindingsRef(findingsRef){
  const match=/#issuecomment-(\d+)$/.exec(String(findingsRef??''))
  return match?Number(match[1]):null
}

export function repairVoidedFindings({ref,apply=false},io){
  if(!parseVerdictRef(ref))throw new Error('a verdict ref is required, for example refs/db-review-verdicts/2355-2415-<head>')
  const sha=io.readRef(ref)
  if(!sha)throw new Error(`no verdict artifact exists at ${ref}; there is nothing to repair`)
  const record=parseVerdictCommit(io.getCommit(sha))
  const commentId=commentIdFromFindingsRef(record.findings_ref)
  if(!commentId)throw new Error(`the artifact records an unusable findings_ref (${record.findings_ref})`)
  const live=io.readComment(commentId)
  if(typeof live!=='string')throw new Error(`findings comment ${commentId} could not be read`)
  const liveDigest=findingsDigest(live)
  if(liveDigest===record.findings_digest)return{status:'already-valid',ref,sha,commentId,digest:liveDigest}
  const restored=unvoidFindingsBody(live)
  if(restored===null)throw new Error(`findings comment ${commentId} does not carry the governed runner's void markers, so this is not the damage this tool repairs; live digest ${liveDigest}, artifact digest ${record.findings_digest}`)
  const restoredDigest=findingsDigest(restored)
  // THE PROOF. The artifact's digest was written before the damage and cannot be satisfied
  // by a body this script invented. Equality here means the restored bytes ARE the bytes the
  // reviewer produced and the artifact attests to.
  if(restoredDigest!==record.findings_digest)throw new Error(`un-voiding comment ${commentId} did not reproduce the digest the artifact recorded (restored ${restoredDigest}, artifact ${record.findings_digest}); nothing was written`)
  if(!apply)return{status:'repairable',ref,sha,commentId,restored,digest:restoredDigest}
  io.patchComment(commentId,restored)
  const after=findingsDigest(io.readComment(commentId))
  if(after!==record.findings_digest)throw new Error(`the repair was written but comment ${commentId} still reads ${after}, not ${record.findings_digest}`)
  return{status:'repaired',ref,sha,commentId,digest:after}
}

// THE GOVERNED TRANSPORT HAS TWO DOORS AND THEY ARE NOT INTERCHANGEABLE
// (glm-5.3, PR #2479). Reads go through `runGitHubCommand`/`ghJson`, which is the
// only door that retries a transient failure; `spawnGitHub` is the mutation door,
// it refuses a call with no request body outright, and it refuses ANY call with no
// executor. An earlier draft of this file sent all four calls through
// `spawnGitHub` with neither, so every one of them threw before reaching GitHub --
// and the fixture-injected tests could not see it, because they never touch this
// object. `githubIoCallShapes` below exists so a test can assert these shapes
// against the transport's own contract without making a network call.
// A read that fails is only "absent" when GitHub actually said 404. Every other
// failure -- rate limit, auth, network, DNS -- must surface, never be flattened
// into the same `null` that means "there is nothing there". This is the same rule
// the lanes script uses (`isConfirmedRefAbsence`): the literal status, not loose
// prose like "not found", which a transport-level error also contains.
const NOT_FOUND=/HTTP 404/i
export const githubIoCallShapes={
  readRef:(ref)=>({args:['api',`repos/${REPO}/git/ref/${String(ref).replace(/^refs\//,'')}`],read:true}),
  getCommit:(sha)=>({args:['api',`repos/${REPO}/git/commits/${sha}`],read:true}),
  readComment:(id)=>({args:['api',`repos/${REPO}/issues/comments/${id}`],read:true}),
  patchComment:(id)=>({args:['api','-X','PATCH',`repos/${REPO}/issues/comments/${id}`,'--input','-'],read:false}),
}

// The CLI's real IO object is built here so a test can build the SAME object with
// the transport doors and the process spawner injected. Asserting the call shapes
// alone was not enough: it left the wiring -- which door each call goes through,
// and whether the mutation call carries an executor and a body -- untested, which
// is exactly where the defect was (grok-4.6, PR #2479).
export function createGithubIo({ghJson:readDoor=ghJson,spawnGitHub:mutateDoor=spawnGitHub,spawner=spawnSync}={}){
  function readOrAbsent(call){
    try{return readDoor(call.args,{expectedFailure:NOT_FOUND})}
    catch(error){if(NOT_FOUND.test(String(error?.stderr??error?.message??'')))return null;throw error}
  }
  return {
    readRef(ref){return readOrAbsent(githubIoCallShapes.readRef(ref))?.object?.sha??null},
    getCommit(sha){
      const commit=readOrAbsent(githubIoCallShapes.getCommit(sha))
      if(!commit)throw new Error(`commit ${sha} could not be read`)
      return commit
    },
    readComment(id){return readOrAbsent(githubIoCallShapes.readComment(id))?.body??null},
    patchComment(id,body){
      const out=mutateDoor(githubIoCallShapes.patchComment(id).args,{executor:spawner,input:JSON.stringify({body})})
      if(out.status!==0)throw new Error(`comment ${id} could not be updated: ${String(out.stderr??'').trim()}`)
    },
  }
}
const githubIo=createGithubIo()

export function main(argv=process.argv.slice(2)){
  const ref=argv[argv.indexOf('--ref')+1]
  const apply=argv.includes('--apply')
  try{
    const result=repairVoidedFindings({ref,apply},githubIo)
    if(result.status==='already-valid')process.stdout.write(`ALREADY VALID: ${result.ref} matches comment ${result.commentId}; no repair is needed\n`)
    else if(result.status==='repairable')process.stdout.write(`REPAIRABLE: un-voiding comment ${result.commentId} reproduces the artifact digest ${result.digest}. Re-run with --apply to write it.\n`)
    else process.stdout.write(`REPAIRED: comment ${result.commentId} restored; ${result.ref} validates again at digest ${result.digest}\n`)
    return 0
  }catch(error){process.stderr.write(`REFUSED: ${error.message}\n`);return 2}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)process.exitCode=main()
