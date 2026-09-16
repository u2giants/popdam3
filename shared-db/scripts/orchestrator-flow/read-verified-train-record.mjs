// Issue #3027 Step 6: hand the production business-risk gate the EXACT train
// record a dispatch names, re-verified the same way the validate job verifies it
// (immutable ref, identity, no later generation, same target/main/allowlist).
// The gate then proves every entry on its own; this only reads, never writes.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubIo, trainIo } from '../manage-migration-author-lanes.mjs'
import { MigrationTrainError, TRAIN_REF_PREFIX, assertDispatchMatchesTrain, assertRecordedTrain, trainRecordRef } from './migration-train.mjs'

export function readVerifiedTrainRecord({ref,target,commitSha,allowlist},rawIo){
  const io=trainIo(rawIo)
  if(!String(ref??'').startsWith(`${TRAIN_REF_PREFIX}/`))throw new MigrationTrainError(`train record read needs a ${TRAIN_REF_PREFIX}/ ref`)
  const payload=io.readImmutable(String(ref))
  if(!payload)throw new MigrationTrainError(`train record ${ref} does not exist`)
  if(trainRecordRef(payload.record)!==ref)throw new MigrationTrainError(`train record at ${ref} names a different identity`)
  assertRecordedTrain(payload.record,io)
  assertDispatchMatchesTrain(payload.record,{target,commit_sha:commitSha,allowlist})
  return payload.record
}

export function main(argv,rawIo=githubIo){
  const o={}
  for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];if(!['--ref','--target','--commit-sha','--allowlist','--output'].includes(key)||value===undefined){console.error(`unknown or incomplete argument ${key}`);return 2};o[key.slice(2)]=value}
  try{
    if(!o.output)throw new MigrationTrainError('--output is required')
    const record=readVerifiedTrainRecord({ref:o.ref,target:o.target,commitSha:o['commit-sha'],allowlist:o.allowlist},rawIo)
    writeFileSync(o.output,JSON.stringify(record,null,2)+'\n')
    return 0
  }catch(error){console.error(`::error::REFUSED: ${error.message}`);return 2}
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
