// Reuse canonical immutable-ref GitHub transport; never update/delete a ref.
import {githubIo,parseAuthorLease,acquireExclusive,assertExclusive,releaseExclusive} from './manage-migration-coordination.mjs'
import {claimWorkIssue} from './lib/lanes/claim-maintenance.mjs'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {parseQueueScope} from './lib/lanes/queue-routing.mjs'
import {conflicts} from './lib/hold-reason.mjs'
const prefix='db-index-maintenance-v1 '
export function validateRef(ref){
 if(typeof ref!=='string'||!(/^refs\/db-index-maintenance\/[a-z][a-z0-9-]{0,39}\/(preview|production)\/(started|built|swapped|complete)$/.test(ref)||/^refs\/db-index-maintenance-operations\/[a-z][a-z0-9-]{0,39}\/(preview|production)\/[a-f0-9]{40}$/.test(ref)))throw Error('maintenance receipt ref refused')
 return ref
}
export function readReceipt(ref,io=githubIo){
 validateRef(ref);const sha=io.readRef(ref)
 if(sha===null)return null
 const message=io.getCommit(sha)?.message
 if(typeof message!=='string'||!message.startsWith(prefix))throw Error('maintenance receipt content refused')
 const value=JSON.parse(message.slice(prefix.length))
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('maintenance receipt shape refused')
 return value
}
export function createReceipt(ref,value,io=githubIo){
 validateRef(ref)
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('maintenance receipt shape refused')
 const serialized=JSON.stringify(value)
 if(Buffer.byteLength(serialized)>32768)throw Error('maintenance receipt size refused')
 const existing=readReceipt(ref,io)
 if(existing!==null){if(JSON.stringify(existing)!==serialized)throw Error('immutable maintenance receipt conflict');return existing}
 const sha=io.makeOwnerCommit(prefix+serialized)
 if(!io.createRef(ref,sha)||JSON.stringify(readReceipt(ref,io))!==serialized)throw Error('maintenance receipt create/readback refused')
 return value
}
export function verifyMaintenanceClaim(request,io=githubIo){
 if(request?.kind==='health-initial/v1')return verifyHealthInitialClaim(request,io)
 if(request?.kind==='table-repack/v1')return verifyTableRepackClaim(request,io)
 if(!request||!Number.isSafeInteger(request.claim_issue)||!Number.isSafeInteger(request.work_issue)||!Array.isArray(request.objects)||request.objects.length!==4||new Set(request.objects).size!==4)throw Error('maintenance claim request refused')
 const claims=io.openClaims(),owner=claims.find(c=>c.number===request.claim_issue)
 if(!owner||claimWorkIssue(owner)!==request.work_issue)throw Error('exact open maintenance claim required')
 const lease=parseAuthorLease(owner.body)
 if(request.objects.some(key=>!lease.writes.includes(key)))throw Error('maintenance claim does not cover exact writes')
 for(const other of claims){
  if(other.number===owner.number)continue
  const parsed=parseAuthorLease(other.body)
  if(request.objects.some(key=>(parsed.objects??[...parsed.writes,...parsed.reads]).includes(key)))throw Error('maintenance object collision with another protected claim')
 }
 return {admitted:true,claim_issue:owner.number,work_issue:request.work_issue}
}
// One allowlisted table rewritten in place by the pinned pg_repack client (popdam3#804).
const REPACK_TABLES=['table public.assets']
export function verifyTableRepackClaim(request,io=githubIo){
 if(!Number.isSafeInteger(request.claim_issue)||!Number.isSafeInteger(request.work_issue)||!/^repack-[a-z0-9-]{1,32}$/.test(request.operation_id??'')
    ||!Array.isArray(request.objects)||request.objects.length!==1||!REPACK_TABLES.includes(request.objects[0]))throw Error('exact repack table claim request refused')
 const claims=io.openClaims(),owner=claims.find(c=>c.number===request.claim_issue)
 if(!owner||claimWorkIssue(owner)!==request.work_issue)throw Error('exact open repack claim required')
 const lease=parseAuthorLease(owner.body)
 if(!lease.writes.includes(request.objects[0]))throw Error('repack claim does not cover the exact table')
 for(const other of claims){
  if(other.number===owner.number)continue
  const parsed=parseAuthorLease(other.body)
  if((parsed.objects??[...parsed.writes,...parsed.reads]).includes(request.objects[0]))throw Error('repack table collides with another protected claim')
 }
 return {admitted:true,claim_issue:owner.number,work_issue:request.work_issue,kind:request.kind}
}
export function verifyHealthInitialClaim(request,io=githubIo){
 const raw=readFileSync(new URL('../config/health-initial-index-definitions.json',import.meta.url))
 if(createHash('sha256').update(raw).digest('hex')!=='84a870f7ad2f9c1d0201a614f9964f386adf7dfc51e3048967d45ef69b5b9eaa')throw Error('fixed health registry changed')
 const registry=JSON.parse(raw)
 const definition=registry[request.operation_id]
 if(!definition||request.claim_issue!==5622||request.work_issue!==5622||request.kind!=='health-initial/v1')throw Error('fixed health claim owner/operation refused')
 const expectedWrites=[definition.canonical,definition.preview_shadow].map(name=>'index public.'+name).sort()
 const expectedReads=['table '+definition.table]
 if(!Array.isArray(request.objects)||request.objects.length!==2||JSON.stringify([...request.objects].sort())!==JSON.stringify(expectedWrites)
    ||JSON.stringify(request.reads)!==JSON.stringify(expectedReads))throw Error('exact health index writes/table read required')
 const claims=io.openClaims(),owner=claims.find(c=>c.number===5622)
 if(!owner||claimWorkIssue(owner)!==5622)throw Error('exact open health owner required')
 const scope=parseQueueScope(owner.body)
 if(!scope||scope.workType!=='structural'||scope.route!=='claim-first'||scope.status!=='ready'
    ||expectedWrites.some(key=>!scope.writes.includes(key))
    ||expectedReads.some(key=>!scope.reads.includes(key)&&!scope.writes.includes(key)))throw Error('health scope lacks exact writes/table dependency')
 const desired={writes:expectedWrites,reads:expectedReads}
 for(const other of claims){
  if(other.number===5622)continue
  const parsed=parseQueueScope(other.body)??parseAuthorLease(other.body)
  if(conflicts(desired,parsed))throw Error('health index/table dependency conflicts with another protected claim')
 }
 const ownership={claim_issue:5622,work_issue:5622,writes:scope.writes,reads:scope.reads,route:scope.route,workType:scope.workType,changeType:scope.changeType}
 return {admitted:true,claim_issue:5622,work_issue:5622,kind:request.kind,
         scope_sha256:createHash('sha256').update(JSON.stringify(ownership)).digest('hex')}
}
export function maintenanceExclusive(mode,request,io=githubIo){
 if(!request||!['preview','production'].includes(request.target)||!Number.isSafeInteger(request.run_id)||request.run_id<=0||!Number.isSafeInteger(request.source_pr)||!/^([a-f0-9]{40})$/.test(request.head_sha??''))throw Error('maintenance exclusive request refused')
 const kind=request.target==='production'?'production':'preview-maintenance'
 if(mode==='acquire'){
  verifyMaintenanceClaim(request.claim,io)
  const metadata={owner:`github-actions:${request.run_id}:index-maintenance`,pr:request.source_pr,headSha:request.head_sha,githubRunId:request.run_id,githubRunAttempt:1,maintenanceClaim:request.claim}
  return acquireExclusive(kind,metadata,{...io,verifyMaintenanceClaim:r=>verifyMaintenanceClaim(r,io)})
 }
 if(!request.lease?.holderId||!Number.isSafeInteger(request.lease.generation))throw Error('maintenance exclusive identity refused')
 if(request.claim?.kind==='health-initial/v1'&&request.lease.kind!==kind)throw Error('health exclusive target changed')
 const expected={holderId:request.lease.holderId,generation:request.lease.generation}
 if(mode==='assert')return assertExclusive(kind,expected,io)
 if(mode==='release')return releaseExclusive(kind,expected,io)
 throw Error('maintenance exclusive mode refused')
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){
 try{
  const [mode,ref]=process.argv.slice(2)
  if(['acquire','assert','release'].includes(mode)){let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>32768)throw Error('exclusive input too large')};console.log(JSON.stringify(maintenanceExclusive(mode,JSON.parse(input))))}
  else if(mode==='admit'){let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>32768)throw Error('admission input too large')};console.log(JSON.stringify(verifyMaintenanceClaim(JSON.parse(input))))}
  else if(mode==='read')console.log(JSON.stringify(readReceipt(ref)))
  else if(mode==='create'){let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>32768)throw Error('receipt input too large')};console.log(JSON.stringify(createReceipt(ref,JSON.parse(input))))}
  else throw Error('receipt mode refused')
 }catch(error){console.error('maintenance receipt refused: '+error.message);process.exitCode=2}
}
