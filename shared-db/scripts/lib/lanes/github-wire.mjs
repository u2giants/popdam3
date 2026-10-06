// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { execFileSync } from 'node:child_process'
import { REVIEW_VERDICT_REPLACEMENT_REF_PREFIX } from '../../lib/review-verdict-artifact.mjs'
import { classifyChangedPaths, changedPathsFromPullRequestFiles } from '../../lib/documents-only-change.mjs'
import { REPO, REVIEW_REPLACEMENT_REF_PREFIX } from './constants.mjs'
import { LaneError } from './claims.mjs'
import { projectReviewPr } from './review-assignment.mjs'
import { gitRemoteRefs, githubIo, runGitHubCommand } from '../../manage-migration-author-lanes.mjs'
import { authorityReadEnv } from '../authority-token-read.mjs'

// An EXPECTED failure is one this code asks a question with: "does this ref
// exist yet?" answers with HTTP 404, and "create this ref" answers with
// "reference already exists". Both are answers, not faults, but the GitHub CLI
// prints them to the terminal anyway, so a completely healthy run looked
// alarming and trained everyone to ignore 404s -- which is exactly how a REAL
// error on issue #1351 was read as more of the same noise.
//
// The cure must not be "swallow stderr". stderr is CAPTURED here (never
// inherited), attached to the thrown error so the message keeps every detail,
// and re-printed to this process's stderr for every failure that is NOT the
// expected answer. Quieter for the answers, LOUDER for the faults: an
// unexpected gh failure now prints gh's own stderr even when a caller catches
// the exception.
// Exactly the message that PROVES absence (see isConfirmedRefAbsence). A bare
// "not found" without a 404 is ambiguous, stays a hard failure, and must stay
// noisy.
export const EXPECTED_REF_ABSENCE=/HTTP 404/i
export const EXPECTED_REF_PRESENCE=/reference already exists/i
export function gh(args,options) { return runGitHubCommand(args,options) }

// Issue #3857: the authority reads above run with AUTHORITY_TOKEN when it is
// present, using it ONLY for those reads; every other GitHub call stays on the
// ambient GH_TOKEN. Same swap-and-restore shape as tokenScopedRead in
// check-required-checks-preflight.mjs: the call keeps the DEFAULT executor so
// the host-wide quota latch stays active and the wire budget is charged exactly
// once (a custom executor would disable the latch and double-charge the budget
// -- a governed review of this change proved both).
export function authorityGhJson(args){
  const scopedEnv=authorityReadEnv()
  if(!scopedEnv)return ghJson(args)
  const prior=process.env.GH_TOKEN
  process.env.GH_TOKEN=scopedEnv.GH_TOKEN
  try{return ghJson(args)}finally{if(prior===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=prior}
}
export const hasLabel = (issue, name) => (issue?.labels ?? []).some((label) => (typeof label === 'string' ? label : label?.name) === name)

export function createRefWithReadback(ref,sha,{run=gh,readRef}={}) {
  try{run(['api','-X','POST',`repos/${REPO}/git/refs`,'-f',`ref=${ref}`,'-f',`sha=${sha}`],{expectedFailure:EXPECTED_REF_PRESENCE,idempotentWrite:true});return true}
  catch(error){
    if(/reference already exists/i.test(error.message)){
      if(!readRef)return false
      return readRef(ref)===sha
    }
    if(!error.transientTransport||!readRef)throw error
    const actual=readRef(ref)
    if(actual===sha)return true
    if(actual!==null)return false
    throw error
  }
}
export function deleteRefWithReadback(ref,{run=gh,readRef}={}) {
  try{run(['api','-X','DELETE',`repos/${REPO}/git/refs/${ref.replace(/^refs\//,'')}`],{expectedFailure:EXPECTED_REF_ABSENCE,idempotentWrite:true});return}
  catch(error){
    if(isConfirmedRefAbsence(error))return
    if(/reference does not exist/i.test(error.message)&&readRef&&readRef(ref)===null)return
    if(!error.transientTransport||!readRef)throw error
    if(readRef(ref)===null)return
    throw error
  }
}
export function ghJson(args,options) {
  const raw = gh(args,options)
  try { return JSON.parse(raw) } catch { throw new LaneError(`GitHub returned unreadable JSON for gh ${args.join(' ')}`) }
}
// Split `gh api -i` output into its response headers and its parsed JSON body.
// The header block is separated from the body by the first blank line; GitHub's
// JSON body never contains one, so the FIRST boundary is always the right one.
// Header names are lowercased because HTTP header names are case-insensitive and
// gh prints them in GitHub's own casing.
// ONE counted request, headers included, for listReviewRefsPaged. Deliberately
// not `--paginate`: that is one gh invocation making an unknown number of HTTP
// requests, which the reviewer wire budget could neither see nor charge.
export function ghRefListing(endpoint) { return parseGhIncludeResponse(gh(['api','-i',endpoint])) }
export function parseGitRemoteRefs(text){
  const refs=new Map()
  for(const raw of String(text).split('\n')){
    const line=raw.replace(/\r$/,'')
    if(!line.trim())continue
    const match=/^([0-9a-f]{40})\t(refs\/\S+)$/.exec(line)
    if(!match)throw new LaneError('git ref listing is malformed; refusing to treat any ref as absent')
    if(match[2].endsWith('^{}'))continue
    refs.set(match[2],match[1])
  }
  return refs
}
// #3791: a stalled git child inside a lock's release must not hang it forever.
export const GIT_COMMAND_TIMEOUT_MS = 60 * 1000
// Issue #3187: commit messages for refs already listed over git are read over git
// too. Objects absent locally are fetched once, by exact SHA, in one `git fetch`
// (the same hydration atomicReviewRefs already relies on). A commit that is still
// absent after the fetch, or an unparseable object, throws: never "no lease".
export function parseGitCommitBatch(output){
  const buffer=Buffer.isBuffer(output)?output:Buffer.from(String(output??''),'utf8')
  const commits=new Map(),unfetched=[]
  let offset=0
  while(offset<buffer.length){
    const newline=buffer.indexOf(10,offset)
    if(newline<0)throw new LaneError('git commit batch output is malformed')
    const header=buffer.subarray(offset,newline).toString('utf8').replace(/\r$/,'')
    offset=newline+1
    if(!header.trim())continue
    const absent=/^([0-9a-f]{40}) missing$/.exec(header)
    if(absent){unfetched.push(absent[1]);continue}
    const match=/^([0-9a-f]{40}) (\w+) (\d+)$/.exec(header)
    if(!match)throw new LaneError('git commit batch output is malformed')
    const size=Number(match[3]),raw=buffer.subarray(offset,offset+size)
    if(raw.length!==size)throw new LaneError('git commit batch output is truncated')
    offset+=size+1
    if(match[2]!=='commit')throw new LaneError(`git object ${match[1]} is a ${match[2]}, not a commit`)
    const text=raw.toString('utf8'),split=text.indexOf('\n\n')
    const headers=split<0?text:text.slice(0,split),message=split<0?'':text.slice(split+2)
    const committer=/^committer .* (\d+) ([+-]\d{4})$/m.exec(headers)
    commits.set(match[1],{message,committedDate:committer?new Date(Number(committer[1])*1000).toISOString():null})
  }
  return {commits,unfetched}
}
export function readGitCommits(shas,{run=execFileSync}={}){
  const unique=[...new Set(shas.map((sha)=>String(sha).toLowerCase()))]
  if(!unique.length)return new Map()
  if(unique.some((sha)=>!/^[0-9a-f]{40}$/.test(sha)))throw new LaneError('git commit read requires exact 40-hex SHAs')
  const batch=()=>{
    try{return parseGitCommitBatch(run('git',['cat-file','--batch'],{input:`${unique.join('\n')}\n`,maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}))}
    catch(error){if(error instanceof LaneError)throw error;throw new LaneError(`git commit read failed: ${String(error?.stderr??error?.message??error).trim().split('\n')[0]}`)}
  }
  let result=batch()
  if(result.unfetched.length){
    try{run('git',['fetch','--no-tags','-q','origin',...result.unfetched],{encoding:'utf8',stdio:['ignore','pipe','pipe']})}
    catch(error){throw new LaneError(`git could not hydrate commits ${result.unfetched.join(', ')}: ${String(error?.stderr??error?.message??error).trim().split('\n')[0]}`)}
    result=batch()
    if(result.unfetched.length)throw new LaneError(`git commits ${result.unfetched.join(', ')} are unreadable after fetch`)
  }
  return result.commits
}
export function reviewStateEntry(pr,issue){
  if(!pr||!issue||!Array.isArray(pr.comments?.nodes)||!Array.isArray(pr.reviews?.nodes)||!Array.isArray(issue.comments?.nodes)||pr.comments?.pageInfo?.hasNextPage!==false||pr.reviews?.pageInfo?.hasNextPage!==false||issue.comments?.pageInfo?.hasNextPage!==false)throw new LaneError('batched reviewer PR/verdict evidence is incomplete or paginated')
  return {issue:{state:String(issue.state).toLowerCase()},pr:projectReviewPr(pr),evidence:[...issue.comments.nodes,...pr.comments.nodes,...pr.reviews.nodes.map((row)=>({...row,commit_id:row.commit?.oid}))]}
}
export function gitRemoteRefRows(prefix){
  return [...gitRemoteRefs([`${prefix}*`])].filter(([ref])=>ref.startsWith(prefix)).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([ref,sha])=>({ref,sha}))
}
export function parseGhIncludeResponse(raw) {
  const text=String(raw??'')
  const boundary=/\r?\n\r?\n/.exec(text)
  if(!boundary)throw new LaneError('GitHub response had no header/body boundary; refusing to read it as a ref listing')
  const headerBlock=text.slice(0,boundary.index),body=text.slice(boundary.index+boundary[0].length)
  // A REPEATED HEADER IS JOINED, NEVER OVERWRITTEN (#2152 review, glm-5.3).
  // HTTP allows one field to be sent on several lines, and RFC 9110 says the
  // combined value is those lines joined by ", ". Building this map with
  // `Object.fromEntries` kept only the LAST line, so a `Link` line carrying
  // rel="next" sent ahead of a second `Link` line would have vanished -- a
  // silently missed truncation signal, which is the fail-OPEN direction this
  // whole listing exists to prevent.
  const headers={}
  for(const line of headerBlock.split(/\r?\n/).slice(1)){
    const colon=line.indexOf(':')
    if(colon<0)continue
    const name=line.slice(0,colon).trim().toLowerCase(),value=line.slice(colon+1).trim()
    headers[name]=name in headers?`${headers[name]}, ${value}`:value
  }
  let rows
  try{rows=JSON.parse(body)}catch{throw new LaneError('GitHub returned unreadable JSON for a ref listing')}
  return {rows,headers}
}
// Parse an RFC 8288 `Link` field value into `{uri,params}` entries.
//
// PARSED STRUCTURALLY, NOT BY REGULAR EXPRESSION, AND IT FAILS CLOSED (#2152
// review, glm-5.3). The one-line regex this replaces could be fooled from both
// directions: `[^,]*rel="?next"?` matched the text `rel=next` wherever it
// appeared, INCLUDING inside a quoted parameter value such as
// `; title="rel=next"`, and it silently answered "no next page" for any value
// it simply did not recognise. Both are wrong for a truncation guard whose only
// two honest answers are "this is the complete set" and "refuse".
//
// This walks the value once. A quoted string is consumed as a single unit --
// only its closing quote ends it, and a backslash escapes the next character --
// so text inside `title="rel=next"` is a VALUE and can never be mistaken for a
// parameter name. Anything that does not fit the grammar THROWS: a missing `<`,
// an unterminated `<...>` or quoted string, a parameter not introduced by `;`,
// an empty parameter name, a link value carrying no `rel` relation at all, a
// parameter carrying NO `=` at all, or an unquoted
// value that is empty or holds a character outside the token grammar (a stray
// quote above all). Callers let that refusal propagate, because an
// unparseable Link header must never read as "no further pages".
export function parseLinkHeader(value) {
  const text=String(value??'')
  const refuse=(why)=>{throw new LaneError(`unparseable Link header (${why}); refusing to read it as "no further pages" (#2152)`)}
  const space=/[ \t]/
  const tokenChar=/[A-Za-z0-9!#$%&'*+.^_`|~-]/
  // AN ABSENT OR EMPTY FIELD IS THE ONLY "NO FURTHER PAGES" ANSWER. Everything
  // else must be PROVEN well formed before this returns anything at all.
  if(!text.trim())return []
  // PHASE 1 -- PROVE THE OVERALL SHAPE, THEN SPLIT.
  // Four review rounds found four different fail-OPEN holes in a single-pass
  // scanner that accepted whatever it had not specifically objected to (#2152
  // reviews 1-4: a valueless parameter, an unquoted value swallowing a quote, a
  // value with no relation, and an unterminated `<` whose `>` search ran past
  // the end of its own link value and ate the next one). The shape is now
  // inverted: split ONLY on commas that sit outside <URI> and outside a quoted
  // string, and refuse anything this walk cannot fully account for. A `,` or a
  // `;` inside a URI or inside a quoted parameter value is ordinary text and
  // must survive; a second `<` before a `>` proves an earlier <URI> was never
  // closed, which is exactly the hole that let one value swallow another.
  const values=[]
  let current=''
  let state='outside'
  for(let i=0;i<text.length;i++){
    const ch=text[i]
    if(state==='uri'){
      if(ch==='<')refuse('a second < inside <URI>, so an earlier <URI> was never closed')
      if(ch==='>')state='outside'
      current+=ch
      continue
    }
    if(state==='quoted'){
      if(text.charCodeAt(i)===92){if(i+1>=text.length)refuse('trailing escape inside a quoted parameter value');current+=ch+text[i+1];i++;continue} // 92 is a backslash: it escapes the next character, including a quote
      if(ch==='"')state='outside'
      current+=ch
      continue
    }
    if(ch==='<'){state='uri';current+=ch;continue}
    if(ch==='"'){state='quoted';current+=ch;continue}
    if(ch===','){values.push(current);current='';continue}
    current+=ch
  }
  if(state==='uri')refuse('unterminated <URI>')
  if(state==='quoted')refuse('unterminated quoted parameter value')
  values.push(current)
  // PHASE 2 -- EVERY VALUE MUST BE EXACTLY `<URI>` FOLLOWED BY `; name=value`.
  const links=[]
  for(const rawValue of values){
    const v=rawValue.trim()
    if(!v)refuse('an empty link value (a leading, doubled or trailing comma)')
    if(v[0]!=='<')refuse('a link value must begin with <URI>')
    const close=v.indexOf('>')
    if(close<0)refuse('unterminated <URI>')
    const uri=v.slice(1,close)
    const params={}
    let i=close+1
    const skipSpace=()=>{while(i<v.length&&space.test(v[i]))i++}
    skipSpace()
    while(i<v.length){
      // Anything between the closing `>` (or the end of a parameter) and the
      // next `;` is leftover text this parser cannot account for: refuse.
      if(v[i]!==';')refuse(`leftover text in a link value at ${JSON.stringify(v.slice(i))}`)
      i++
      skipSpace()
      const nameStart=i
      while(i<v.length&&tokenChar.test(v[i]))i++
      const name=v.slice(nameStart,i).toLowerCase()
      if(!name)refuse('empty link parameter name')
      skipSpace()
      // RFC 8288 defines link-param as `token BWS "=" BWS ( token / quoted-string )`;
      // there is no valueless form (#2152 review 2).
      if(v[i]!=='=')refuse(`link parameter "${name}" has no value`)
      i++
      skipSpace()
      let parameterValue=''
      if(v[i]==='"'){
        i++
        let closed=false
        while(i<v.length){
          if(v.charCodeAt(i)===92){if(i+1>=v.length)refuse('trailing escape inside a quoted parameter value');parameterValue+=v[i+1];i+=2;continue} // 92 is a backslash
          if(v[i]==='"'){i++;closed=true;break}
          parameterValue+=v[i];i++
        }
        if(!closed)refuse('unterminated quoted parameter value')
      }else{
        // An unquoted value is a token, and a token holds no quote (#2152 review 2).
        const valueStart=i
        while(i<v.length&&tokenChar.test(v[i]))i++
        parameterValue=v.slice(valueStart,i)
        if(!parameterValue)refuse(`empty unquoted value for link parameter "${name}"`)
      }
      // RFC 8288: the FIRST occurrence of a parameter wins. A later repeat of
      // the same name is ignored rather than overwriting it.
      if(!(name in params))params[name]=parameterValue
      skipSpace()
    }
    // RFC 8288 requires every link value to carry a `rel` (#2152 review 3).
    if(!String(params.rel??'').trim())refuse('a link value carries no rel relation')
    links.push({uri,params})
  }
  return links
}
// True when the response advertises a further page. A `Link` field with
// rel="next" is the ONLY signal GitHub gives that a listing is partial, so this
// is the truncation detector -- not a pagination driver. See listReviewRefsPaged.
//
// The field can arrive as several header lines. `parseGhIncludeResponse` joins
// repeats with ", " per RFC 9110, and an array is accepted here too, so a
// rel="next" on ANY of them is seen rather than only the last. `rel` is itself
// a space-separated list of relation types, so it is compared token by token
// and never by substring: `rel="nextish"` is not a next page. An unparseable
// value throws rather than answering false.
export function hasNextPageLink(headers) {
  const raw=headers?.link
  const value=(Array.isArray(raw)?raw:[raw]).filter((line)=>line!=null&&String(line).trim()!=='').map((line)=>String(line).trim()).join(', ')
  if(!value)return false
  return parseLinkHeader(value).some((link)=>String(link.params.rel??'').trim().toLowerCase().split(/\s+/).includes('next'))
}
export function isConfirmedRefAbsence(error) { return /HTTP 404/i.test(String(error?.message??'')) }

export function currentMainMaxVersion(worktree, run = execFileSync) {
  run('git',['-C',worktree,'fetch','--quiet','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main'],{stdio:'ignore'})
  return String(run('git',['-C',worktree,'ls-tree','-r','--name-only','refs/remotes/origin/main'],{encoding:'utf8'})).split(/\r?\n/).map((f)=>/^supabase\/migrations\/(\d{14})_/.exec(f)?.[1]).filter(Boolean).sort().at(-1)
}

export function reviewRecordRefs(refs,matches=[]){
  const replacementVerdicts=matches
    .map((row)=>String(row?.ref??''))
    .filter((ref)=>ref.startsWith(`${REVIEW_REPLACEMENT_REF_PREFIX}/`))
    .map((ref)=>ref.replace(REVIEW_REPLACEMENT_REF_PREFIX,REVIEW_VERDICT_REPLACEMENT_REF_PREFIX))
  return [...new Set([...refs,...matches.map((row)=>row.ref),...replacementVerdicts])]
}

// THE REVIEWER POOL IS NOT DRAWN FOR A DOCUMENTS-ONLY PULL REQUEST (#2102).
//
// The merge gate stops REQUIRING a reviewer for a documents-only change; this
// stops one being DRAWN, which is what actually protects pool capacity. PR #2034
// -- two documentation files -- spent two draws, two dead-reviewer replacements
// and three review runs, and PR #2070 repeated it.
//
// Rulebook files are excluded from the exemption, and the classifier fails closed:
// if the changed-file list cannot be read, the draw proceeds exactly as before.
// A refusal here is never silent -- it names the rule and the classification.
export function assertReviewerDrawIsWarranted(pr,io=githubIo,rows){
  if(typeof io?.pullRequestFiles!=='function')return null
  if(rows===null)return null // the shared pre-draw read failed: proceed, no second fetch
  if(rows===undefined){
    try{rows=io.pullRequestFiles(pr)}catch{return null}
  }
  const verdict=classifyChangedPaths(changedPathsFromPullRequestFiles(rows))
  if(!verdict.documentsOnly)return verdict
  throw new LaneError(`PR #${pr} is a documents-only change (${verdict.reason}), so it does not draw from the database reviewer pool (#2102). Every automated check still runs and it still merges through the guarded merge lane; the merge gate does not require a reviewer verdict for it. Rulebook files -- AGENTS.md, skills, plan_*.md -- are never documents for this purpose and would have been drawn for.`)
}

// ISSUE #2998 item 3 -- readiness pre-conditions, asserted BEFORE the reviewer draw.
//
// Observed: a merge was declined twice with no reason given. The actual cause was that
// the pull request was still a DRAFT, and nothing anywhere in the path said so. Two
// reviewer draws were spent discovering a fact that is one field of a read we already
// make. The defect class this issue records is exactly that -- a pre-condition checked
// after the irreversible step instead of before it.
//
// This REDUCES NOTHING AND APPROVES NOTHING. It only adds refusals in FRONT of the
// draw. Every gate that ran after the draw still runs unchanged, no verdict becomes
// optional, and a refusal here is a refusal -- it never stands in for an approval.
//
// Fail-closed direction matters per check:
//  - `draft` is a definite fact on the live PR, so a draft refuses outright.
//  - `mergeable` is computed ASYNCHRONOUSLY by GitHub and is null until it settles.
//    Only a definite `false` refuses. A null proceeds exactly as before, because
//    making absence-of-answer refuse would turn a timing race into a false refusal --
//    and the guarded merge lane still refuses a real conflict later regardless.
//  - An unreadable PR proceeds exactly as before, matching the classifier above, so a
//    transport fault never silently converts into a reviewer refusal.
export function assertReviewerDrawReadiness(pr,io=githubIo,live){
  if(typeof io?.getPr!=='function')return null
  if(live===undefined){
    try{live=io.getPr(Number(pr))}catch{return null}
  }
  if(!live||typeof live!=='object')return null
  if(live.draft===true)throw new LaneError(`PR #${pr} is still a DRAFT, so no reviewer was drawn and no reviewer capacity was spent. A draft pull request cannot be merged, so a verdict on it could not be acted on. Mark the pull request ready for review, then assign a reviewer.`)
  // Closed-and-UNMERGED refuses (issue #3348). A merged pull request stays drawable:
  // issue #2915 lets a MERGED pull request bound by the verified merged-PR issue binding
  // receive an exact-head verdict, and a merged PR always carries merged_at. Only a PR
  // that is closed AND definitely not merged refuses, because a verdict on an abandoned
  // PR can never be acted on. When neither merge field is present the payload cannot
  // tell merged from abandoned, so it fails OPEN and proceeds exactly as before.
  const mergeFieldsPresent=live.merged!==undefined||live.merged_at!==undefined
  if(String(live.state??'').toLowerCase()==='closed'&&mergeFieldsPresent&&live.merged!==true&&!live.merged_at)throw new LaneError(`PR #${pr} is CLOSED without being merged, so no reviewer was drawn and no reviewer capacity was spent. A verdict on an abandoned pull request can never be acted on. Reopen the pull request (or open a new one), then assign a reviewer.`)
  if(live.mergeable===false)throw new LaneError(`PR #${pr} conflicts with its base branch (GitHub reports mergeable=false), so no reviewer was drawn and no reviewer capacity was spent. Bring the branch up to date with main, resolve the conflict, push, then assign a reviewer.`)
  return {draft:false,mergeable:live.mergeable===undefined?null:live.mergeable}
}
