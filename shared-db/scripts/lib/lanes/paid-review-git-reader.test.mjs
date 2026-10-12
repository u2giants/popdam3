import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paidReviewGitReader, PAID_REVIEW_GIT_MAX_BYTES } from '../../manage-migration-author-lanes.mjs'

function fixture(run) {
 const dir=mkdtempSync(join(tmpdir(),'paid-git-reader-'))
 try {execFileSync('git',['init','-q',dir]); run(dir)} finally {rmSync(dir,{recursive:true,force:true})}
}
const digest=s=>createHash('sha256').update(s).digest('hex')
test('complete real Git source blob exceeds default output bound without losing bytes',()=>fixture(dir=>{
 const source='native source \u00e9\n'.repeat(90000)
 assert.ok(Buffer.byteLength(source)>1024*1024)
 const sha=execFileSync('git',['-C',dir,'hash-object','-w','--stdin'],{input:source,encoding:'utf8'}).trim()
 assert.throws(()=>execFileSync('git',['-C',dir,'cat-file','blob',sha],{encoding:'utf8'}),e=>e.code==='ENOBUFS')
 const actual=paidReviewGitReader(['-C',dir,'cat-file','blob',sha])
 assert.equal(actual,source);assert.equal(digest(actual),digest(source))
}))
test('output beyond explicit process bound refuses instead of returning truncated evidence',()=>fixture(dir=>{
 const source='x'.repeat(PAID_REVIEW_GIT_MAX_BYTES+65536)
 const sha=execFileSync('git',['-C',dir,'hash-object','-w','--stdin'],{input:source,encoding:'utf8'}).trim()
 assert.throws(()=>paidReviewGitReader(['-C',dir,'cat-file','blob',sha]),e=>e.code==='ENOBUFS')
}))
test('Git failures remain failures',()=>assert.throws(()=>paidReviewGitReader(['cat-file','blob','missing-source-object'])) )

test('shipped Git reader preserves every byte at the explicit4MiB boundary',()=>fixture(dir=>{
 const source='x'.repeat(PAID_REVIEW_GIT_MAX_BYTES)
 const sha=execFileSync('git',['-C',dir,'hash-object','-w','--stdin'],{input:source,encoding:'utf8'}).trim()
 assert.equal(paidReviewGitReader(['-C',dir,'cat-file','blob',sha]),source)
}))
