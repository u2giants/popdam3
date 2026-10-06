// Split from scripts/manage-migration-author-lanes.mjs (issue #3726). Behavior-preserving move:
// the entrypoint re-exports every public name defined here. Edit here, not there.
import { MigrationTrainError, TRAIN_REF_PREFIX, proposeTrain, validateTrain, transitionTrain, trainRecordRef, assertRecordedTrain, assertTrainProductionEvidence, assertDispatchMatchesTrain } from '../../orchestrator-flow/migration-train.mjs'
import { sha256, canonicalJson } from '../../orchestrator-flow/evidence-bundle.mjs'
import { createHash } from 'node:crypto'
import { main } from '../../manage-migration-author-lanes.mjs'

export const TRAIN_RECORD_PREFIX='db-migration-train '
// Immutable train records are ownership commits named by create-only refs.
export function trainIo(io){
  return {
    mainSha:()=>io.mainSha(),
    treeFiles:(sha)=>io.treeFiles(sha),
    getFileAt:(file,sha)=>io.getFileAt(file,sha),
    createImmutable(ref,digest,record){const sha=io.makeOwnerCommit(`${TRAIN_RECORD_PREFIX}${JSON.stringify({digest,record})}`);return io.createRef(ref,sha)},
    readImmutable(ref){
      const sha=io.readRef(ref);if(!sha)return null
      const message=String(io.getCommit(sha)?.message??'')
      if(!message.startsWith(TRAIN_RECORD_PREFIX))throw new MigrationTrainError(`${ref} does not point to a migration train record`)
      const payload=JSON.parse(message.slice(TRAIN_RECORD_PREFIX.length))
      if(sha256(canonicalJson(payload.record))!==payload.digest)throw new MigrationTrainError(`${ref} holds a train record whose digest does not match its content`)
      return payload
    },
    listTrainRecords:(trainId)=>io.listRefs(`${TRAIN_REF_PREFIX}/${trainId}/`),
  }
}

// Every train file on current main must hash to the train's recorded hash.
export function assertTrainLiveOnMain(manifest,io){
  const main=String(io.mainSha()??'').toLowerCase()
  if(!/^[0-9a-f]{40}$/.test(main))throw new MigrationTrainError('current main is unreadable')
  if(main!==manifest.base_main_sha)throw new MigrationTrainError(`train is stale: main is ${main}, the train was built on ${manifest.base_main_sha}`)
  const files=io.treeFiles(main)
  for(const entry of manifest.entries){
    const found=files.filter((file)=>file.startsWith(`supabase/migrations/${entry.version}_`)&&file.endsWith('.sql'))
    if(found.length!==1)throw new MigrationTrainError(`migration ${entry.version} has ${found.length} files on current main, not exactly 1`)
    const hash=createHash('sha256').update(String(io.getFileAt(found[0],main))).digest('hex')
    if(hash!==entry.file_sha256)throw new MigrationTrainError(`migration ${entry.version} hashes to ${hash} on current main, not the train hash ${entry.file_sha256}`)
  }
  return main
}

export function runTrainCommand(o,io,readJson){
  if(o.proposeTrain)return proposeTrain(readJson(o.proposeTrain,'--propose-train'))
  if(o.validateTrain){
    if(!o.trainProof)throw new MigrationTrainError('--validate-train requires --train-proof <file>')
    return validateTrain(readJson(o.validateTrain,'--validate-train'),readJson(o.trainProof,'--train-proof'))
  }
  if(o.authorizeTrain){
    if(!o.trainProof||!o.authorizationDigest||!o.targetIdentity)throw new MigrationTrainError('--authorize-train requires --train-proof, --authorization-digest and --target-identity')
    const manifest=readJson(o.authorizeTrain,'--authorize-train')
    if(manifest.state!=='proposed')throw new MigrationTrainError(`only a proposed train can be authorized; this one is ${manifest.state}`)
    // The file's own validated flag is never trusted: re-validate, then re-prove main.
    const validated=validateTrain(manifest,readJson(o.trainProof,'--train-proof'))
    const main=assertTrainLiveOnMain(validated,io)
    const record=transitionTrain(validated,'authorized',io,{authorization_digest:o.authorizationDigest,current_main_sha:main,target_identity:o.targetIdentity})
    return {record,ref:trainRecordRef(record)}
  }
  if(o.dispatchTrain){
    const prior=readJson(o.dispatchTrain,'--dispatch-train')
    assertRecordedTrain(prior,io)
    assertTrainLiveOnMain(prior,io)
    const record=transitionTrain(prior,'dispatched',io),ref=trainRecordRef(record),versions=record.entries.map((e)=>e.version).join(',')
    const allowlistInput=record.target==='production'?'production_allowlist':'preview_allowlist'
    return {record,ref,workflow_inputs:{target:record.target,commit_sha:record.base_main_sha,[allowlistInput]:versions,migration_train_ref:ref}}
  }
  if(o.closeTrain){
    const prior=readJson(o.closeTrain,'--close-train')
    assertRecordedTrain(prior,io)
    const failed=o.failedAppliedPrefix!==undefined
    if(!failed){
      if(!o.trainProof)throw new MigrationTrainError('--close-train requires --train-proof <file> with passing production assertions')
      assertTrainProductionEvidence(prior,readJson(o.trainProof,'--train-proof'))
    }
    const prefix=failed?String(o.failedAppliedPrefix).split(',').map((v)=>v.trim()).filter(Boolean):[]
    const record=transitionTrain(prior,failed?'failed':'closed',io,{applied_prefix:prefix})
    return {record,ref:trainRecordRef(record)}
  }
  const ref=String(o.verifyTrainDispatch)
  if(!ref.startsWith(`${TRAIN_REF_PREFIX}/`))throw new MigrationTrainError(`--verify-train-dispatch needs a ${TRAIN_REF_PREFIX}/ ref`)
  const payload=io.readImmutable(ref)
  if(!payload)throw new MigrationTrainError(`train record ${ref} does not exist`)
  if(trainRecordRef(payload.record)!==ref)throw new MigrationTrainError(`train record at ${ref} names a different identity`)
  assertRecordedTrain(payload.record,io)
  return assertDispatchMatchesTrain(payload.record,{target:o.target,commit_sha:o.commitSha,allowlist:o.allowlist})
}
