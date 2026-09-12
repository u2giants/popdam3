#!/usr/bin/env node
import { runGitHubCommand } from './lib/github-transport.mjs'
import { currentPullNumber, loadOpenPullFiles } from './lib/open-pr-files.mjs'
import { pathToFileURL } from 'node:url'

export const PROTECTED_SOURCE_PATHS=new Set(['scripts/manage-migration-author-lanes.mjs'])

export function openProtectedCollisions(current,others){
  const mine=new Set((current.files??[]).filter((file)=>PROTECTED_SOURCE_PATHS.has(file)))
  const priority=(pr)=>{
    const stamp=Date.parse(pr.activatedAt??'')
    return [Number.isFinite(stamp)?stamp:0,Number(pr.number)]
  }
  const minePriority=priority(current)
  const precedes=(pr)=>{const theirs=priority(pr);return theirs[0]<minePriority[0]||(theirs[0]===minePriority[0]&&theirs[1]<minePriority[1])}
  return (others??[]).filter((pr)=>!pr.draft&&precedes(pr)).flatMap((pr)=>(pr.files??[]).filter((file)=>mine.has(file)).map((file)=>({file,pr:Number(pr.number),title:String(pr.title??'')}))).sort((a,b)=>a.pr-b.pr||a.file.localeCompare(b.file))
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
 */
export function gather(env=process.env,{load=loadOpenPullFiles,timeline=readTimeline}={}){
  const repo=env.GITHUB_REPOSITORY;if(!repo)throw new InputError('GITHUB_REPOSITORY is not set')
  const number=currentPullNumber(env)
  if(!number)throw new InputError('pull request number is unavailable')
  const snapshot=load(repo,number,{env})
  const current={number,title:snapshot.current.title,draft:snapshot.current.draft,created_at:snapshot.current.created_at,files:filePaths(snapshot.current.files)}
  const mine=new Set(current.files.filter((file)=>PROTECTED_SOURCE_PATHS.has(file)))
  const others=snapshot.others.filter((pr)=>Number(pr.number)!==number&&!pr.listed.draft).map((pr)=>({number:pr.number,title:pr.listed.title,draft:pr.listed.draft,created_at:pr.listed.created_at,files:filePaths(pr.files)}))
  const overlapping=others.filter((pr)=>pr.files.some((file)=>mine.has(file)))
  const activate=(pr)=>({number:pr.number,title:pr.title,draft:pr.draft,activatedAt:activationDate(pr,timeline(repo,pr.number)),files:pr.files})
  return {
    current:overlapping.length?activate(current):{number,title:current.title,draft:current.draft,activatedAt:null,files:current.files},
    others:overlapping.map(activate),
  }
}
export function main(env=process.env){
  let input;try{input=gather(env)}catch(error){console.error(`ERROR: protected source collision audit is unavailable: ${error.message}`);return 2}
  const collisions=openProtectedCollisions(input.current,input.others)
  if(!collisions.length){console.log('No other ready open pull request edits the same protected coordination source.');return 0}
  console.error('ERROR: another ready open pull request edits the same protected coordination source.')
  for(const row of collisions)console.error(`  ${row.file} — PR #${row.pr} "${row.title}"`)
  console.error('Merge or close the other pull request, then rebase and re-run this check. No migration version or database-object claim is consumed.')
  return 1
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)process.exit(main())
