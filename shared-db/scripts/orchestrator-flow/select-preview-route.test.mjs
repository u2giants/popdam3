import assert from 'node:assert/strict'
import test from 'node:test'
import { selectPreviewRoute } from './select-preview-route.mjs'

const base={issue:1720,pr:1721,head_sha:'a'.repeat(40),bundle_id:'b'.repeat(64),versions:['20260828030000'],main_versions:['20260828010000'],preview_versions:['20260828010000'],claims:[],dependency_closure_complete:true,merged:false}
test('ordinary open work selects the manual normal-preview route',()=>assert.equal(selectPreviewRoute(base).route,'NORMAL_PREVIEW'))
test('#1713/#1720 preview ordering becomes WAITING without a failed run',()=>{
  const result=selectPreviewRoute({...base,preview_versions:['20260828010000','20260828020000'],claims:[{issue:1713,pr:1715,versions:['20260828020000'],merged:false}]})
  assert.equal(result.status,'WAITING');assert.equal(result.route,'WAITING');assert.deepEqual(result.context.blockers,['20260828020000'])
})
test('merged missing versions select post-merge rehearsal',()=>assert.equal(selectPreviewRoute({...base,merged:true,main_versions:[...base.main_versions,...base.versions]}).route,'POST_MERGE_REHEARSAL'))
test('already-applied bytes never reapply and require original apply evidence',()=>{
  assert.equal(selectPreviewRoute({...base,preview_versions:[...base.preview_versions,...base.versions]}).route,'UNVERIFIABLE')
  assert.equal(selectPreviewRoute({...base,preview_versions:[...base.preview_versions,...base.versions],original_apply_evidence:{type:'preview-apply',run_id:'123'}}).route,'HISTORICAL_RECOVERY')
})
test('#1646 two-version closure is refused until complete',()=>assert.equal(selectPreviewRoute({...base,versions:['20260828030000','20260828030001'],dependency_closure_complete:false}).route,'UNVERIFIABLE'))
test('decision identity is deterministic and exact-head changes it',()=>{const first=selectPreviewRoute(base),second=selectPreviewRoute(base),moved=selectPreviewRoute({...base,head_sha:'c'.repeat(40)});assert.equal(first.decision_id,second.decision_id);assert.notEqual(first.decision_id,moved.decision_id)})
