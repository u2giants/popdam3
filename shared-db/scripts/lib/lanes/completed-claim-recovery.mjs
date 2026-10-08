// Administrative release of one registered, completed foreign structural claim.
// This never grants application acceptance and never edits the old worktree.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {LaneError,parseAuthorLease} from './claims.mjs';
import {claimWorkIssue} from './claim-maintenance.mjs';
import {normalizeObject} from '../../check-dispatch-collision.mjs';
import {findCompletionRecord} from '../work-dependencies.mjs';
export const recoveryDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const RECOVERY_CODE_PATHS=Object.freeze(['scripts/manage-migration-author-lanes.mjs','scripts/lib/lanes/completed-claim-recovery.mjs','scripts/query-completed-claim-catalog.mjs','scripts/proofs/shared-db-2870-observation.mjs','scripts/lib/lanes/claims.mjs','scripts/lib/lanes/claim-maintenance.mjs','scripts/lib/lanes/constants.mjs','scripts/lib/lanes/holds-and-refs.mjs','scripts/lib/lanes/review-approval.mjs','scripts/lib/lanes/review-records.mjs','scripts/lib/review-verdict.mjs','scripts/lib/review-verdict-artifact.mjs','scripts/lib/repository-identity.mjs','scripts/lib/work-dependencies.mjs','scripts/check-dispatch-collision.mjs','scripts/lib/session-authority.mjs','scripts/lib/authority-token-read.mjs','scripts/lib/lanes/github-wire.mjs','scripts/lib/github-transport.mjs','scripts/lib/claim-recovery-dependencies.mjs','config/review-carry-forward-stored-hashes-v1.json']);
export const RECOVERY_PROJECT='qsllyeztdwjgirsysgai';
export const RECOVERY_PROFILE=Object.freeze({issue:3400,version:'20260928182014',path:'supabase/migrations/20260928182014_hts_product_phrase_columns.sql',preservationBaseSha:'36d26a393ec311b416023fd21a543310165e6ca2',objects:['table dflow_prod."RFQItem"','table dflow_prod."itemHeader"','table plm."RFQItem"','table plm."itemHeader"']});
export const expectedRecoveryCatalog={version:RECOVERY_PROFILE.version,installed:true,columns:['dflow_prod','plm'].flatMap(schema=>['RFQItem','itemHeader'].flatMap(table=>['hts_product_phrase','hts_product_phrase_at','hts_product_phrase_source'].map(name=>({schema,table,name,type:name.endsWith('_at')?'timestamp with time zone':'text',nullable:'YES',default:null}))))};
export const RECOVERY_SQL=`select jsonb_build_object('version','20260928182014','installed',exists(select 1 from supabase_migrations.schema_migrations where version='20260928182014'),'columns',(select jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'name',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) order by table_schema,table_name,column_name) from information_schema.columns where table_schema in ('plm','dflow_prod') and table_name in ('itemHeader','RFQItem') and column_name in ('hts_product_phrase','hts_product_phrase_source','hts_product_phrase_at'))) as catalog, clock_timestamp() as observed_at`;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{40}$/;
const HASH=/^[0-9a-f]{64}$/;
const refuse=message=>{throw new LaneError(`completed-claim recovery refused: ${message}`)};
export function validateRecoveryManifest(m){
 const fields=['schema_version','claim','work_issue','old_owner','actor','claim_body_sha256','source_pr','source_head_sha','merge_sha','main_sha','preservation_commit_sha','pending_sql_sha256','pending_patch_sha256','catalog_sha256','tool_commit_sha','preservation_base_sha'];
 if(!m||Object.keys(m).length!==fields.length||fields.some(k=>!Object.hasOwn(m,k)))refuse('exact manifest fields required');
 if(m.schema_version!==1||m.work_issue!==RECOVERY_PROFILE.issue||![m.claim,m.source_pr].every(x=>Number.isSafeInteger(x)&&x>0)||!UUID.test(m.actor)||typeof m.old_owner!=='string'||!m.old_owner||m.actor===m.old_owner)refuse('registered work and distinct session identities required');
 for(const k of ['source_head_sha','merge_sha','main_sha','preservation_commit_sha','tool_commit_sha','preservation_base_sha'])if(!SHA.test(m[k]))refuse(`invalid ${k}`);
 for(const k of ['claim_body_sha256','pending_sql_sha256','pending_patch_sha256','catalog_sha256'])if(!HASH.test(m[k]))refuse(`invalid ${k}`);
 if(m.preservation_base_sha!==RECOVERY_PROFILE.preservationBaseSha)refuse('registered published preservation base required');
 return m;
}
export function proveCompletedClaimRecovery(manifest,{now=new Date(),reviewIssue,reviewPr,reviewHeadSha},io){
 if(io.repository!=='popcre/shared-db')refuse('canonical shared-db repository authority required');
 const m=validateRecoveryManifest(manifest),authority=io.sessionAuthority();
 if(!authority?.live||authority.task!==m.actor||authority.calling_task!==m.actor)refuse('current declared session authority required');
 const claim=io.getIssue(m.claim),lease=parseAuthorLease(claim?.body??'',now);
 if(claim?.state!=='open'||claimWorkIssue(claim)!==m.work_issue||recoveryDigest(claim.body)!==m.claim_body_sha256)refuse('exact open claim body required');
 if(lease.legacy||lease.active||lease.owner!==m.old_owner||lease.version!==RECOVERY_PROFILE.version||lease.capacityState!=='expired-unconfirmed')refuse('exact expired foreign lease required');
 if(!isDeepStrictEqual([...lease.objects].sort(),RECOVERY_PROFILE.objects.map(normalizeObject).sort()))refuse('registered exact object claims required');
 const work=io.getIssue(m.work_issue);if(work?.state!=='closed')refuse('linked work must be closed');
 const completion=findCompletionRecord(io.issueComments(m.work_issue),{requireTrustedAuthor:true,repository:'popcre/shared-db'});
 if(!completion||completion.work_issue!==m.work_issue||completion.outcome!=='live_verified'||completion.pr!==m.source_pr||completion.merge_sha!==m.merge_sha)refuse('trusted linked completed-shape record required; no application acceptance is inferred');
 const pr=io.getPr(m.source_pr);if(pr?.state!=='closed'||!pr.merged_at||pr.head?.sha!==m.source_head_sha||pr.head?.ref!==lease.branch||pr.merge_commit_sha!==m.merge_sha)refuse('exact merged source PR required');
 const actualMain=io.mainSha();
 const contains=sha=>{const x=io.compareCommits(sha,actualMain);return x?.behind_by===0&&['identical','ahead'].includes(x.status)};
 if(!SHA.test(actualMain??'')||![m.main_sha,m.merge_sha,m.tool_commit_sha].every(contains))refuse('fresh main must descend from manifest, source merge and reviewed tool');
 // The registered base was published on the claim's source branch after the merge; it is not on main.
 const published=io.compareCommits(m.preservation_base_sha,lease.branch);if(published?.behind_by!==0||!['identical','ahead'].includes(published?.status))refuse('registered preservation base must be published on the claim source branch');
 if(!io.recoveryCodeUnchanged(m.tool_commit_sha,actualMain))refuse('registered recovery code/profile must match reviewed merged tool bytes');
 const files=io.getPrFiles(m.source_pr);if(files.filter(x=>/^supabase\/migrations\//.test(x.filename)).length!==1||!files.some(x=>x.filename===RECOVERY_PROFILE.path&&x.status==='added'))refuse('exact source migration required');
 if(io.branchPulls(lease.branch).some(x=>x.state==='open'))refuse('source branch has open PR');
 const saved=io.recoverySnapshot(m.preservation_commit_sha);if(!saved||Object.keys(saved).sort().join('|')!=='catalog.json|pending.patch|pending.sql')refuse('exact immutable sanitized preservation commit required');
 for(const [file,key] of [['pending.sql','pending_sql_sha256'],['pending.patch','pending_patch_sha256'],['catalog.json','catalog_sha256']])if(recoveryDigest(saved[file])!==m[key])refuse(`preservation ${file} digest mismatch`);
 let catalog;try{catalog=JSON.parse(saved['catalog.json'])}catch{refuse('invalid catalog JSON')}
 if(catalog.project_ref!==RECOVERY_PROJECT||!isDeepStrictEqual(catalog.catalog,expectedRecoveryCatalog))refuse('immutable catalog facts mismatch');
 const foreign=io.foreignSnapshot(lease.worktree,RECOVERY_PROFILE.path);
 if(!foreign||foreign.changedPaths?.join('|')!==RECOVERY_PROFILE.path||foreign.untracked?.length||foreign.sql!==saved['pending.sql']||foreign.patch!==saved['pending.patch'])refuse('foreign pending bytes changed or incomplete preservation');
 const source=io.sourceMigration(m.preservation_base_sha,RECOVERY_PROFILE.path);
 if(typeof source!=='string'||!source.includes('-- derived-from: none\n')||saved['pending.sql']!==source.replace('-- derived-from: none\n',''))refuse('pending SQL differs from published preservation base minus registered harmless comment deletion');
 if(!Number.isSafeInteger(reviewIssue)||!Number.isSafeInteger(reviewPr)||!SHA.test(reviewHeadSha??''))refuse('exact allocator review identity required');
 if(!io.reviewedManifestMatches({reviewIssue,reviewPr,reviewHeadSha,manifest:m}))refuse('allocator APPROVE must cover exact regular manifest bytes');
 const fresh=io.freshRecoveryCatalog();if(fresh?.project_ref!==RECOVERY_PROJECT||!isDeepStrictEqual(fresh.catalog,expectedRecoveryCatalog)||!Number.isFinite(Date.parse(fresh.observed_at))||Math.abs((io.clock?.()??now).valueOf()-Date.parse(fresh.observed_at))>120000)refuse('fresh authenticated production target/catalog/version required');
 return {schema_version:1,kind:'completed-foreign-claim-release',claim:m.claim,work_issue:m.work_issue,actor:m.actor,old_owner:m.old_owner,manifest_sha256:recoveryDigest(JSON.stringify(m)),preservation_commit_sha:m.preservation_commit_sha,preservation_base_sha:m.preservation_base_sha,source_pr:m.source_pr,source_head_sha:m.source_head_sha,merge_sha:m.merge_sha,main_sha:actualMain,manifest_main_sha:m.main_sha,tool_commit_sha:m.tool_commit_sha,version:lease.version,review_issue:reviewIssue,review_pr:reviewPr,review_head_sha:reviewHeadSha,project_ref:RECOVERY_PROJECT,observed_at:fresh.observed_at,application_acceptance:false};
}
export function recoverCompletedForeignClaim(manifest,options,io){
 // Caller owns the coordination mutex. Reprove inside it; no predecessor identity is used as actor.
 const receipt=proveCompletedClaimRecovery(manifest,options,io);const closureMain=receipt.main_sha;
 io.assertMutex();const ref=`refs/db-claim-recoveries/${receipt.version}`;
 const previous=io.readRef(ref);let sha;
 if(previous){const prior=io.readRecoveryReceipt(previous);const {observed_at:priorObserved,main_sha:priorMain,...priorIdentity}=prior;const {observed_at:newObserved,main_sha:newMain,...newIdentity}=receipt;if(!Number.isFinite(Date.parse(priorObserved))||!isDeepStrictEqual(priorIdentity,newIdentity))refuse('conflicting immutable recovery receipt');const ancestry=io.compareCommits(priorMain,closureMain);if(ancestry?.behind_by!==0||!['identical','ahead'].includes(ancestry.status))refuse('retry main does not descend from immutable receipt');sha=previous;receipt.observed_at=priorObserved;receipt.main_sha=priorMain}
 else{sha=io.makeOwnerCommit(`db-coordination completed-foreign-claim-release ${JSON.stringify(receipt)}`);if(!io.createRef(ref,sha)||io.readRef(ref)!==sha)refuse('immutable receipt failed readback')}
 // Most reads above may involve provider I/O. Do not close a concurrently renewed claim or new branch PR.
 if(recoveryDigest(io.getIssue(manifest.claim)?.body??'')!==manifest.claim_body_sha256||io.branchPulls(io.getPr(manifest.source_pr).head.ref).some(x=>x.state==='open')||io.mainSha()!==closureMain)refuse('claim/source/main changed after proof');
 const lastClaim=io.getIssue(manifest.claim);
 if(lastClaim?.state!=='open'||io.getIssue(manifest.work_issue)?.state!=='closed')refuse('claim/work state changed after proof');
 const lastPr=io.getPr(manifest.source_pr);
 if(lastPr?.state!=='closed'||!lastPr.merged_at||lastPr.head?.sha!==manifest.source_head_sha||lastPr.merge_commit_sha!==manifest.merge_sha)refuse('merged source changed after proof');
 const foreign=io.foreignSnapshot(parseAuthorLease(lastClaim.body,options.now).worktree,RECOVERY_PROFILE.path);
 if(foreign?.changedPaths?.join('|')!==RECOVERY_PROFILE.path||foreign?.untracked?.length||recoveryDigest(foreign?.sql??'')!==manifest.pending_sql_sha256||recoveryDigest(foreign?.patch??'')!==manifest.pending_patch_sha256)refuse('foreign pending bytes changed after proof');
 io.assertMutex();io.closeClaim(manifest.claim,`Completed foreign claim released by reviewed administrative recovery; source migration is merged and installed. Immutable receipt ${ref} at ${sha}. Application acceptance was not changed. Recovery actor ${manifest.actor}; previous owner ${manifest.old_owner}.\n\nPosted by ${io.signatureEngine()} chat ${manifest.actor} on ${io.machineName()}`);
 return {claim:manifest.claim,released:true,ref,sha,current_main_sha:closureMain,receipt};
}
