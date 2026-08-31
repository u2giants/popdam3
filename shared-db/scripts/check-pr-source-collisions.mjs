#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
function ghJson(args){
  let raw
  try{raw=execFileSync('gh',args,{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']})}catch(error){throw new InputError(`gh ${args.join(' ')} failed: ${error.message}`)}
  try{return JSON.parse(raw)}catch{throw new InputError(`gh ${args.join(' ')} returned unreadable JSON`)}
}
export function filePaths(files){return [...new Set(files.flatMap((file)=>[file.filename,file.previous_filename].filter(Boolean)))]}
function prFiles(repo,number){
  const pr=ghJson(['api',`repos/${repo}/pulls/${number}`]),files=ghJson(['api','--paginate','--slurp',`repos/${repo}/pulls/${number}/files?per_page=100`]).flat()
  if(!Number.isInteger(pr.changed_files)||pr.changed_files>=3000||files.length!==pr.changed_files)throw new InputError(`PR #${number} file list is incomplete`)
  return filePaths(files)
}
export function activationDate(pr,timeline){
  const dates=[pr.created_at,...timeline.filter((row)=>['ready_for_review','reopened'].includes(row.event)).map((row)=>row.created_at)]
  const stamps=dates.map((date)=>Date.parse(date??''))
  if(stamps.some((stamp)=>!Number.isFinite(stamp)))throw new InputError(`activation history for PR #${pr.number} is unreadable`)
  return new Date(Math.max(...stamps)).toISOString()
}
function activatedAt(repo,pr){
  const timeline=ghJson(['api','--paginate','--slurp',`repos/${repo}/issues/${pr.number}/timeline?per_page=100`]).flat()
  return activationDate(pr,timeline)
}
export function gather(env=process.env){
  const repo=env.GITHUB_REPOSITORY;if(!repo)throw new InputError('GITHUB_REPOSITORY is not set')
  let number=Number(env.PR_NUMBER)
  if(!number&&env.GITHUB_EVENT_PATH){try{number=Number(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')).pull_request?.number)}catch{}}
  if(!number)throw new InputError('pull request number is unavailable')
  const current=ghJson(['api',`repos/${repo}/pulls/${number}`]),open=ghJson(['api','--paginate','--slurp',`repos/${repo}/pulls?state=open&per_page=100`]).flat()
  return {current:{number,title:current.title,draft:current.draft,activatedAt:activatedAt(repo,current),files:prFiles(repo,number)},others:open.filter((pr)=>pr.number!==number&&!pr.draft).map((pr)=>({number:pr.number,title:pr.title,draft:pr.draft,activatedAt:activatedAt(repo,pr),files:prFiles(repo,pr.number)}))}
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
