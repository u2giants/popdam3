#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const HISTORICAL_RESTORATIONS = Object.freeze({
  // #2035. Preview applied this version in run 33454217961 from PR #2009 commit
  // bb77fdd49fe032c985dc93c907f5d4d93a2456a1, then the PR head moved twice to fix two
  // High review findings and the corrected body merged as 30221c0b. Preview therefore
  // holds the seven hts_rag_* tables from the SUPERSEDED body, and the production
  // business-risk gate refuses a promotion whose rehearsal digest is not the file on
  // exact main. Preview cannot re-run `create table`, so the file is restored to the
  // bytes preview actually ran and the corrections are fixed forward in 20260901011306.
  '20260831234750': Object.freeze({
    filename: 'supabase/migrations/20260831234750_hts_rag_durable_precedent_contract.sql',
    name: 'hts_rag_durable_precedent_contract',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '33454217961',
    previewAppliedCommit: 'bb77fdd49fe032c985dc93c907f5d4d93a2456a1',
    forwardFixVersion: '20260901011306',
    statementBytes: 12578,
    statementSha256: '646bc6be0bef4e5bcc09cc944a46ff8910d9cab72a6b19ce66f3df60e2e15af4',
    fileSha256: '2931391a44f512ec80fe468b00c3b92c277397418e5fda25fa98907dad6559cb',
    objects: Object.freeze([
      'table public.hts_rag_precedents',
      'table public.hts_rag_precedent_rulings',
      'table public.hts_rag_product_examples',
      'table public.hts_rag_determinations',
      'table public.hts_rag_extraction_jobs',
      'table public.hts_rag_review_events',
      'table public.hts_rag_product_family_allowlist',
    ]),
  }),
  '20260828052706': Object.freeze({
    filename: 'supabase/migrations/20260828052706_sync_dflow_columns_onto_plm_designflow_copies.sql',
    name: 'sync_dflow_columns_onto_plm_designflow_copies',
    productionProject: 'qsllyeztdwjgirsysgai',
    sourceVersion: '20260817150944',
    verificationRun: '33169143850',
    codeTruthOnly: true,
    statementCount: 1,
    statementBytes: 3213,
    statementSha256: '03f40fec5d4d72443b31ac5c7bdb028d4972eedf057479c596214efb1b189779',
    fileSha256: 'c8ab692586a94fef5dfdf18b32105ccb9f9469bb8336c40fab793c1c4404dace',
    objects: Object.freeze(['table plm.rfqitem','table plm.gridviewstate','table plm.itemdetail']),
  }),
  '20260824150630': Object.freeze({
    filename: 'supabase/migrations/20260824150630_sample_tracking_piece_split_and_transit_return.sql',
    name: 'sample_tracking_piece_split_and_transit_return',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    creatorSha256: '7f4d74d1ffa4d74b239be01bcfa4261610d2107a08f2e3d967feede858b5a96c',
    statementCount: 1,
    statementBytes: 15811,
    statementSha256: 'fa01a4f5cf7a944bfbba2faa0176a696beca64bb69e838869a8e085019a1ab77',
    fileSha256: '5e9829b2cab7f0462804acce18bccf0d65b9c88363e9e54290581513047f4a52',
    objects: Object.freeze([
      'function dflow.post_sample_piece_split',
      'function dflow.validate_sample_movement_shipment_identity',
      'table dflow.sample_movement',
      'view dflow.sample_global_status',
      'function dflow.sample_movement_guard',
    ]),
  }),
  '20260817150944': Object.freeze({
    filename: 'supabase/migrations/20260817150944_sync_dflow_columns_onto_plm_designflow_copies.sql',
    name: 'sync_dflow_columns_onto_plm_designflow_copies',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    creatorSha256: 'ede9ab5ebdcbbb7af5760ff9ce653aa402b0c53a41e2ee9bdf18121204e58b9a',
    statementCount: 1,
    statementBytes: 3213,
    statementSha256: '03f40fec5d4d72443b31ac5c7bdb028d4972eedf057479c596214efb1b189779',
    fileSha256: 'c8ab692586a94fef5dfdf18b32105ccb9f9469bb8336c40fab793c1c4404dace',
    objects: Object.freeze(['table plm.rfqitem','table plm.gridviewstate','table plm.itemdetail']),
  }),
})

export function validateHistoricalRestorationFile(filename, raw) {
  const version=path.basename(filename).slice(0,14), record=HISTORICAL_RESTORATIONS[version]
  if(!record||filename.replaceAll('\\','/')!==record.filename)throw new Error('file is not an approved exact historical restoration')
  const governedRaw=raw.replaceAll('\r\n','\n')
  const digest=createHash('sha256').update(governedRaw,'utf8').digest('hex')
  if(digest!==record.fileSha256)throw new Error(`historical restoration file hash mismatch for ${version}`)
  const statement=governedRaw.endsWith('\n')?governedRaw.slice(0,-1):governedRaw
  if(governedRaw!==`${statement}\n`||Buffer.byteLength(statement)!==record.statementBytes||createHash('sha256').update(statement,'utf8').digest('hex')!==record.statementSha256)throw new Error(`historical restoration statement bytes mismatch for ${version}`)
  return record
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  try {
    const filename=String(process.argv[3]??'')
    if(process.argv[2]!=='--allows-backdated')throw new Error('unsupported command')
    validateHistoricalRestorationFile(filename,readFileSync(filename,'utf8'))
    process.exitCode=0
  } catch (error) {
    console.error(error.message)
    process.exitCode=2
  }
}
