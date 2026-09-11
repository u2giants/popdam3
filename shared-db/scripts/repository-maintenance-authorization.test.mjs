import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeRepositoryMaintenanceStatus, EXCLUSIVE_REFS, MUTEX_REF, selectNewestCommitStatus } from './manage-migration-author-lanes.mjs'

const head='a'.repeat(40),owner='b'.repeat(40),base='c'.repeat(40)
const options={pr:2715,headSha:head,description:'prose verified',targetUrl:'https://github.com/u2giants/shared-db/actions/runs/7'}
const prose=[{filename:'docs/example.md',status:'modified',patch:'@@ -1 +1 @@\n-old\n+new'}]

test('newest same-context status is selected independent of API order',()=>{
  const older={id:1,context:'Migration guarded merge authorization',state:'failure',created_at:'2026-09-11T01:00:00Z'}
  const newer={id:2,context:older.context,state:'success',created_at:'2026-09-11T02:00:00Z'}
  assert.equal(selectNewestCommitStatus([older,newer],older.context).state,'success')
  assert.equal(selectNewestCommitStatus([newer,older],older.context).state,'success')
  assert.throws(()=>selectNewestCommitStatus([{...newer,created_at:'unknown'}],older.context),/malformed/)
  assert.throws(()=>selectNewestCommitStatus([newer,{...newer,state:'failure'}],older.context),/duplicate/)
})

function fakeIo({files=prose,liveHead=head,production=null,releaseFails=false,prSequence=null,existingStatus=null}={}){
  const refs=new Map([[EXCLUSIVE_REFS.production,production]].filter(([,sha])=>sha))
  const statuses=[]
  return {
    refs,statuses,
    makeOwnerCommit:()=>owner,
    readRef:(ref)=>refs.get(ref)??null,
    createRef:(ref,sha)=>{if(refs.has(ref))return false;refs.set(ref,sha);return true},
    deleteRef:(ref)=>{if(releaseFails&&ref===MUTEX_REF)throw new Error('release failed');refs.delete(ref)},
    getPr:()=>prSequence?.shift()??({base:{sha:base,ref:'main',repo:{full_name:'u2giants/shared-db'}},head:{sha:liveHead}}),
    comparePullRequestFiles:(seenBase,seenHead)=>{assert.equal(seenBase,base);assert.equal(seenHead,head);return files},
    postCommitStatus:(sha,status)=>{statuses.push({sha,...status});return status},
    getCommitStatus:()=>existingStatus,
    wait:()=>{},
  }
}

test('authorizes prose under only the global mutex and releases it',()=>{
  const io=fakeIo(),result=authorizeRepositoryMaintenanceStatus(options,io)
  assert.equal(result.documentsOnly,true)
  assert.equal(result.coordinationRef,MUTEX_REF)
  assert.equal(result.structuralStage,null)
  assert.equal(io.readRef(MUTEX_REF),null)
  assert.equal(io.statuses.length,1)
  assert.equal(io.statuses[0].state,'success')
  for(const ref of Object.values(EXCLUSIVE_REFS))assert.equal(io.readRef(ref),null)
})

test('production, a moved head, or any executable hunk fails closed and routes to guarded checks',()=>{
  for(const io of [
    fakeIo({production:'c'.repeat(40)}),
    fakeIo({liveHead:'d'.repeat(40)}),
    fakeIo({files:[{filename:'scripts/change.mjs',status:'modified',patch:'@@ -1 +1 @@\n-a\n+b'}]}),
  ]){
    assert.throws(()=>authorizeRepositoryMaintenanceStatus(options,io))
    assert.deepEqual(io.statuses.map((row)=>row.state),['failure'])
    assert.match(io.statuses[0].description,/guarded code checks required/)
    assert.equal(io.statuses[0].context,'Documents-only merge authorization')
    assert.equal(io.readRef(MUTEX_REF),null)
  }
})

test('a base retarget revokes stale required authorization explicitly',()=>{
  const io=fakeIo({files:[{filename:'scripts/change.mjs',status:'modified',patch:'@@ -1 +1 @@\n-a\n+b'}]})
  io.getCommitStatus=()=>{throw new Error('status history unavailable')}
  assert.throws(()=>authorizeRepositoryMaintenanceStatus({...options,revokeRequiredStatus:true},io))
  assert.equal(io.statuses[0].context,'Migration guarded merge authorization')
  assert.equal(io.statuses[0].state,'failure')
})

test('a reused commit revokes only an earlier lightweight success',()=>{
  const executable=[{filename:'scripts/change.mjs',status:'modified',patch:'@@ -1 +1 @@\n-a\n+b'}]
  const guarded=fakeIo({files:executable,existingStatus:{state:'success',description:'Guarded merge authorized'}})
  assert.throws(()=>authorizeRepositoryMaintenanceStatus(options,guarded))
  assert.equal(guarded.statuses[0].context,'Documents-only merge authorization')
  const lightweight=fakeIo({files:executable,existingStatus:{state:'success',description:options.description}})
  assert.throws(()=>authorizeRepositoryMaintenanceStatus(options,lightweight))
  assert.equal(lightweight.statuses[0].context,'Migration guarded merge authorization')
  const unreadable=fakeIo({files:executable})
  unreadable.getCommitStatus=()=>{throw new Error('history unavailable')}
  assert.throws(()=>authorizeRepositoryMaintenanceStatus(options,unreadable),/non-lightweight file/)
  assert.equal(unreadable.statuses[0].context,'Migration guarded merge authorization')
  assert.equal(unreadable.statuses[0].state,'failure')
})

test('an untrusted or moved base repository and branch cannot authorize',()=>{
  for(const untrustedBase of [
    {sha:base,ref:'release/shared-db',repo:{full_name:'u2giants/shared-db'}},
    {sha:base,ref:'main',repo:{full_name:'attacker/shared-db'}},
  ]){
    const io=fakeIo({prSequence:[{base:untrustedBase,head:{sha:head}}]})
    assert.throws(()=>authorizeRepositoryMaintenanceStatus(options,io),/protected main base/)
    assert.equal(io.statuses.some((row)=>row.state==='success'),false)
  }
})

test('an ABA push cannot lend prose files to an executable status SHA',()=>{
  const io=fakeIo({
    files:[{filename:'scripts/change.mjs',status:'modified',patch:'@@ -1 +1 @@\n-a\n+b'}],
    prSequence:[
      {base:{sha:base,ref:'main',repo:{full_name:'u2giants/shared-db'}},head:{sha:head}},
      {base:{sha:base,ref:'main',repo:{full_name:'u2giants/shared-db'}},head:{sha:head}},
    ],
  })
  assert.throws(()=>authorizeRepositoryMaintenanceStatus(options,io),/non-lightweight file/)
  assert.deepEqual(io.statuses.map((row)=>row.state),['failure'])
})

test('a failed mutex release revokes a status and never acquires a stage',()=>{
  const io=fakeIo({releaseFails:true})
  assert.throws(()=>authorizeRepositoryMaintenanceStatus(options,io),/release failed/)
  assert.deepEqual(io.statuses.map((row)=>row.state),['success','failure'])
  for(const ref of Object.values(EXCLUSIVE_REFS))assert.equal(io.readRef(ref),null)
})
