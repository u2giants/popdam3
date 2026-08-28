#!/usr/bin/env node
import { execFileSync } from 'node:child_process'

export const PROJECT_REFS=Object.freeze({production:'qsllyeztdwjgirsysgai',preview:'mvpkijzfmfcxhnzqogzs'})
export const APPLIED_VERSIONS_SQL='select version from supabase_migrations.schema_migrations order by version'
export class Unknown extends Error {}

export async function fetchAppliedVersions(projectRef,token=process.env.SUPABASE_ACCESS_TOKEN,{fetchImpl=fetch}={}){
  if(!/^[a-z]{20}$/.test(String(projectRef??'')))throw new Unknown('project ref must be exactly 20 lowercase letters')
  if(!token)throw new Unknown('SUPABASE_ACCESS_TOKEN is not set, so the migration ledger could not be read. This is NOT "no drift" — nothing was compared.')
  let response;try{response=await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:APPLIED_VERSIONS_SQL})})}catch(error){throw new Unknown(`could not reach the Supabase Management API: ${error.message}`)}
  const body=await response.text();if(!response.ok)throw new Unknown(`Supabase Management API returned ${response.status} for project ${projectRef}: ${body.slice(0,500)}`)
  let rows;try{rows=JSON.parse(body)}catch{throw new Unknown(`Supabase Management API did not return JSON for project ${projectRef}`)}
  if(!Array.isArray(rows))throw new Unknown(`Supabase Management API returned ${typeof rows}, not a row array`)
  return rows.map((row)=>{if(!row||row.version===undefined||row.version===null)throw new Unknown('a ledger row came back without a `version` column');return String(row.version)})
}

export function readRepoVariable(name,{executor=execFileSync}={}){
  try{return executor('gh',['variable','get',name,'--repo','u2giants/shared-db'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}catch(error){throw new Unknown(`repository variable ${name} is unavailable: ${error.message}`)}
}

export async function readPreviewLedger({readRepoVariable:readVariable=readRepoVariable,fetchAppliedVersions:fetchVersions=fetchAppliedVersions}={}){
  const projectRef=await readVariable('PREVIEW_PROJECT_REF')
  if(!/^[a-z]{20}$/.test(String(projectRef??'')))throw new Unknown('PREVIEW_PROJECT_REF must be exactly 20 lowercase letters')
  if(projectRef===PROJECT_REFS.production)throw new Unknown('PREVIEW_PROJECT_REF equals production; refusing the read')
  if(PROJECT_REFS.preview&&projectRef!==PROJECT_REFS.preview)throw new Unknown('PREVIEW_PROJECT_REF disagrees with the checked-in preview cross-check')
  const versions=await fetchVersions(projectRef)
  if(!Array.isArray(versions)||versions.length===0)throw new Unknown('preview ledger is empty or unreadable')
  if(versions.some((version)=>!/^\d{14}$/.test(String(version))))throw new Unknown('preview ledger returned a malformed version')
  return {projectRef,versions:[...new Set(versions.map(String))].sort()}
}
