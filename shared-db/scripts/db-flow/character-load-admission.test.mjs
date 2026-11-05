import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inspectCuratedSql} from './curated-admission.mjs'
const sql=readFileSync(new URL('../../supabase/migrations/20261105035926_curated_character_load_safety.sql',import.meta.url),'utf8')
test('forward character load is admitted as accounted curated row writes',()=>{
 const proof=inspectCuratedSql(sql)
 assert.deepEqual(proof.writes,['table core.character','table core.character_alias','table core.taxonomy_source_ref'])
 assert.ok(proof.reads.includes('table public.style_guide_files'))
 assert.ok(proof.reads.includes('table public.style_guide_pdf_text'))
})
test('source exception cannot admit arbitrary public tables, source writes, or temporary DDL',()=>{
 for(const statement of [
  'insert into core.character(name) select filename from public.assets;',
  'insert into public.style_guide_files(filename) values (\'x\');',
  'create temporary table anything(id uuid);',
  'insert into core.character(name) select evil(filename) from public.style_guide_files;'
 ]) assert.throws(()=>inspectCuratedSql(statement))
})
test('the original unsafe load remains refused',()=>{
 const original=readFileSync(new URL('../../supabase/migrations/20261104214842_curated_style_guide_characters.sql',import.meta.url),'utf8')
 assert.throws(()=>inspectCuratedSql(original))
})
