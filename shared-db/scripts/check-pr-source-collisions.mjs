#!/usr/bin/env node
import { runGitHubCommand } from './lib/github-transport.mjs'
import { currentPullNumber, loadOpenPullFiles } from './lib/open-pr-files.mjs'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const PROTECTED_SOURCE_PATHS=new Set(['scripts/manage-migration-author-lanes.mjs'])

// THE STALE-PLACE RULE (issue #3273)
// ----------------------------------
// SINCE #3721 this rule no longer changes the exit code: overlap passes at PR
// time and the merge queue decides order. It now only decides which earlier
// pull requests are LISTED as ahead. The text below is its original rationale.
//
// An earlier ready pull request that edits a protected source serializes every
// later one, and until 2026-09-18 that place in the queue had no expiry: on
// that date PRs #3215, #3217 and #3228 sat 8+ hours ahead of #3247 while
// inactive, red or conflict-dirty, and the only escape was waiting for a human
// to merge or close them. A place in the queue is now FORFEIT when ALL three
// hold, and only then:
//
//   (a) the pull request has had no activity for 24+ hours;
//   (b) its latest checks are failing OR it conflicts with main;
//   (c) the newer pull request's session has posted a DATED nudge comment on
//       it naming the stale state (see parseStalePlaceNudge).
//
// The place is RECLAIMED automatically: once the earlier pull request is
// refreshed (any non-nudge activity inside 24h) and green (no failing check,
// no conflict), condition (a) or (b) stops holding and it precedes again. No
// state is reset by hand because no state is kept.
//
// FAIL CLOSED. Skipping a queue predecessor is the relaxation, so every
// unreadable or absent signal -- activity, checks, mergeability, comments --
// means NO skip. `mergeable` is null while GitHub computes it and is treated
// as not-conflicting: a queue that blocks one push too long is recoverable, a
// gate that waves a healthy predecessor through is not.
//
// WHO MAY NUDGE. The gate cannot bind a comment to the newer pull request's
// session -- comments carry a GitHub author, not a session. The enforceable
// proxy is the machine-readable marker naming the newer pull request's number,
// posted as a dated comment on the stale one. A nudge that names a different
// number yields the place to nobody.
export const STALE_PLACE_AFTER_MS=24*60*60*1000
export const STALE_PLACE_NUDGE_PREFIX='stale-place-nudge:'
export const STALE_PLACE_STATES=Object.freeze(['inactive-24h','checks-failing','conflicts-with-main'])

export function stalePlaceNudgeLine(forPr,{date,states}){
  return `${STALE_PLACE_NUDGE_PREFIX} pr=#${Number(forPr)} date=${date} state=${states.join('+')}`
}

// Parse ONE comment body for the nudge marker. Returns null unless the marker
// names a pull request, carries a real calendar date, and names at least one
// known stale state. `commentedAt` is the comment's own posted time: pass it
// whenever the comment is real, because an undatable comment is not a dated
// nudge. Omitting it (pure parsing) falls back to the marker's calendar date.
export function parseStalePlaceNudge(body,{commentedAt}={}){
  const line=String(body??'').split(/\r?\n/).map((row)=>row.trim()).find((row)=>row.toLowerCase().startsWith(STALE_PLACE_NUDGE_PREFIX))
  if(!line)return null
  const prMatch=/(?:^|\s)pr=#?(\d+)(?=\s|$)/.exec(line)
  const dateMatch=/(?:^|\s)date=(\d{4}-\d{2}-\d{2})(?=\s|$)/.exec(line)
  const stateMatch=/(?:^|\s)state=([a-z0-9+-]+)(?=\s|$)/i.exec(line)
  if(!prMatch||!dateMatch||!stateMatch)return null
  const states=stateMatch[1].toLowerCase().split('+').filter((state)=>STALE_PLACE_STATES.includes(state))
  if(!states.length)return null
  const fallback=`${dateMatch[1]}T00:00:00Z`
  if(!Number.isFinite(Date.parse(fallback)))return null
  const at=commentedAt===undefined?fallback:(Number.isFinite(Date.parse(commentedAt??''))?commentedAt:null)
  if(at===null)return null
  return {forPr:Number(prMatch[1]),date:dateMatch[1],states,at}
}

// The newest activity a pull request shows, EXCLUDING nudge comments: a nudge
// must not refresh the stale pull request it was posted on, or condition (a)
// could never survive its own notification. Commits, reviews, labels, edits
// and every ordinary comment all count as activity. Returns null when nothing
// datable exists -- and null means NO skip downstream.
export function lastActivityAt({detail,timeline=[],commits=[],comments=[]}={}){
  const stamps=[]
  const push=(value)=>{const stamp=Date.parse(value??'');if(Number.isFinite(stamp))stamps.push(stamp)}
  push(detail?.created_at)
  for(const commit of commits){push(commit?.commit?.committer?.date);push(commit?.commit?.author?.date)}
  for(const comment of comments){
    if(parseStalePlaceNudge(comment?.body,{commentedAt:comment?.created_at}))continue
    push(comment?.created_at)
  }
  for(const row of timeline){
    if(String(row?.event??'')==='commented')continue
    push(row?.created_at)
    push(row?.submitted_at)
  }
  return stamps.length?new Date(Math.max(...stamps)).toISOString():null
}

// Only the LATEST run per check name decides: a failed run superseded by a
// re-run that passed is not a failing check. No check runs at all is not
// failing -- pending is not red.
export function latestChecksFailing(checkRuns){
  const FAILING=new Set(['failure','cancelled','timed_out','action_required'])
  const latestByName=new Map()
  for(const run of checkRuns??[]){
    const name=String(run?.name??'')
    if(!name)continue
    const prior=latestByName.get(name)
    if(!prior||Number(run?.id??0)>Number(prior?.id??0))latestByName.set(name,run)
  }
  return [...latestByName.values()].some((run)=>FAILING.has(String(run?.conclusion??'').toLowerCase()))
}

// `mergeable === false` is GitHub's computed answer; mergeable_state 'dirty'
// is the same fact before the boolean settles. Null means still computing,
// which is treated as NOT conflicting (see the fail-closed note above).
export function conflictsWithMain(detail){
  return detail?.mergeable===false||String(detail?.mergeable_state??'').toLowerCase()==='dirty'
}

// True only when the earlier pull request forfeits its place to THIS newer
// one: all three stale-place conditions hold and the nudge names the newer
// pull request's own number.
export function stalePlaceYield(pr,currentNumber,{now}={}){
  const nowMs=now===undefined?Date.now():(typeof now==='number'?now:Date.parse(now??''))
  if(!Number.isFinite(nowMs))return false
  const lastActivity=Date.parse(pr?.lastActivityAt??'')
  if(!Number.isFinite(lastActivity))return false
  if(nowMs-lastActivity<STALE_PLACE_AFTER_MS)return false
  if(pr?.checksFailing!==true&&pr?.conflictsWithMain!==true)return false
  return (pr?.nudges??[]).some((nudge)=>Number(nudge?.forPr)===Number(currentNumber)&&Number.isFinite(Date.parse(nudge?.at??'')))
}

const queuePriority=(pr)=>{
  const stamp=Date.parse(pr.activatedAt??'')
  return [Number.isFinite(stamp)?stamp:0,Number(pr.number)]
}
const queuePrecedes=(pr,current)=>{const theirs=queuePriority(pr),mine=queuePriority(current);return theirs[0]<mine[0]||(theirs[0]===mine[0]&&theirs[1]<mine[1])}
const overlappingRows=(current,prs)=>{
  const mine=new Set((current.files??[]).filter((file)=>PROTECTED_SOURCE_PATHS.has(file)))
  return (prs??[]).flatMap((pr)=>(pr.files??[]).filter((file)=>mine.has(file)).map((file)=>({file,pr:Number(pr.number),title:String(pr.title??'')}))).sort((a,b)=>a.pr-b.pr||a.file.localeCompare(b.file))
}

export function openProtectedCollisions(current,others,{now}={}){
  const blocks=(pr)=>!pr.draft&&queuePrecedes(pr,current)&&!stalePlaceYield(pr,current.number,{now})
  return overlappingRows(current,(others??[]).filter(blocks))
}

// The informational inverse of the collision list: earlier pull requests whose
// place was forfeited to the current one under the stale-place rule. main()
// prints them so the queue audit shows WHY a predecessor no longer blocks.
export function stalePlaceSkips(current,others,{now}={}){
  const yields=(pr)=>!pr.draft&&queuePrecedes(pr,current)&&stalePlaceYield(pr,current.number,{now})
  return overlappingRows(current,(others??[]).filter(yields))
}

class InputError extends Error{}
// Issue #2342: shared transport, identical refusals.
function ghJson(args){
  const raw=runGitHubCommand(args,{maxBuffer:32*1024*1024,wrapError:(detail,cause)=>new InputError(`gh ${args.join(' ')} failed: ${cause?.message??detail}`)})
  try{return JSON.parse(raw)}catch{throw new InputError(`gh ${args.join(' ')} returned unreadable JSON`)}
}
export function filePaths(files){return [...new Set(files.flatMap((file)=>[file.filename,file.previous_filename].filter(Boolean)))]}
export function activationDate(pr,timeline){
  const dates=[pr.created_at,...timeline.filter((row)=>['ready_for_review','reopened'].includes(row.event)).map((row)=>row.created_at)]
  const stamps=dates.map((date)=>Date.parse(date??''))
  if(stamps.some((stamp)=>!Number.isFinite(stamp)))throw new InputError(`activation history for PR #${pr.number} is unreadable`)
  return new Date(Math.max(...stamps)).toISOString()
}
function readTimeline(repo,number){
  return ghJson(['api','--paginate','--slurp',`repos/${repo}/issues/${number}/timeline?per_page=100`]).flat()
}
function readPullDetail(repo,number){
  return ghJson(['api',`repos/${repo}/pulls/${number}`])
}
function readPullCommits(repo,number){
  return ghJson(['api','--paginate','--slurp',`repos/${repo}/pulls/${number}/commits?per_page=100`]).flat()
}
function readIssueComments(repo,number){
  return ghJson(['api','--paginate','--slurp',`repos/${repo}/issues/${number}/comments?per_page=100`]).flat()
}
function readCheckRuns(repo,sha){
  return ghJson(['api','--paginate','--slurp',`repos/${repo}/commits/${sha}/check-runs?per_page=100`]).flatMap((page)=>page?.check_runs??[])
}
/**
 * The open pull request files come from the ONE shared snapshot
 * (scripts/lib/open-pr-files.mjs) the object check also reads.
 *
 * Timelines are read only where they can change the answer. Activation order
 * decides nothing unless another ready pull request edits a protected file this
 * pull request also edits: openProtectedCollisions emits rows only for those
 * overlapping files, so a non-overlapping pull request produces no row whatever
 * its activation date. Reading its timeline was pure quota spend. The current
 * pull request's own timeline is read only when at least one overlap exists.
 *
 * The stale-place signals (pull detail, commits, issue comments, check runs)
 * follow the same rule: they decide nothing unless an overlapping pull request
 * actually precedes the current one, so they are gathered only for overlapping
 * pull requests, one read each, and any unreadable read throws -- which main()
 * turns into a refusal, never a skip.
 */
export function gather(env=process.env,{load=loadOpenPullFiles,timeline=readTimeline,detail=readPullDetail,commits=readPullCommits,comments=readIssueComments,checkRuns=readCheckRuns}={}){
  const repo=env.GITHUB_REPOSITORY;if(!repo)throw new InputError('GITHUB_REPOSITORY is not set')
  const number=currentPullNumber(env)
  if(!number)throw new InputError('pull request number is unavailable')
  const snapshot=load(repo,number,{env})
  const current={number,title:snapshot.current.title,draft:snapshot.current.draft,created_at:snapshot.current.created_at,files:filePaths(snapshot.current.files)}
  const mine=new Set(current.files.filter((file)=>PROTECTED_SOURCE_PATHS.has(file)))
  const others=snapshot.others.filter((pr)=>Number(pr.number)!==number&&!pr.listed.draft).map((pr)=>({number:pr.number,title:pr.listed.title,draft:pr.listed.draft,created_at:pr.listed.created_at,files:filePaths(pr.files)}))
  const overlapping=others.filter((pr)=>pr.files.some((file)=>mine.has(file)))
  const activate=(pr)=>({number:pr.number,title:pr.title,draft:pr.draft,activatedAt:activationDate(pr,timeline(repo,pr.number)),files:pr.files})
  const enrich=(pr)=>{
    const rows=timeline(repo,pr.number)
    const pullDetail=detail(repo,pr.number)
    const pullCommits=commits(repo,pr.number)
    const issueComments=comments(repo,pr.number)
    const headSha=pullDetail?.head?.sha??null
    return {
      number:pr.number,title:pr.title,draft:pr.draft,files:pr.files,
      activatedAt:activationDate(pr,rows),
      lastActivityAt:lastActivityAt({detail:pullDetail,timeline:rows,commits:pullCommits,comments:issueComments}),
      checksFailing:headSha?latestChecksFailing(checkRuns(repo,headSha)):false,
      conflictsWithMain:conflictsWithMain(pullDetail),
      nudges:issueComments.map((comment)=>parseStalePlaceNudge(comment?.body,{commentedAt:comment?.created_at})).filter(Boolean),
    }
  }
  return {
    current:overlapping.length?activate(current):{number,title:current.title,draft:current.draft,activatedAt:null,files:current.files},
    others:overlapping.map(enrich),
  }
}
// THE MERGE-TIME PROOF (review of PR #3722). Queueing instead of refusing is
// safe only if every overlapping change is tested on a tree that already
// contains the earlier one. That is proved per merge group from the facts of
// the group itself -- the tree actually being tested -- using only the event
// payload and local git (the rulesets API needs admin access, and a repo PAT
// must never reach pull-request code):
//
//   the group head is a single two-parent merge whose first parent IS the
//   group's base_sha, i.e. the group is exactly "main as GitHub chose it +
//   this one pull request", not stacked on another queued entry.
//
// Because each queued entry merges into main before the next group is built on
// it, an earlier overlapping change is in the later group's base. Main moving
// OUTSIDE the queue is deliberately not a refusal: GitHub rebuilds such groups
// itself, and only an admin bypass can move main outside the queue -- the same
// bypass could merge past the old PR-time refusal too. Anything unreadable
// refuses. This same job runs the lane-manager suites on that tree.
export function mergeGroupProblem({baseSha,headSha,headParents}={}){
  const sha=(value)=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value)
  if(!sha(baseSha)||!sha(headSha))return 'the merge group base or head SHA is unreadable'
  if(!Array.isArray(headParents)||!headParents.every(sha))return 'the merge group head parents are unreadable'
  if(headParents.length!==2||headParents[0]!==baseSha)return 'the merge group is not exactly one pull request merged onto its base'
  return null
}
export function readMergeGroupFacts(env,{cwd}={}){
  const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8'))
  const baseSha=event?.merge_group?.base_sha,headSha=event?.merge_group?.head_sha
  if(typeof headSha!=='string'||!headSha)return {baseSha,headSha,headParents:null}
  const line=execFileSync('git',['rev-list','--parents','-n','1',headSha],{encoding:'utf8',cwd}).trim().split(/\s+/)
  return {baseSha,headSha,headParents:line[0]===headSha?line.slice(1):null}
}

// QUEUE, DON'T REFUSE (issue #3721; Albert Hazan, 2026-09-28: "overlapping
// changes wait their turn in the automatic merge line instead of blocking each
// other"). Until then an overlap with an earlier ready pull request FAILED this
// required check and the red verdict never re-ran when the predecessor merged,
// so about nine ready pull requests blocked one another at once.
//
// The harm this rule exists for (issue #1831: two branches editing the lane
// manager combining silently in git) is now held at MERGE time: on every
// merge_group, SOURCE_COLLISION_MODE=merge-group proves the group is its base
// plus exactly one pull request (mergeGroupProblem above), and the same
// job runs the lane-manager suites on that tree. A textual conflict ejects the
// entry; a semantic one fails those tests. At PR time overlap is reported and
// passes. Ordering and stale-place rules still decide the printed list. An
// unreadable PR-time audit still exits 2.
export function main(env=process.env,{gatherInput=gather,groupFacts=()=>readMergeGroupFacts(env),now,log=console.log,error=console.error}={}){
  if(env.SOURCE_COLLISION_MODE==='merge-group'){
    let problem;try{problem=mergeGroupProblem(groupFacts())}catch(cause){problem=`the merge group facts are unreadable: ${cause.message}`}
    if(problem){error(`ERROR: queued protected-source changes must be re-tested on the group base plus exactly one pull request, but ${problem}.`);return 1}
    log('Merge group is exactly its base plus one pull request: overlapping protected-source changes are re-tested on the combined tree.')
    return 0
  }
  let input;try{input=gatherInput(env)}catch(cause){error(`ERROR: protected source collision audit is unavailable: ${cause.message}`);return 2}
  const skips=stalePlaceSkips(input.current,input.others,{now})
  for(const row of skips)log(`STALE-PLACE SKIP: ${row.file} — PR #${row.pr} "${row.title}" is inactive 24h+ with failing checks or a main conflict, and a dated nudge names this pull request; it no longer precedes this one.`)
  const ahead=openProtectedCollisions(input.current,input.others,{now})
  if(!ahead.length){log('No other ready open pull request edits the same protected coordination source.');return 0}
  log('QUEUED: an earlier ready open pull request edits the same protected coordination source. This pull request waits its turn in the merge queue; its merge group must be its base plus only this pull request, and is re-tested there.')
  for(const row of ahead)log(`  earlier overlapping PR (activation order; GitHub's queue order decides): ${row.file} — PR #${row.pr} "${row.title}"`)
  return 0
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)process.exit(main())
