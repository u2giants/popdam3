#!/usr/bin/env node
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const HISTORICAL_RESTORATIONS = Object.freeze({
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
  const digest=createHash('sha256').update(raw,'utf8').digest('hex')
  if(digest!==record.fileSha256)throw new Error(`historical restoration file hash mismatch for ${version}`)
  const statement=raw.endsWith('\n')?raw.slice(0,-1):raw
  if(raw!==`${statement}\n`||Buffer.byteLength(statement)!==record.statementBytes||createHash('sha256').update(statement,'utf8').digest('hex')!==record.statementSha256)throw new Error(`historical restoration statement bytes mismatch for ${version}`)
  return record
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  const record=HISTORICAL_RESTORATIONS[path.basename(process.argv[3]??'').slice(0,14)]
  process.exitCode=process.argv[2]==='--allows-backdated'&&record?.filename===String(process.argv[3]).replaceAll('\\','/')?0:2
}
