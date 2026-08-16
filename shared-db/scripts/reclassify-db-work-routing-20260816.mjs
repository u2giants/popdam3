#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseQueueScope } from './manage-migration-author-lanes.mjs'

const REPO='u2giants/shared-db'
const apply=process.argv.includes('--apply')
const gh=(args)=>execFileSync('gh',args,{encoding:'utf8',maxBuffer:64*1024*1024})
const json=(args)=>JSON.parse(gh(args))
const issues=json(['issue','list','--repo',REPO,'--state','open','--label','db-work','--limit','1000','--json','number,title,body,labels'])

const curated=new Set([505,515,521,539,553,562,640,865,879,933])
const source=new Set([514,588,732,733,816,817,878,900,1031])
const application=new Set([541,903])
const documentation=new Set([519,526,529,531,559,645,706,734,769,815])
const security=new Set([643,644,875,906])
const structural=new Map([
  [511,['table core.character']],
  [555,['function plm.import_master_data']],
  [764,['sequence dflow.licensingtime_id_seq','sequence dflow.properties_and_characters_id_seq']],
  [898,['table pim.stage','table pim.product_update','table pim.product_time_entry']],
])
const ownerDecision=new Set([516,531,711,732,768,769,810,815,816,865,898,903,906,1031])
const answeredReady=new Set([511,515,521,539,645])
const blocked=new Set([508,532,555,583,597,619,652,696,718,734,748,770,778,817,853,868,912,974])
const staleToClose=new Map([
  [503,'All four owner decisions were answered and recorded on 2026-08-16.'],
  [559,'The setting was already decided, implemented, and verified live.'],
  [643,'Albert answered this risk decision on 2026-08-16; no implementation remains in this issue.'],
  [644,'Albert answered this setting decision on 2026-08-16; no implementation remains in this issue.'],
  [875,'Superseded by the cleanly framed open security question in #906.'],
  [879,'The later policy recorded on #539 resolves this stale count-based owner question.'],
])

function oldScope(body){
  const match=/```db-work-scope\s*\n([\s\S]*?)```/.exec(body)
  if(!match)return {block:null,priority:600,dependencies:[],objects:[]}
  const priority=Number(/^priority:[ \t]*(\d+)/m.exec(match[1])?.[1]??600)
  const dependencies=(/^depends_on:[ \t]*(.*)$/m.exec(match[1])?.[1]??'').split(',').map(x=>x.trim()).filter(Boolean)
  const objects=[...match[1].matchAll(/^\s+-\s+(.+)$/gm)].map(x=>x[1].trim())
  return {block:match[0],priority,dependencies,objects}
}

function classify(issue,prior){
  const number=issue.number
  let workType='repo-maintenance',route='repo-maintenance'
  if(structural.has(number)){workType='structural';route='shared-db-orchestrator'}
  else if(curated.has(number)){workType='curated-master-data';route='curated-master-data-governance'}
  else if(source.has(number)){workType='source-data';route='source-data-session'}
  else if(application.has(number)){workType='application-data';route='application-session'}
  else if(documentation.has(number)){workType='documentation';route='repo-maintenance'}
  else if(security.has(number)){workType='security-settings';route='owner-only'}

  let status='ready'
  if(blocked.has(number))status='blocked'
  if(ownerDecision.has(number))status='owner-decision'
  if(answeredReady.has(number))status='ready'
  if(staleToClose.has(number)&&route!=='owner-only')status='ready'
  if(route==='owner-only')status='owner-decision'
  if(number===817)status='blocked'
  if(number===531){workType='repo-maintenance';route='owner-only'}
  if(number===768){workType='repo-maintenance';route='repo-maintenance'}
  if(number===769){workType='documentation';route='repo-maintenance'}
  if(number===810){workType='repo-maintenance';route='repo-maintenance'}
  if(number===815){workType='documentation';route='repo-maintenance'}
  if(number===898){workType='structural';route='shared-db-orchestrator'}
  const objects=structural.get(number)??[]
  return {status,workType,route,priority:prior.priority,dependencies:prior.dependencies,objects}
}

function block(c){
  return ['```db-work-scope',`status: ${c.status}`,`work_type: ${c.workType}`,`route: ${c.route}`,`priority: ${c.priority}`,`depends_on: ${c.dependencies.join(', ')}`,'objects:',...c.objects.map(x=>`  - ${x}`),'```'].join('\n')
}

const plan=[]
for(const issue of issues.sort((a,b)=>a.number-b.number)){
  const prior=oldScope(issue.body),classification=classify(issue,prior)
  try{parseQueueScope(block(classification))}catch(error){throw new Error(`#${issue.number}: ${error.message}`)}
  const body=prior.block?issue.body.replace(prior.block,block(classification)):`${issue.body.trimEnd()}\n\n${block(classification)}\n`
  plan.push({number:issue.number,title:issue.title,before:prior.block,after:block(classification),classification,body,removeNeedsAlbert:issue.labels.some(x=>x.name==='needs-albert')&&classification.status!=='owner-decision',closeReason:staleToClose.get(issue.number)??null})
}

console.log(plan.map(x=>`#${x.number} ${x.classification.status} | ${x.classification.workType} | ${x.classification.route}${x.closeReason?' | CLOSE STALE':''}`).join('\n'))
if(!apply)process.exit(0)

mkdirSync('docs/verification/db-work-routing-20260816',{recursive:true})
writeFileSync('docs/verification/db-work-routing-20260816/routing-before.json',JSON.stringify(plan.map(({number,title,before})=>({number,title,before})),null,2)+'\n')
writeFileSync('docs/verification/db-work-routing-20260816/routing-after.json',JSON.stringify(plan.map(({number,title,after,removeNeedsAlbert,closeReason})=>({number,title,after,removeNeedsAlbert,closeReason})),null,2)+'\n')

for(const item of plan){
  const live=json(['issue','view',String(item.number),'--repo',REPO,'--json','body,state'])
  const expected=issues.find(x=>x.number===item.number)
  if(live.state!=='OPEN'||live.body!==expected.body)throw new Error(`#${item.number} changed after planning; no overwrite attempted`)
  gh(['api','-X','PATCH',`repos/${REPO}/issues/${item.number}`,'-f',`body=${item.body}`])
  if(item.removeNeedsAlbert)gh(['issue','edit',String(item.number),'--repo',REPO,'--remove-label','needs-albert'])
  if(item.closeReason)gh(['issue','close',String(item.number),'--repo',REPO,'--comment',`Routing audit 2026-08-16: closed as answered or superseded. ${item.closeReason}`])
}
