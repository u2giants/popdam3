// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { execFileSync } from 'node:child_process'
import { LaneError } from './claims.mjs'

// A wrapper's doctor is a local probe; it must never hang a governed lane.
// An empty or unparseable override must NOT silently become 0 or NaN: Node treats
// both as "no timeout", so a hung doctor would hang the lane instead of being
// refused -- a silent failure produced by the very setting meant to prevent one.
export const REVIEWER_DOCTOR_TIMEOUT_MS = (()=>{
  const raw=process.env.REVIEWER_DOCTOR_TIMEOUT_MS
  if(raw===undefined||String(raw).trim()==='')return 60000
  const value=Number(raw)
  if(!Number.isFinite(value)||value<=0)throw new LaneError(`REVIEWER_DOCTOR_TIMEOUT_MS must be a positive number of milliseconds; got "${raw}". Left unchecked this disables the timeout and a hung doctor hangs a governed lane.`)
  return value
})()

// `ai-review-preflight usable` reconciles EVERY provider in one process (nine on
// edge-dev when measured; ten since stepfun joined on 2026-09-25, still well inside the floor). Spawned through the cmd.exe -> Git bash shim chain one pass measures
// ~39 s and has taken ~80 s under load, so sharing the single-doctor budget here
// cut the run off before the later providers reported and refused the whole draw
// with "cut off before reporting qwen". The single-doctor budget above stays
// tight -- a hung wrapper doctor must still fail fast -- while the aggregate gets
// room for every provider to answer. REVIEWER_DOCTOR_TIMEOUT_MS, when the
// operator raises it, still widens both; it never shrinks the aggregate below the
// floor that a real pass needs.
export const REVIEWER_PREFLIGHT_TIMEOUT_MS = (()=>{
  const raw=process.env.REVIEWER_PREFLIGHT_TIMEOUT_MS
  if(raw===undefined||String(raw).trim()==='')return Math.max(REVIEWER_DOCTOR_TIMEOUT_MS,240000)
  const value=Number(raw)
  if(!Number.isFinite(value)||value<=0)throw new LaneError(`REVIEWER_PREFLIGHT_TIMEOUT_MS must be a positive number of milliseconds; got "${raw}". Left unchecked this disables the timeout and a hung preflight hangs a governed lane.`)
  return value
})()

// Reviewer wrappers report checks in ONE OF TWO shapes, both real and both in
// use on edge-dev today:
//
//   leading   `PASS  <check>` / `FAIL  <check>`      ai-glm, ai-muse, ai-codex-review
//   trailing  `<check> : PASS|FAIL|OK (<detail>)`    ai-grok-review, ai-kimi
//
// Only the leading form was read until 2026-08-25, which meant a trailing-form
// FAIL scored as an unrecognized format and therefore as healthy. Return the
// names of the failing checks, in order, from either shape.
export function parseDoctorFailures(output=''){
  return String(output).split(/\r?\n/).map((line)=>{
    const leading=/^\s*FAIL\s+(.*\S)\s*$/.exec(line)
    if(leading)return leading[1]
    const trailing=/^\s*(\S(?:.*\S)?)\s+:\s*FAIL\b\s*(.*\S)?\s*$/.exec(line)
    return trailing?(trailing[2]?`${trailing[1]} ${trailing[2]}`:trailing[1]):null
  }).filter(Boolean)
}

// SILENCE IS NOT A PASS -- but an unfamiliar format is not a failure either.
//
// This runs only on a ZERO exit; a non-zero exit is refused by the caller before
// it gets here. Three cases, measured against the real wrappers on edge-dev:
//
//   ai-glm / ai-muse   print `PASS  <check>` / `FAIL  <check>` lines. A FAIL wins
//                      over any number of PASSes.
//   ai-codex-review    prints exactly one `PASS provider=codex ...` line. Same
//                      leading form, one check.
//   ai-grok-review     prints key/value lines and an `auth : OK` footer.
//   ai-kimi            prints the same trailing form, including real FAILs such
//                      as `preflight : FAIL (execution-context-denied)`.
//
//                      UNTIL 2026-08-25 BOTH OF THOSE SCORED AS "unrecognized",
//                      i.e. healthy-by-exit-status. That was tolerable while the
//                      trailing form belonged only to a wrapper that never
//                      printed FAIL; un-retiring ai-kimi, which does, made it a
//                      hole. parseDoctorFailures now reads the trailing form, and
//                      `<check> : PASS|OK` counts as a recognized pass here.
//                      Grok is still healthy on exit status when it prints
//                      neither -- refusing that would have blocked a healthy Grok
//                      on every review, the false local-fault diagnosis this whole
//                      mechanism exists to end.
//   unfamiliar output  when a wrapper answers with output in a format we do not
//                      recognise AND exits 0, its own exit status is its verdict;
//                      `format` records that we could not read the detail.
//   nothing at all     proves nothing. A wrapper that quietly stops reporting must
//                      never be read as healthy forever. Refused.
//
// Do not "tidy" the third case into a pass, and do not tighten the second one
// without first running `doctor` on every ACTIVE_REVIEWERS wrapper and pasting the
// output into the change. Both halves were established that way.
export function summarizeDoctorOutput(output=''){
  const failed=parseDoctorFailures(output)
  if(failed.length)return {ok:false,failingChecks:failed,format:'checks'}
  const passed=String(output).split(/\r?\n/).filter((line)=>/^\s*PASS\s+\S/.test(line)||/^\s*\S(?:.*\S)?\s+:\s*(?:PASS|OK)\b/.test(line)).length
  if(passed)return {ok:true,failingChecks:[],format:'checks'}
  if(String(output).trim())return {ok:true,failingChecks:[],format:'unrecognized'}
  return {ok:false,failingChecks:['doctor reported nothing at all; nothing was proved'],format:'silent'}
}

// How a resolved wrapper path is actually spawned. A Windows `.cmd`/`.bat` shim
// must go through the command interpreter; everything else is executed directly.
// Kept separate from the spawn so the rule can be tested for both platforms on
// either platform.
// ISSUE #2678. A doctor that exits without naming a check used to be reported as
// `doctor could not be run (exit 1) and named no check`, which reads as a broken
// install and sends the operator hunting a machine fault that does not exist. The
// wrapper usually SAID what was wrong on stderr -- here, that its caller variable
// was unset. Quote the wrapper's own first diagnostic line instead. One line,
// trimmed and length-capped: this text travels into refusals.
export function unnamedDoctorFailure(wrapper,error,stderr){
  const said=String(stderr??'').split(/\r?\n/).map((line)=>line.trim()).find(Boolean)
  const quoted=said?`: ${said.length>300?`${said.slice(0,300)}...`:said}`:' and named no check'
  return `doctor could not be run (${error?.code??`exit ${error?.status}`})${quoted}`
}

export function doctorSpawnPlan(resolved,platform=process.platform){
  if(platform==='win32'&&/\.(cmd|bat)$/i.test(resolved))return {file:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',resolved,'doctor']}
  return {file:resolved,args:['doctor']}
}

// ISSUE #2828: a doctor timeout names the wrapper and, where that provider runs a
// local server, the exact repair -- a bare "did not answer" left the operator
// guessing while a healthy server sat undrawable. The leading text is load-bearing:
// run-governed-review's DOCTOR_TIMEOUT regex matches `doctor did not answer within`
// to decide the retry-then-reroute path, so only append after it, never reword it.
export function doctorTimeoutFailingChecks(wrapper,timeoutMs=REVIEWER_DOCTOR_TIMEOUT_MS){
  const repair=wrapper==='ai-glm'
    ?' — the repair for a down or wedged GLM server is `ai-glm server start` (then `ai-glm doctor` locally if it still stalls)'
    :` — run \`${wrapper} doctor\` locally to see which check stalls`
  return [`doctor did not answer within ${timeoutMs/1000}s${repair}`]
}

// The single place a wrapper name becomes a real path.
//
// ON WINDOWS THE FIRST LINE IS OFTEN THE WRONG ONE. `where.exe ai-grok-review`
// prints BOTH `...\\ai-grok-review` (an extension-less bash script Windows cannot
// execute at all) and `...\\ai-grok-review.cmd` (the shim the shell actually runs,
// via PATHEXT). Taking the first line made the probe fail ENOENT for two of the
// three active reviewers and report them as local faults while they were healthy.
// Caught by spot-checking every wrapper after an independent review asked for it,
// having already been burned once by the same class of bug.
//
// So mirror what the shell does: prefer the first candidate whose extension is in
// PATHEXT, and fall back to the first line when none qualifies.
export function pickExecutableCandidate(candidates,platform=process.platform,pathext=process.env.PATHEXT){
  const list=candidates.filter(Boolean)
  if(platform!=='win32')return list[0]??null
  const exts=String(pathext||'.COM;.EXE;.BAT;.CMD').split(';').map((e)=>e.trim().toLowerCase()).filter(Boolean)
  const runnable=list.find((p)=>exts.some((e)=>p.toLowerCase().endsWith(e)))
  return runnable??list[0]??null
}

export function resolveCommandPath(command,platform=process.platform){
  try{
    const out=execFileSync(platform==='win32'?'where.exe':'which',[command],{encoding:'utf8',stdio:['ignore','pipe','ignore']})
    return pickExecutableCandidate(out.split(/\r?\n/).map((line)=>line.trim()),platform)
  }catch{return null}
}
