// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { parseAbandonmentAudit, MODE_SEQUENCE, readyRecord, terminalizeReady } from '../../orchestrator-flow/reconcile.mjs'
import { execFileSync } from 'node:child_process'
import { sha256, canonicalJson, buildEvidenceBundle } from '../../orchestrator-flow/evidence-bundle.mjs'
import { bindSenderPreviewClassification, validatePreviewClassification, databasePreviewRequiredFromEvidenceBundle, selectPreviewRoute } from '../../orchestrator-flow/select-preview-route.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { inspectPrStructuralChange, structuralWritesCovered } from '../../orchestrator-flow/admission.mjs'
import { LaneError, parseAuthorLease } from './claims.mjs'
import { parseQueueScope } from './queue-routing.mjs'
import { REPO } from './constants.mjs'
import { claimTitleIssues, claimTitleWorkIssue, claimWorkIssue } from './claim-maintenance.mjs'
import { githubIo, main, validateOriginalPreviewApplyEvidence } from '../../manage-migration-author-lanes.mjs'
import { sessionAuthorityRefusal } from '../session-authority.mjs'

// THE CAPACITY HALF OF ONE FLOW SNAPSHOT ROW (issue #2301 Step 4). It is a named
// function rather than an expression inside the snapshot because it now reads
// three separate sources -- the claim's own lease, the work issue's declared
// blocker, and the blocker issue itself -- and a reader has to be able to see
// which fact came from where before trusting a relinquish suggestion built on it.
export function flowCapacityFacts(claim,issue,now,io,queuedBehindFor=()=>null){
  const lease=parseAuthorLease(claim.body,now)
  const work=io.getIssue(issue)
  const declared=/^blocked_on:\s*(issue:#\d+|artifact:[^\s]+)\s*$/m.exec(work?.body??'')?.[1]??null
  const reference=declared??lease.blockedOn
  let blocker=null
  if(reference){
    blocker={durable:true,reference,resolved:false,state:null,work_type:null,audit:null}
    const number=/^issue:#(\d+)$/.exec(reference)?.[1]
    if(number){
      const blockerIssue=io.getIssue(Number(number))
      blocker.state=blockerIssue?.state??null
      blocker.resolved=blockerIssue?.state==='closed'
      // A blocker's work_type comes from its OWN scope fence. An absent or
      // unreadable fence leaves this null, and null is not `repo-maintenance`,
      // so an unparseable blocker can never be read as abandonment evidence.
      try{blocker.work_type=parseQueueScope(blockerIssue?.body??'')?.workType??null}catch{blocker.work_type=null}
      blocker.audit=parseAbandonmentAudit(blockerIssue?.body??'')
    }
  }
  const facts={owner:lease.owner,capacity_state:lease.capacityState,blocker,expired_claim:null}
  if(lease.capacityState!=='expired-unconfirmed')return facts
  // Only an EXPIRED lane pays for the pull-request lookup, so the cost of the
  // report is bounded by the number of expired lanes, not by every open claim.
  const pulls=io.branchPulls?.(lease.branch)??[]
  const live=pulls.find((pull)=>pull.state==='open')??pulls.find((pull)=>pull.merged_at)??pulls[0]??null
  const expiresAt=lease.expiresAt instanceof Date?lease.expiresAt:lease.expiresAt?new Date(lease.expiresAt):null
  facts.expired_claim={
    claim:Number(claim.number),owner:lease.owner,branch:lease.branch,
    expires_at:expiresAt?expiresAt.toISOString():null,
    expired_for_seconds:expiresAt?Math.max(0,Math.round((now.getTime()-expiresAt.getTime())/1000)):null,
    pr:live?Number(live.number):null,
    pr_state:live?(live.state==='open'?'open':live.merged_at?'merged':'closed-unmerged'):'none',
    head_sha:live?(String(live.head?.sha??'').toLowerCase()||null):null,
    queued_behind:queuedBehindFor(claim.number),
  }
  return facts
}

export function livePreviewLedger({workflowPreviewRef}={}){
  const ledgerOptions=workflowPreviewRef===undefined?'':'{readRepoVariable:(name)=>readRepoVariable(name,{workflowPreviewRef:process.env.AUDIT_WORKFLOW_PREVIEW_REF})}'
  const code=`import {readPreviewLedger,readRepoVariable} from './scripts/orchestrator-flow/read-preview-ledger.mjs';try{console.log(JSON.stringify(await readPreviewLedger(${ledgerOptions})))}catch(e){console.error(e.message);process.exit(2)}`
  const env=workflowPreviewRef===undefined?process.env:{...process.env,AUDIT_WORKFLOW_PREVIEW_REF:String(workflowPreviewRef)}
  try{return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env}))}catch(error){throw new LaneError(`fresh preview ledger is unavailable (${String(error.stderr??error.message).trim()})`)}
}
export function deriveLiveNoDatabasePreview(issue,io){
  const evidence=io.databasePreviewClassification?.(issue)
  if(evidence===null||evidence===undefined)return null
  const admission=databasePreviewAdmission({preparePreviewDispatch:Number(issue),issue:Number(issue),pr:evidence.pr},io)
  if(admission.decision!=='NO_DATABASE_PREVIEW')return null
  return {...admission,route:'no_database_preview',route_context:''}
}

export function databasePreviewAdmission(options,io){
  const guarded=Boolean(options.claim||options.assignReviewer||options.acquireExclusive||options.preparePreviewDispatch||options.repairPreviewReady||options.reconcileFlow)
  if(!guarded)return {guarded:false,decision:'NOT_APPLICABLE'}
  if(io.databasePreviewClassificationEvidence===undefined||io.databasePreviewClassificationEvidence===null)return {guarded:true,decision:'DATABASE_PREVIEW_REQUIRED',reason:'no no-database-preview evidence was supplied; structural admission remains required'}
  const issue=Number(options.issue??options.preparePreviewDispatch)
  if(!Number.isInteger(issue)||issue<=0)throw new LaneError('supplied database preview evidence requires an exact --issue for this admission command')
  const supplied=io.databasePreviewClassification(issue)
  const sender=supplied?.decision!==undefined&&supplied?.database_preview===undefined
  const evidence=sender?{repository:REPO,issue,pr:Number(options.pr),base_sha:supplied.base_sha,head_sha:supplied.head_sha,database_preview:supplied,bundle_id:'0'.repeat(64)}:supplied
  if(evidence?.repository!==REPO||!Number.isInteger(evidence?.pr)||evidence.pr<=0||Number(options.pr)!==evidence.pr||!/^[0-9a-f]{40}$/i.test(String(evidence?.base_sha??''))||!/^[0-9a-f]{40}$/i.test(String(evidence?.head_sha??''))||!/^[0-9a-f]{64}$/.test(String(evidence?.bundle_id??'')))throw new LaneError('database preview evidence requires the exact command repository, PR, base, head, and bundle identities')
  if(options.headSha!==undefined&&String(options.headSha)!==evidence.head_sha)throw new LaneError('database preview evidence head does not match the command request')
  let live
  try{live=io.getPr(evidence.pr)}catch(error){throw new LaneError(`live pull request identity is unreadable: ${error.message}`)}
  if(!live||live.number!==evidence.pr||live.state!=='open'||live.base?.repo?.full_name!==REPO||live.base?.sha!==evidence.base_sha||live.head?.sha!==evidence.head_sha)throw new LaneError('database preview evidence does not match the authenticated live pull request repository, base, and head')
  let inspectedFiles
  try{inspectedFiles=io.databasePreviewFileSnapshot(evidence.pr,evidence.base_sha,evidence.head_sha)}catch(error){throw new LaneError(`authenticated live changed-file evidence is unreadable: ${error.message}`)}
  let finalLive
  try{finalLive=io.getPr(evidence.pr)}catch(error){throw new LaneError(`final live pull request identity is unreadable: ${error.message}`)}
  if(!finalLive||finalLive.number!==evidence.pr||finalLive.state!=='open'||finalLive.base?.repo?.full_name!==REPO||finalLive.base?.sha!==evidence.base_sha||finalLive.head?.sha!==evidence.head_sha)throw new LaneError('pull request moved while authenticated changed-file evidence was read')
  const liveBundleId=sha256(canonicalJson({repository:REPO,pr:evidence.pr,base_sha:evidence.base_sha,head_sha:evidence.head_sha,files:inspectedFiles}))
  if(sender){
    evidence.database_preview=bindSenderPreviewClassification(supplied,inspectedFiles,{repository:REPO,issue,pr:evidence.pr,base_sha:evidence.base_sha,head_sha:evidence.head_sha})
    evidence.bundle_id=liveBundleId
  }
  if(evidence.bundle_id!==liveBundleId)throw new LaneError('database preview bundle identity does not match authenticated live Git files')
  const claimedImpacts=new Map((evidence.database_preview?.files??[]).map((file)=>[file.path,file.impact]))
  if(inspectedFiles.some((file)=>claimedImpacts.get(file.path)!==file.impact))throw new LaneError('database preview impact classification does not match authenticated live file content')
  let classification
  try{classification=validatePreviewClassification(evidence.database_preview,inspectedFiles,{repository:REPO,issue,pr:evidence.pr,base_sha:evidence.base_sha,head_sha:evidence.head_sha})}
  catch(error){throw new LaneError(`database preview classification is unverifiable: ${error.message}`)}
  if(classification.decision==='NO_DATABASE_PREVIEW')return {guarded:true,decision:classification.decision,reason:'exact inspected inputs prove no database preview is applicable',next_action:'return-to-natural-owner',issue,pr:evidence.pr,base_sha:evidence.base_sha,head_sha:evidence.head_sha,bundle_id:evidence.bundle_id,classification_digest:classification.inspected_digest,applicable_checks:classification.applicable_checks}
  return {guarded:true,decision:'DATABASE_PREVIEW_REQUIRED',reason:classification.reason_code}
}

export function readDatabasePreviewClassificationFile(file,{reader=readFileSync}={}){
  if(typeof file!=='string'||!file.trim())throw new LaneError('database preview classification file path is required')
  let parsed
  try{parsed=JSON.parse(reader(file,'utf8'))}catch(error){throw new LaneError(`database preview classification file is unreadable: ${error.message}`)}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new LaneError('database preview classification file must contain exactly one evidence object')
  return parsed
}

export function withDatabasePreviewClassificationFile(io,file,options={}){
  return {...io,databasePreviewClassificationEvidence:readDatabasePreviewClassificationFile(file,options)}
}
export function deriveLivePreviewCandidate(issue,io,{claimNumber=null}={}){
  const noDatabasePreview=deriveLiveNoDatabasePreview(issue,io)
  if(noDatabasePreview)return noDatabasePreview
  const claims=io.openClaims().map((claim)=>({claim,lease:parseAuthorLease(claim.body)}));for(const row of claims){const titleIssues=claimTitleIssues(row.claim);if(titleIssues.includes(issue)&&titleIssues.length!==1)throw new LaneError(`open claim #${row.claim.number} ambiguously identifies work issue #${issue}`)}const owned=claims.filter((row)=>claimTitleWorkIssue(row.claim)===issue),allClosed=owned.length===0?(io.closedClaimsForWork?.(issue)??[]).map((claim)=>({claim,lease:parseAuthorLease(claim.body)})):[],closed=claimNumber===null?allClosed:allClosed.filter((row)=>Number(row.claim.number)===Number(claimNumber));if(owned.length>1)throw new LaneError(`work issue #${issue} must have exactly one live protected claim`);if(claimNumber!==null&&owned.length===0&&closed.length!==1)throw new LaneError(`closed claim #${claimNumber} is not a unique historical claim for work issue #${issue}`);for(const row of closed)if(claimWorkIssue(row.claim)!==issue)throw new LaneError(`closed claim #${row.claim.number} title does not identify work issue #${issue}`);for(const row of closed)if(io.openPulls().some((pr)=>pr.head?.ref===row.lease.branch))throw new LaneError(`closed claim #${row.claim.number} cannot recover while its pull request is still open`)
  const recoverable=closed.filter((row)=>{const merged=(io.branchPulls?.(row.lease.branch)??[]).filter((pr)=>pr.head?.ref===row.lease.branch&&pr.merged_at&&pr.merge_commit_sha);if(merged.length>1)throw new LaneError(`closed claim #${row.claim.number} has multiple merged pull requests`);if(merged.length===1&&!io.mergeCommitInMain(merged[0].merge_commit_sha))throw new LaneError(`merged claim #${row.claim.number} merge commit ${merged[0].merge_commit_sha} is not in main history`);return merged.length===1});if(owned.length===0&&recoverable.length!==1)throw new LaneError(`work issue #${issue} has ${recoverable.length} recoverable closed claims; historical recovery requires exactly one${recoverable.length>1?' or an explicit --claim-number <claim> selector':''}`);const recoveredClosed=owned.length===0,{claim,lease}=recoveredClosed?recoverable[0]:owned[0],pulls=io.openPulls().filter((pr)=>pr.head?.ref===lease.branch)
  // Merge-first (AGENTS.md section 4 rule 2): once the claim PR merges there is no open
  // pull request left, and the rehearsal still owes proof. Fall back to the merged pull
  // request on the same branch and drive the POST_MERGE_REHEARSAL route from it.
  let merged=false,mergeCommit=null,pr
  if(pulls.length===1){pr=pulls[0]}
  else if(pulls.length===0){
    const closed=(io.branchPulls?.(lease.branch)??[]).filter((row)=>row.head?.ref===lease.branch&&row.merged_at&&row.merge_commit_sha)
    if(closed.length!==1)throw new LaneError(`claim #${claim.number} must have exactly one live pull request`)
    pr=closed[0];merged=true;mergeCommit=pr.merge_commit_sha
    // The merge commit is NOT where the rehearsal is anchored -- commit_sha below is the
    // current main tip. It is checked here only as proof that this claim really merged
    // into main, which is what makes the post-merge route legitimate at all.
    if(!io.mergeCommitInMain(mergeCommit))throw new LaneError(`merged claim #${claim.number} merge commit ${mergeCommit} is not in main history`)
  }
  else throw new LaneError(`claim #${claim.number} must have exactly one live pull request`)
  const head=pr.head.sha,prFiles=io.getPrFiles(pr.number),changed=prFiles.filter((file)=>file.status!=='removed').map((file)=>file.filename)
  const migrations=changed.filter((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(file)),versions=migrations.map((file)=>path.basename(file).slice(0,14))
  if(!migrations.length)throw new LaneError('pull request has no added migration to prepare')
  for(const row of claims)if(claimTitleWorkIssue(row.claim)===null&&versions.includes(row.lease.version))throw new LaneError(`open claim #${row.claim.number} with an invalid title protects recovery version ${row.lease.version}`)
  const inventory=JSON.parse(io.getFileAt('config/orchestrator-global-invalidators-v1.json',head)),allFiles=new Set([...migrations,...changed.filter((file)=>/^(?:supabase\/tests\/|scripts\/production-verification-sidecars\/)/.test(file)),...inventory.files,'config/orchestrator-global-invalidators-v1.json'])
  const contents=new Map([...allFiles].map((file)=>[file,io.getFileAt(file,head)])),headTree=io.treeFiles(head),order=headTree.filter((file)=>/^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(file)).sort()
  // Preview readiness is structural evidence: classify the migration SQL itself, never its filename, and bind it to the claim's writes.
  const structural=inspectPrStructuralChange(prFiles.filter((file)=>migrations.includes(file.filename)).map((file)=>({...file,content:contents.get(file.filename)}))),leaseWrites=[...(lease.writes??[])].sort()
  if(!structuralWritesCovered(structural,leaseWrites))throw new LaneError(`pull request #${pr.number} structural objects are not all covered by claim #${claim.number} writes; preview preparation refused`)
  const bundle=buildEvidenceBundle({migrations,focusedFiles:changed.filter((file)=>file.startsWith('supabase/tests/')),verificationFiles:changed.filter((file)=>file.startsWith('scripts/production-verification-sidecars/')),writes:lease.writes,reads:lease.reads,migrationOrderDigest:sha256(canonicalJson(order)),issue,pr:pr.number,claim:claim.number,baseMainSha:pr.base.sha,integrationSha:head},{isClean:()=>true,fileExists:(file)=>contents.has(file),readFile:(file)=>contents.get(file)})
  const work=io.getIssue(issue),scope=parseQueueScope(work?.body??'')
  if(!scope)throw new LaneError(`issue #${issue} has no db-work-scope block; add exactly one before preparing preview dispatch`)
  const gate=io.previewGateProof(issue,pr.number,head,bundle.bundle_id,scope.dependencies)
  const main=io.mainSha(),mainVersions=io.treeFiles(main).filter((file)=>/^supabase\/migrations\/\d{14}_/.test(file)).map((file)=>path.basename(file).slice(0,14)),preview=io.previewLedger?.()??livePreviewLedger(),originalApplyEvidence=versions.every((version)=>preview.versions.includes(version))?validateOriginalPreviewApplyEvidence({issue,pr:pr.number,versions,mergeCommitSha:merged?pr.merge_commit_sha:null,claimHeadSha:head},io):null
  const claimRows=claims.map((row)=>{const linked=io.openPulls().find((p)=>p.head?.ref===row.lease.branch);return{issue:claimTitleWorkIssue(row.claim),pr:linked?.number??0,versions:[row.lease.version],merged:false}}).filter((row)=>row.pr&&row.issue!==null)
  const databasePreview=databasePreviewRequiredFromEvidenceBundle(bundle)
  const route=selectPreviewRoute({repository:REPO,issue,pr:pr.number,base_sha:pr.base.sha,head_sha:head,bundle_id:bundle.bundle_id,database_preview:databasePreview,inspected_files:databasePreview.files.map(({path,sha256})=>({path,sha256})),versions,dependency_closure_complete:gate.dependency_closure_complete,claims:claimRows,main_versions:mainVersions,preview_versions:preview.versions,original_apply_evidence:originalApplyEvidence,merged})
  if(route.status!=='READY')throw new LaneError(`preview route is ${route.status}: ${route.reason}`)
  const routeName=route.route==='NORMAL_PREVIEW'?'ordinary_preview_apply':route.route==='POST_MERGE_REHEARSAL'?'merged_rehearsal':'historical_rebind'
  const routeContext=routeName==='ordinary_preview_apply'?'':main
  // commit_sha is the CURRENT MAIN TIP the rehearsal runs at -- shared-supabase-migrations
  // asserts `git rev-parse origin/main` equals it. That is a different thing from the
  // historical-recovery lane's producer-file pin at the authoring merge commit; conflating
  // the two emits a manifest the workflow refuses.
  //
  // A merged rehearsal must NOT name claim_pr: "merged_preview_source_pr replaces claim_pr.
  // A merged pull request has no live author claim; do not name both."
  const claimFields=routeName==='merged_rehearsal'?{}:{claim_pr:String(pr.number),claim_head_sha:head}
  const manifest={target:'preview',preview_allowlist:versions.join(','),...claimFields,...(routeName==='merged_rehearsal'?{commit_sha:main,merged_preview_source_pr:String(pr.number)}:{}),...(routeName==='historical_rebind'?{commit_sha:main,historical_preview_source_pr:String(pr.number),historical_preview_original_run_map:versions.map((version)=>`${version}:${originalApplyEvidence.run_id}`).join(',')}:{})}
  // THE STORED INSTRUCTION MUST NAME ITS OWN MODES (#2796). The workflow's `mode`
  // input defaults to dry-run, so an instruction that says nothing about mode gets
  // dispatched verbatim and DRY-RUNS: it succeeds, uploads only
  // `preview-migration-dry-run-<sha>`, applies nothing, and every downstream lane
  // then reads that green run as preview proof. Run 34633793571 is exactly that.
  //
  // The mode is emitted BESIDE the manifest, never inside it. Phase 2 is explicit
  // that "`mode` is a per-run phase, not part of ready identity or frozen-manifest
  // equality", so folding it into the manifest would change manifest_digest and
  // ready_id and freeze a phase into immutable identity.
  //
  // The sequence is route-specific, matching the existing workflow: ordinary and
  // merged rehearsals "run `mode=dry-run` then `mode=apply`", while historical
  // rebind "runs the existing recovery `mode=apply` only and must never dispatch a
  // historical-input dry-run". A historical dry-run is refused outright by the
  // workflow; the ordinary/merged dry-run is a REQUIRED first phase and stays legal.
  // One source of truth, shared with the reconciler that re-derives it from the
  // route when the record is read back, so the two layers cannot drift.
  const modeSequence=MODE_SEQUENCE[routeName]
  return {issue,pr:pr.number,head_sha:head,bundle_id:bundle.bundle_id,route:routeName,route_context:routeContext,mode_sequence:modeSequence,manifest}
}

export function terminalizeHistoricalPreviewReady({readyId,issue,runId,artifactId,artifactDigest,manifestDigest},io=githubIo){
  if(!/^[0-9a-f]{64}$/i.test(String(readyId??''))||!/^\d+$/.test(String(issue??''))||!/^\d+$/.test(String(runId??''))||!/^\d+$/.test(String(artifactId??''))||!/^sha256:[0-9a-f]{64}$/i.test(String(artifactDigest??''))||!/^[0-9a-f]{64}$/i.test(String(manifestDigest??'')))throw new LaneError('historical preview terminalization requires exact ready id, issue, run id, artifact id, artifact digest, and manifest digest')
  if(typeof io.orchestratorFlowAdapter!=='function'||typeof io.previewApplyRun!=='function')throw new LaneError('historical preview terminalization runtime adapter is unavailable')
  const flow=io.orchestratorFlowAdapter(),marker=flow.resolveMarker?.()
  if(!marker?.live||marker.calling_task!==marker.task)throw new LaneError(sessionAuthorityRefusal(marker))
  const readyRef=`refs/db-preview-ready/${readyId}`,outcomeRef=`refs/db-preview-ready-outcomes/${readyId}`,stored=flow.readRef(readyRef),record=stored?.record
  let normalized;try{normalized=readyRecord(record??{})}catch{throw new LaneError('live historical preview-ready record does not exactly match the requested immutable identity')}
  if(stored?.digest!==sha256(canonicalJson(record??{}))||normalized.ready_id!==readyId||record?.ready_id!==readyId||Number(record?.issue)!==Number(issue)||record?.route!=='historical_rebind'||record?.manifest_digest!==manifestDigest||sha256(canonicalJson(record?.manifest??{}))!==manifestDigest)throw new LaneError('live historical preview-ready record does not exactly match the requested immutable identity')
  if(record.route_context!==record.manifest.commit_sha||!/^[0-9a-f]{40}$/i.test(String(record.route_context??'')))throw new LaneError('historical preview-ready main binding is invalid')
  const evidence=io.previewApplyRun(String(runId)),run=evidence?.run,artifacts=evidence?.artifacts,logs=String(evidence?.logs??'')
  if(String(run?.id)!==String(runId)||run?.path!=='.github/workflows/shared-supabase-migrations.yml'||run?.event!=='workflow_dispatch'||run?.status!=='completed'||run?.conclusion!=='success'||run?.run_attempt!==1||run?.head_sha!==record.route_context)throw new LaneError('historical recovery run does not exactly match the successful immutable preview-ready dispatch')
  const rows=Array.isArray(artifacts?.artifacts)?artifacts.artifacts:[],artifact=rows.find((row)=>String(row.id)===String(artifactId))
  if(Number(artifacts?.total_count)!==1||rows.length!==1||!artifact||artifact.expired!==false||artifact.digest!==artifactDigest||artifact.name!==`preview-migration-apply-${record.route_context}`||String(artifact.workflow_run?.id)!==String(runId)||artifact.workflow_run?.head_sha!==run.head_sha)throw new LaneError('historical recovery artifact does not exactly match the requested immutable evidence')
  const exactLogValue=(label,value)=>new RegExp(`(?:^|\\n)[^\\n]*${label}:\\s*${String(value).replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(?:\\s|$)`).test(logs)
  if(!exactLogValue('ORIGINAL_RUN_MAP',record.manifest.historical_preview_original_run_map)||!exactLogValue('SOURCE_PR',record.manifest.historical_preview_source_pr)||!exactLogValue('MAIN_SHA',record.manifest.commit_sha)||!exactLogValue('PREVIEW_ALLOWLIST',record.manifest.preview_allowlist))throw new LaneError('historical recovery logs do not match the stored preview-ready manifest')
  const ledgerLines=logs.split(/\r?\n/).flatMap((line)=>{const fields=line.replace(/^\ufeff/,'').split('\t');if(fields.length<3||fields[1]!=='Report the preview ledger delta')return[];return[fields.slice(2).join('\t').replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s*/,'')]})
  const one=(pattern)=>{const matches=ledgerLines.map((line)=>pattern.exec(line)).filter(Boolean);return matches.length===1?matches[0]:null},before=one(/^- rows before:\s*(\d+)\s*$/),after=one(/^- rows after:\s*(\d+)\s*$/)
  if(!before||!after||before[1]!==after[1]||ledgerLines.filter((line)=>/^- added:\s*\(none\)\s*$/.test(line)).length!==1||ledgerLines.filter((line)=>/^- removed:\s*\(none\)\s*$/.test(line)).length!==1)throw new LaneError('historical recovery did not prove an unchanged preview ledger')
  const proof={positive:true,mode:'apply',run_id:String(runId),artifact_id:String(artifactId),artifact_digest:artifactDigest,manifest_digest:manifestDigest,ledger_rows:Number(before[1])}
  const existing=flow.readRef(outcomeRef)
  if(existing&&(existing.digest!=='dispatched'||existing.record?.outcome!=='dispatched'||canonicalJson(existing.record?.proof)!==canonicalJson(proof)))throw new LaneError('historical preview-ready outcome is occupied by different immutable evidence')
  const result=terminalizeReady(readyId,'dispatched',proof,flow),readBack=flow.readRef(outcomeRef)
  if(readBack?.digest!=='dispatched'||readBack.record?.outcome!=='dispatched'||canonicalJson(readBack.record?.proof)!==canonicalJson(proof))throw new LaneError('historical preview-ready outcome readback did not match the exact immutable evidence')
  return {...result,ref:outcomeRef,proof}
}
