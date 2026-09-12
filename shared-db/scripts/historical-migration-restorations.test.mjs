import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { HISTORICAL_RESTORATIONS, validateHistoricalProductionProvenance, validateHistoricalRestorationFile } from './historical-migration-restorations.mjs'

test('production provenance accepts only the exact issue 2535 preview apply evidence',()=>{
  const row=HISTORICAL_RESTORATIONS['20260908202651']
  assert.equal(row.filename,'supabase/migrations/20260908202651_hts_rag_dual_model_debate_audit.sql')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.equal(Object.isFrozen(row),true)
  assert.equal(Object.isFrozen(row.objects),true)
  const raw=readFileSync(row.filename,'utf8')
  assert.equal(validateHistoricalRestorationFile(row.filename,raw),row)
  const evidence={
    version:'20260908202651',
    previewApplyRun:'34281856111',
    previewDispatchCommit:'69226335c20fef57f8a7c15cd7b014a157b61484',
    previewAppliedCommit:'69226335c20fef57f8a7c15cd7b014a157b61484',
    sourcePr:2584,
    sourceMergeCommit:'d669c43eda033919091c532605ee1cf1f2e786e4',
    artifactFileSha256:'0f0bd894725486ba6fb80990c09e00e8048e3e433242746e79e4883d4a14b74a',
  }
  assert.equal(validateHistoricalProductionProvenance(row.filename,raw,evidence),row)
  for(const [key,value] of [
    ['version','20260908202652'],
    ['previewApplyRun','34281856112'],
    ['previewDispatchCommit','d'.repeat(40)],
    ['previewAppliedCommit','a'.repeat(40)],
    ['sourcePr',2583],
    ['sourceMergeCommit','b'.repeat(40)],
    ['artifactFileSha256','c'.repeat(64)],
  ])assert.throws(
    ()=>validateHistoricalProductionProvenance(row.filename,raw,{...evidence,[key]:value}),
    new RegExp(`mismatch for ${key}`),
  )
  assert.throws(
    ()=>validateHistoricalRestorationFile('supabase/migrations/20260908202651_wrong.sql','select 1;\n'),
    /not an approved exact historical restoration/,
  )
  assert.throws(
    ()=>validateHistoricalRestorationFile(row.filename,raw+'-- changed bytes\n'),
    /historical restoration file hash mismatch for 20260908202651/,
  )
})

test('pins the issue 2622 restoration without changing production eligibility',()=>{
  const row=HISTORICAL_RESTORATIONS['20260909194231']
  assert.equal(row.filename,'supabase/migrations/20260909194231_coldlion_merch_group_detail_category_identity.sql')
  assert.equal(row.fileSha256,'4db5068dab42833921153aad59d97ed9201ed093047296ec5cc58601004cc39d')
  assert.equal(row.statementBytes,2575)
  assert.equal(row.statementSha256,'5840ad59c1328329f523487d2431dc8ac6f40eeb55706b06070ad5ac70b25245')
  assert.equal(Object.isFrozen(row),true)
  assert.deepEqual(row.objects,[
    'table coldlion.merch_group_detail',
  ])
  assert.throws(
    ()=>validateHistoricalRestorationFile('supabase/migrations/20260909194231_wrong.sql','select 1;\n'),
    /not an approved exact historical restoration/,
  )
  assert.throws(
    ()=>validateHistoricalRestorationFile(row.filename,'select 1;\n'),
    /historical restoration file hash mismatch for 20260909194231/,
  )
})

test('pins the issue 2543 restoration without changing production eligibility',()=>{
  const row=HISTORICAL_RESTORATIONS['20260909115140']
  assert.equal(row.filename,'supabase/migrations/20260909115140_opa_coherent_complete_capture.sql')
  assert.equal(row.fileSha256,'8720f0a1fe9a6dbcfc3d40ca6ad5906e08424ea69d84df1284eb75ed544041bc')
  assert.equal(row.statementBytes,61299)
  assert.equal(row.statementSha256,'8e054097c5f73d050aacd6ef315b97c709e53f46618b034816c4536b6a28effc')
  // The superseded pre-review bytes are no longer authorized by the registry.
  assert.notEqual(row.fileSha256,'9d1d67c4caef29a50a3b8097a3e17381cd48705d364a444ea3967093394456c7')
  assert.notEqual(row.statementSha256,'0f1b7fa0c17a1bffb2bfc67c625b85a14d71b15ffc8ee1169771f98ec79e2719')
  assert.notEqual(row.statementBytes,61267)
  assert.equal(Object.isFrozen(row),true)
  assert.deepEqual(row.objects,[
    'table plm.opa_capture',
    'table plm.opa_capture_scope',
    'table plm.opa_property_character_capture',
    'function plm.begin_opa_capture',
    'function plm.load_opa_capture_chunk',
    'function plm.finalize_opa_capture',
    'function api.source_capture_inventory_exact',
    'table api.source_capture_inventory',
    'view api.source_capture_inventory',
  ])
  assert.throws(
    ()=>validateHistoricalRestorationFile('supabase/migrations/20260909115140_wrong.sql','select 1;\n'),
    /not an approved exact historical restoration/,
  )
  assert.throws(
    ()=>validateHistoricalRestorationFile(row.filename,'select 1;\n'),
    /historical restoration file hash mismatch for 20260909115140/,
  )
})

test('pins the issue 2580 restoration without changing production eligibility',()=>{
  const row=HISTORICAL_RESTORATIONS['20260909084253']
  assert.equal(row.filename,'supabase/migrations/20260909084253_sample_shipment_notice_outbox.sql')
  assert.equal(row.fileSha256,'70beba94d21b05384438a298fa3d49bd0a1bbdb31cbf4cb0216bec8aa380e76f')
  assert.equal(row.statementBytes,6537)
  assert.equal(row.statementSha256,'1dd8adc722def760f9d3dde9abfff9cf53e3929fab97e49954b8512d91c1f33b')
  assert.equal(Object.isFrozen(row),true)
  assert.deepEqual(row.objects,[
    'table dflow.sample_shipment_notice',
    'table dflow.sample_shipment_notice_recipient',
    'function dflow.prevent_sample_shipment_notice_snapshot_mutation',
    'function dflow.prevent_sample_shipment_notice_recipient_snapshot_mutation',
    'trigger sample_shipment_notice_snapshot_immutable on dflow.sample_shipment_notice',
    'trigger sample_shipment_notice_recipient_snapshot_immutable on dflow.sample_shipment_notice_recipient',
    'function dflow.claim_sample_shipment_notice',
  ])
  assert.throws(
    ()=>validateHistoricalRestorationFile('supabase/migrations/20260909084253_wrong.sql','select 1;\n'),
    /not an approved exact historical restoration/,
  )
  assert.throws(
    ()=>validateHistoricalRestorationFile(row.filename,'select 1;\n'),
    /historical restoration file hash mismatch for 20260909084253/,
  )
})

test('pins the issue 2506 preview restoration without granting production eligibility',()=>{
  const row=HISTORICAL_RESTORATIONS['20260908214749']
  assert.equal(row.filename,'supabase/migrations/20260908214749_popsg_search_v2_bounded_paging.sql')
  assert.equal(row.name,'popsg_search_v2_bounded_paging')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.equal(row.previewApplyRun,'34290415305')
  assert.equal(row.previewDispatchCommit,'281b967986b7cca99b13722f4d9ed3c988902c9d')
  assert.equal(row.previewAppliedCommit,'281b967986b7cca99b13722f4d9ed3c988902c9d')
  assert.equal(row.fileSha256,'e79a608eedbfc31dab4c70acb2ad2709f3f4d56ee8d2bb7c3e6d43a96632968f')
  assert.equal(row.statementBytes,25052)
  assert.equal(row.statementSha256,'fe5982e1dd711ef7e136727323cb125d6b095ab83de9edd5eaa3ad28258fb780')
  assert.equal(Object.isFrozen(row),true)
  assert.deepEqual(row.objects,['function public.search_style_guide_library_v2'])
  // The on-disk file must BE the pinned bytes, so the pin cannot drift from the tree.
  assert.equal(validateHistoricalRestorationFile(row.filename,readFileSync(row.filename,'utf8')),row)
  // One byte more and the pin refuses: the entry authorizes content, never a version.
  assert.throws(
    ()=>validateHistoricalRestorationFile(row.filename,readFileSync(row.filename,'utf8')+'-- changed'+String.fromCharCode(10)),
    /historical restoration file hash mismatch for 20260908214749/,
  )
  // Production producer provenance is deliberately unregistered for this version.
  assert.throws(
    ()=>validateHistoricalProductionProvenance(row.filename,readFileSync(row.filename,'utf8'),{
      version:'20260908214749',
      previewApplyRun:'34290415305',
      previewDispatchCommit:'281b967986b7cca99b13722f4d9ed3c988902c9d',
      previewAppliedCommit:'281b967986b7cca99b13722f4d9ed3c988902c9d',
      sourcePr:2542,
      sourceMergeCommit:'0'.repeat(40),
      artifactFileSha256:row.fileSha256,
    }),
    /not registered for production producer provenance/,
  )
})

test('pins the issue 2356 restoration without changing production eligibility',()=>{
  const row=HISTORICAL_RESTORATIONS['20260907152838']
  assert.equal(row.filename,'supabase/migrations/20260907152838_dam_asset_freshness_current_state.sql')
  assert.equal(row.fileSha256,'6c04610f8e63d7d67b5c74610a69e219f912fa1b7fb520d7839ab8a81d77e022')
  assert.equal(row.statementBytes,3747)
  assert.equal(row.statementSha256,'8f9179afb6f2e01cd6684b591dae5e996381036b733a964450aa464128edab05')
  assert.equal(Object.isFrozen(row),true)
  assert.deepEqual(row.objects,[
    'column dam.asset.first_seen_at',
    'column dam.asset.last_seen_at',
    'column dam.asset.missing_since',
    'constraint dam_asset_seen_order on dam.asset',
    'constraint dam_asset_missing_after_first_seen on dam.asset',
    'function dam.enforce_asset_freshness',
    'table dam.asset',
    'trigger dam_asset_freshness_guard on dam.asset',
  ])
  assert.throws(
    ()=>validateHistoricalRestorationFile('supabase/migrations/20260907152838_wrong.sql','select 1;\n'),
    /not an approved exact historical restoration/,
  )
  assert.throws(
    ()=>validateHistoricalRestorationFile(row.filename,'select 1;\n'),
    /historical restoration file hash mismatch for 20260907152838/,
  )
})

test('pins the issue 2509 preview restoration without changing production eligibility',()=>{
  const row=HISTORICAL_RESTORATIONS['20260907131728']
  assert.equal(row.filename,'supabase/migrations/20260907131728_popsg_preview_stats_indexed_categories.sql')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.equal(row.previewApplyRun,'34157812748')
  assert.equal(row.previewDispatchCommit,'4f093e3d4c97e4272d147d38e7243ec57d3c08f1')
  assert.equal(row.previewAppliedCommit,'bcc2603977678db73b4ca12d3ed1312a1bff64e2')
  assert.equal(row.sourcePr,2513)
  assert.equal(row.sourceMergeCommit,'c5f85ad3a98b7a5598e8c81a56735473d5bb5487')
  assert.equal(row.fileSha256,'03648ecbbee473f539c27f929a248c503c18d5fb906efe1409d11593cfdb5d7e')
  assert.equal(row.statementBytes,9125)
  assert.equal(row.statementSha256,'d273d46aa662d3ae24502da44e3226e9c5932c7646b8d5d430b76563fa9d2191')
  assert.equal(Object.isFrozen(row),true)
  assert.deepEqual(row.objects,[
    'function public.get_sg_preview_stats',
    'index public.idx_sgf_active_preview_category',
    'table public.style_guide_files',
  ])
  assert.throws(
    ()=>validateHistoricalRestorationFile('supabase/migrations/20260907131728_wrong.sql','select 1;\n'),
    /not an approved exact historical restoration/,
  )
  assert.throws(
    ()=>validateHistoricalRestorationFile(row.filename,'select 1;\n'),
    /historical restoration file hash mismatch for 20260907131728/,
  )
})

test('production provenance accepts only the exact issue 2509 restoration evidence',()=>{
  const row=HISTORICAL_RESTORATIONS['20260907131728']
  const raw=readFileSync(row.filename,'utf8')
  const evidence={
    version:'20260907131728',
    previewApplyRun:'34157812748',
    previewDispatchCommit:'4f093e3d4c97e4272d147d38e7243ec57d3c08f1',
    previewAppliedCommit:'bcc2603977678db73b4ca12d3ed1312a1bff64e2',
    sourcePr:2513,
    sourceMergeCommit:'c5f85ad3a98b7a5598e8c81a56735473d5bb5487',
    artifactFileSha256:'03648ecbbee473f539c27f929a248c503c18d5fb906efe1409d11593cfdb5d7e',
  }
  assert.equal(validateHistoricalProductionProvenance(row.filename,raw,evidence),row)
  for(const [key,value] of [
    ['version','20260907131729'],
    ['previewApplyRun','34157812749'],
    ['previewDispatchCommit','d'.repeat(40)],
    ['previewAppliedCommit','a'.repeat(40)],
    ['sourcePr',2512],
    ['sourceMergeCommit','b'.repeat(40)],
    ['artifactFileSha256','c'.repeat(64)],
  ])assert.throws(
    ()=>validateHistoricalProductionProvenance(row.filename,raw,{...evidence,[key]:value}),
    new RegExp(`mismatch for ${key}`),
  )
  assert.throws(
    ()=>validateHistoricalProductionProvenance(row.filename,raw+'-- changed bytes\n',evidence),
    /file hash mismatch/,
  )
  assert.throws(
    ()=>validateHistoricalProductionProvenance(
      HISTORICAL_RESTORATIONS['20260817150944'].filename,
      readFileSync(HISTORICAL_RESTORATIONS['20260817150944'].filename,'utf8'),
      evidence,
    ),
    /not registered for production producer provenance/,
  )
})

test('pins the one authenticated preview historical restoration',()=>{
  const row=HISTORICAL_RESTORATIONS['20260817150944']
  assert.equal(row.name,'sync_dflow_columns_onto_plm_designflow_copies')
  assert.equal(row.creatorSha256,'ede9ab5ebdcbbb7af5760ff9ce653aa402b0c53a41e2ee9bdf18121204e58b9a')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.deepEqual(row.objects,['table plm.rfqitem','table plm.gridviewstate','table plm.itemdetail'])
})

test('pins the production code-truth restoration without authorizing replay',()=>{
  const row=HISTORICAL_RESTORATIONS['20260828052706']
  assert.equal(row.sourceVersion,'20260817150944')
  assert.equal(row.verificationRun,'33169143850')
  assert.equal(row.productionProject,'qsllyeztdwjgirsysgai')
  assert.equal(validateHistoricalRestorationFile(row.filename,readFileSync(row.filename,'utf8')),row)
})

test('pins the Sample Tracking preview ledger restoration byte for byte',()=>{
  const row=HISTORICAL_RESTORATIONS['20260824150630']
  assert.equal(row.name,'sample_tracking_piece_split_and_transit_return')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.equal(row.fileSha256,'5e9829b2cab7f0462804acce18bccf0d65b9c88363e9e54290581513047f4a52')
  assert.equal(row.statementBytes,15811)
  assert.equal(validateHistoricalRestorationFile(row.filename,readFileSync(row.filename,'utf8')),row)
})

test('refuses wrong paths and bytes',()=>{
  assert.throws(()=>validateHistoricalRestorationFile('supabase/migrations/20260817150944_wrong.sql','select 1;\n'),/not an approved/)
  assert.throws(()=>validateHistoricalRestorationFile(HISTORICAL_RESTORATIONS['20260817150944'].filename,'select 1;\n'),/hash mismatch/)
})

test('pins the issue 2744 preview restoration without granting production eligibility',()=>{
  const row=HISTORICAL_RESTORATIONS['20260911170526']
  assert.equal(row.filename,'supabase/migrations/20260911170526_scraped_properties_page_asset_context.sql')
  assert.equal(row.name,'scraped_properties_page_asset_context')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.equal(row.previewApplyRun,'34636342626')
  assert.equal(row.previewDispatchCommit,'1eae69db6ed5c938a109fde0c9040849ec30bffe')
  assert.equal(row.previewAppliedCommit,'1eae69db6ed5c938a109fde0c9040849ec30bffe')
  assert.equal(row.fileSha256,'e14fe1cd1670d4ea277c1e76bbeb8cae864765dff2f293b3ac0a95bd7042219f')
  assert.equal(row.statementBytes,58609)
  assert.equal(row.statementSha256,'455cd87dd1076eb33ece81361609f772154d1f651d5a95f993d077c294373dd3')
  assert.equal(Object.isFrozen(row),true)
  assert.equal(Object.isFrozen(row.objects),true)
  assert.deepEqual(row.objects,['function api.db_data_admin_scraped_properties'])
  // The migration file lands with PR #2793, so bind the pin to the applied commit's
  // bytes when that object is available, and to the tree once the file is there.
  const sources=[]
  if(existsSync(row.filename))sources.push(readFileSync(row.filename,'utf8'))
  try{sources.push(execFileSync('git',['show',`${row.previewAppliedCommit}:${row.filename}`],{encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:1<<24}))}catch{}
  for(const raw of sources){
    assert.equal(validateHistoricalRestorationFile(row.filename,raw),row)
    assert.throws(
      ()=>validateHistoricalRestorationFile(row.filename,raw+'-- changed'+String.fromCharCode(10)),
      /historical restoration file hash mismatch for 20260911170526/,
    )
    // Production producer provenance is deliberately unregistered for this version.
    assert.throws(
      ()=>validateHistoricalProductionProvenance(row.filename,raw,{
        version:'20260911170526',
        previewApplyRun:'34636342626',
        previewDispatchCommit:'1eae69db6ed5c938a109fde0c9040849ec30bffe',
        previewAppliedCommit:'1eae69db6ed5c938a109fde0c9040849ec30bffe',
        sourcePr:2793,
        sourceMergeCommit:'0'.repeat(40),
        artifactFileSha256:row.fileSha256,
      }),
      /not registered for production producer provenance/,
    )
  }
  assert.throws(
    ()=>validateHistoricalRestorationFile('supabase/migrations/20260911170526_wrong.sql','select 1;'+String.fromCharCode(10)),
    /not an approved exact historical restoration/,
  )
})

test('pins the issue 2797 preview restoration without granting production eligibility',()=>{
  const row=HISTORICAL_RESTORATIONS['20260911221304']
  assert.equal(row.filename,'supabase/migrations/20260911221304_db_data_admin_scraped_source_inventory.sql')
  assert.equal(row.name,'db_data_admin_scraped_source_inventory')
  assert.equal(row.previewProject,'mvpkijzfmfcxhnzqogzs')
  assert.equal(row.previewApplyRun,'34655606553')
  assert.equal(row.previewDispatchCommit,'916b8005f4588ece389f1f137faf651bd78ef0a2')
  assert.equal(row.previewAppliedCommit,'916b8005f4588ece389f1f137faf651bd78ef0a2')
  assert.equal(row.fileSha256,'ecc847f602358edb27829cc49faba86b58e3788b6cf98c702eaccf8b8527904d')
  assert.equal(row.statementBytes,55149)
  assert.equal(row.statementSha256,'a9171a6023e724b677655db8d89e572f4394ad8c1b4db41d37a52438b492d20e')
  assert.equal(Object.isFrozen(row),true)
  assert.equal(Object.isFrozen(row.objects),true)
  assert.deepEqual(row.objects,['function api.db_data_admin_scraped_source_inventory'])
  // Production producer provenance is deliberately unregistered for this version.
  assert.equal(row.sourcePr,undefined)
  assert.equal(row.sourceMergeCommit,undefined)
  // The migration file lands with PR #2808, so bind the pin to the applied commit's
  // bytes when that object is available, and to the tree once the file is there.
  const sources=[]
  if(existsSync(row.filename))sources.push(readFileSync(row.filename,'utf8'))
  try{sources.push(execFileSync('git',['show',`${row.previewAppliedCommit}:${row.filename}`],{encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:1<<24}))}catch{}
  for(const raw of sources){
    assert.equal(validateHistoricalRestorationFile(row.filename,raw),row)
    assert.throws(
      ()=>validateHistoricalRestorationFile(row.filename,raw+'-- changed'+String.fromCharCode(10)),
      /historical restoration file hash mismatch for 20260911221304/,
    )
    assert.throws(
      ()=>validateHistoricalProductionProvenance(row.filename,raw,{
        version:'20260911221304',
        previewApplyRun:'34655606553',
        previewDispatchCommit:'916b8005f4588ece389f1f137faf651bd78ef0a2',
        previewAppliedCommit:'916b8005f4588ece389f1f137faf651bd78ef0a2',
        sourcePr:2808,
        sourceMergeCommit:'0'.repeat(40),
        artifactFileSha256:row.fileSha256,
      }),
      /not registered for production producer provenance/,
    )
  }
  assert.throws(
    ()=>validateHistoricalRestorationFile('supabase/migrations/20260911221304_wrong.sql','select 1;'+String.fromCharCode(10)),
    /not an approved exact historical restoration/,
  )
})
