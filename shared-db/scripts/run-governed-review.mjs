#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { recordReviewVerdict, reviewerExecutionPreflight, resolveCommandPath } from './manage-migration-author-lanes.mjs'

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
  const body=`GOVERNED REVIEW FINDINGS — NON-AUTHORIZING UNLESS THE MATCHING CREATE-ONLY VERDICT ARTIFACT EXISTS\n\n${rawBody}`
  const posted=deps.spawn('gh',['api','-X','POST',`repos/u2giants/shared-db/issues/${options.pr}/comments`,'--input','-'],{encoding:'utf8',input:JSON.stringify({body}),maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']})
  if(posted.error||posted.status!==0)throw new Error('review findings could not be posted durably; no verdict was recorded')
  let comment
  try{comment=JSON.parse(posted.stdout)}catch{throw new Error('durable findings response was unreadable; no verdict was recorded')}
  let artifact
  try{artifact=deps.record({...options,verdict,findingsRef:comment.html_url,replacementSequence:options.replacementSequence??null})}
  catch(error){
    deps.spawn('gh',['api','-X','POST',`repos/u2giants/shared-db/issues/${options.pr}/comments`,'--input','-'],{encoding:'utf8',input:JSON.stringify({body:`REVIEW RECORDING FAILED — the preceding findings comment is non-authorizing and no verdict artifact was recorded. Reason: ${error.message}`}),maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']})
    throw error
  }
  return {artifact,body}
}
export function main(argv=process.argv.slice(2)){
  try{const result=runGovernedReview(parseArgs(argv));process.stdout.write(`${result.body}\n\nDURABLE VERDICT: ${result.artifact.ref} ${result.artifact.sha}\n`);return 0}catch(error){process.stderr.write(`REFUSED: ${error.message}\n`);return 2}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)process.exitCode=main()
