import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStub } from '../record-blocker-stub.mjs';
import { validateAll } from './ledger-lib.mjs';

test('stub creates immutable unknown fields without guessing',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'blocker-'));const e=createStub({root,classification:'credential',issue:'#1',guard:'g',symptom:'s',proofCommand:'p'});assert.equal(e.resolution,null);assert.equal(e.estimate,true);assert.ok(fs.existsSync(path.join(root,'config/blocker-ledger',`${e.id}.json`)))});
test('false-alarm stub validates before a fixture is created',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'blocker-'));const e=createStub({root,classification:'guard-false-alarm',issue:'#2',guard:'g',symptom:'s',proofCommand:'p'});assert.equal(validateAll(root).entries[0].id,e.id)});
test('unknown class refuses',()=>assert.throws(()=>createStub({root:'.',classification:'bad',issue:'x',guard:'g',symptom:'s',proofCommand:'p'}),/unknown/));
test('id collision retries without overwriting the existing ledger',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'blocker-')),bytes=Buffer.alloc(16,1),id=`blk_${bytes.toString('hex')}`,dir=path.join(root,'config/blocker-ledger');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`${id}.json`),'owned');let calls=0;const entry=createStub({root,classification:'other',issue:'#3',guard:'g',symptom:'s',proofCommand:'p',randomBytes:()=>calls++?Buffer.alloc(16,2):bytes});assert.notEqual(entry.id,id);assert.equal(fs.readFileSync(path.join(dir,`${id}.json`),'utf8'),'owned')});
test('concurrent creators allocate distinct atomic ledger files',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'blocker-concurrent-')),run=promisify(execFile),moduleUrl=new URL('../record-blocker-stub.mjs',import.meta.url).href,code=`import{createStub}from ${JSON.stringify(moduleUrl)};createStub({root:process.argv[1],classification:'other',issue:'#4',guard:'g',symptom:'s',proofCommand:'p'})`;await Promise.all(Array.from({length:8},()=>run(process.execPath,['--input-type=module','-e',code,root])));const files=fs.readdirSync(path.join(root,'config/blocker-ledger')).filter(v=>v.endsWith('.json'));assert.equal(files.length,8);assert.equal(new Set(files).size,8);assert.equal(validateAll(root).entries.length,8)});
