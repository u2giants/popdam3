#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectPreviewRoute } from './select-preview-route.mjs'

export class QualificationError extends Error {}

export function pythonDiagnostics(input,{executor=execFileSync}={}){
  const program=`import json,sys\nfrom pathlib import Path\nsys.path.insert(0,'scripts')\nfrom production_business_risk_gate import diagnose_risk_coverage\nfrom production_catalog_verification import diagnose_catalog_coverage\np=json.load(sys.stdin); root=Path(p['repo']); allow=p['allowlist']; print(json.dumps({'risk':diagnose_risk_coverage(root,allow),'catalog':diagnose_catalog_coverage(root,allow)},sort_keys=True))`
  let raw;try{raw=executor('python',['-c',program],{cwd:input.repo,encoding:'utf8',input:JSON.stringify(input),stdio:['pipe','pipe','pipe']})}catch(error){throw new QualificationError(`Python diagnostics failed: ${error.message}`)}
  try{return JSON.parse(raw)}catch{throw new QualificationError('Python diagnostics returned malformed JSON')}
}

export function qualifyChange(input,{diagnostics=pythonDiagnostics,routeSelector=selectPreviewRoute}={}){
  try{
    if(input.file_shape?.supersession_supported!==true)return {status:'BLOCKED',reason:'pull-request file shape is unsupported by guarded supersession/recovery'}
    if(input.dependency_closure?.complete!==true)return {status:'BLOCKED',reason:`migration dependency closure is incomplete: ${(input.dependency_closure?.missing??[]).join(', ')}`}
    if(input.historical_evidence?.compatible!==true)return {status:'BLOCKED',reason:'historical preview evidence type is incompatible with the requested route'}
    const route=routeSelector(input.preview)
    if(route.status==='UNVERIFIABLE')throw new QualificationError(route.reason)
    if(route.status==='WAITING')return {status:'WAITING',reason:route.reason,next_action:'wait-for-preview-dependency',route}
    const result=diagnostics({repo:input.repo,allowlist:input.preview.versions})
    if(result?.catalog?.status!=='covered')return {status:'BLOCKED',reason:'catalog verifier derives no target and no hash-bound sidecar/contract covers the change'}
    if(result?.risk?.status!=='covered')throw new QualificationError('risk diagnostic coverage is unavailable')
    return {status:'QUALIFIED',reason:'route, dependency, risk and catalog coverage are compatible',next_action:'reviewer-assignment',route,diagnostics:result}
  }catch(error){return {status:'UNVERIFIABLE',reason:error.message,next_action:'full-manual-qualification'}}
}

export function main(argv){const index=argv.indexOf('--input');if(index<0||!argv[index+1]){console.error('REFUSED: --input <json> is required');return 2}try{const result=qualifyChange(JSON.parse(readFileSync(argv[index+1],'utf8')));console.log(JSON.stringify(result,null,2));return result.status==='QUALIFIED'||result.status==='WAITING'?0:2}catch(error){console.error(`REFUSED: ${error.message}`);return 2}}
if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1]))process.exitCode=main(process.argv.slice(2))
