import assert from 'node:assert/strict'
import test from 'node:test'
import { HISTORICAL_RESTORATIONS, validateHistoricalRestorationFile } from './historical-migration-restorations.mjs'

test('pins the one authenticated preview historical restoration',()=>{
  const row=HISTORICAL_RESTORATIONS['20260817150944']
  assert.equal(row.name,'sync_dflow_columns_onto_plm_designflow_copies')
  assert.equal(row.creatorSha256,'ede9ab5ebdcbbb7af5760ff9ce653aa402b0c53a41e2ee9bdf18121204e58b9a')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.deepEqual(row.objects,['table plm.rfqitem','table plm.gridviewstate','table plm.itemdetail'])
})

test('refuses wrong paths and bytes',()=>{
  assert.throws(()=>validateHistoricalRestorationFile('supabase/migrations/20260817150944_wrong.sql','select 1;\n'),/not an approved/)
  assert.throws(()=>validateHistoricalRestorationFile(HISTORICAL_RESTORATIONS['20260817150944'].filename,'select 1;\n'),/hash mismatch/)
})
