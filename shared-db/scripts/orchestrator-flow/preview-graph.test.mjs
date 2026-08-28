import assert from 'node:assert/strict'
import test from 'node:test'
import { assertAcyclic, buildPreviewGraph, PreviewGraphError } from './preview-graph.mjs'

test('#1713 on preview and not main creates a dependency edge for #1720',()=>{
  const graph=buildPreviewGraph({mainVersions:['20260828010000'],previewVersions:['20260828010000','20260828020000'],claims:[{issue:1713,pr:1715,versions:['20260828020000'],merged:false},{issue:1720,pr:1721,versions:['20260828030000'],merged:false}]})
  assert.deepEqual(graph.edges,[{from:'20260828020000',to:'20260828030000',reason:'preview-ledger-predecessor-not-on-main'}])
})
test('duplicate claims and dependency cycles fail closed',()=>{
  assert.throws(()=>buildPreviewGraph({mainVersions:[],previewVersions:[],claims:[{issue:1,pr:1,versions:['20260828010000']},{issue:2,pr:2,versions:['20260828010000']}]}),/multiple/)
  assert.throws(()=>assertAcyclic({nodes:[{version:'1'},{version:'2'}],edges:[{from:'1',to:'2'},{from:'2',to:'1'}]}),PreviewGraphError)
})
