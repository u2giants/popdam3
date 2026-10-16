import test from 'node:test'
import { currentRepository, expectedOperatorAssociation } from '../lib/repository-identity.mjs'
// Fixtures follow the resolved repository identity and its operator association (#3255).
const THIS_REPO = currentRepository(), OPERATOR_ASSOCIATION = expectedOperatorAssociation()
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDatabasePreviewFileSnapshot, githubIo } from '../manage-migration-author-lanes.mjs'
import { buildSenderClassification, extractBlock, main, receive, renderBlock } from './preview-route-canary.mjs'

const base_sha = '8'.repeat(40), head_sha = '9'.repeat(40)
const blob = (c) => ({ blob_sha: c.repeat(40), mode: '100644', type: 'blob' })
function liveFiles(headText = 'A plain prose note about the canary.') {
  return buildDatabasePreviewFileSnapshot([{ filename: 'docs/canary.md', status: 'added' }], new Map(), new Map([['docs/canary.md', blob('c')]]), () => headText)
}
function io({ body, association = 'OWNER', files = liveFiles(), head = head_sha } = {}) {
  return {
    databasePreviewClassification: githubIo.databasePreviewClassification,
    getPr: () => ({ number: 7, state: 'open', author_association: association, body, base: { sha: base_sha, repo: { full_name: THIS_REPO } }, head: { sha: head } }),
    databasePreviewFileSnapshot: () => files,
  }
}
const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'prc-test-'))
const senderBody = (files = liveFiles()) => `Canary\n\n${renderBlock(buildSenderClassification(files, { base_sha, head_sha }), 3027)}\n`

test('sender evidence for a live documentation-only change is admitted as NO_DATABASE_PREVIEW by the receiver', () => {
  const result = receive({ pr: 7, io: io({ body: senderBody() }), tempDir })
  assert.equal(result.decision, 'NO_DATABASE_PREVIEW')
  assert.equal(result.next_action, 'return-to-natural-owner')
  assert.equal(result.issue, 3027)
  assert.match(result.classification_digest, /^[0-9a-f]{64}$/)
})

test('the receiver fails closed: untrusted author, missing, duplicated, stale, or database-touching evidence', () => {
  assert.equal(receive({ pr: 7, io: io({ body: senderBody(), association: 'CONTRIBUTOR' }), tempDir }).decision, 'DATABASE_PREVIEW_REQUIRED')
  assert.equal(receive({ pr: 7, io: io({ body: 'no block' }), tempDir }).decision, 'DATABASE_PREVIEW_REQUIRED')
  assert.equal(receive({ pr: 7, io: io({ body: senderBody() + senderBody() }), tempDir }).decision, 'DATABASE_PREVIEW_REQUIRED')
  const moved = receive({ pr: 7, io: io({ body: senderBody(), head: '7'.repeat(40) }), tempDir })
  assert.equal(moved.decision, 'DATABASE_PREVIEW_REQUIRED'); assert.match(moved.reason, /refused/)
  const changed = receive({ pr: 7, io: io({ body: senderBody(), files: liveFiles('edited prose') }), tempDir })
  assert.equal(changed.decision, 'DATABASE_PREVIEW_REQUIRED')
  const dbFiles = liveFiles('run psql against it')
  assert.equal(dbFiles[0].impact, 'database-behavior')
  assert.equal(receive({ pr: 7, io: io({ body: senderBody(dbFiles), files: dbFiles }), tempDir }).decision, 'DATABASE_PREVIEW_REQUIRED')
  assert.equal(receive({ pr: 7, io: { getPr: () => { throw new Error('boom') } }, tempDir }).decision, 'DATABASE_PREVIEW_REQUIRED')
})

test('block extraction accepts exactly one well-formed block', () => {
  assert.equal(extractBlock('```db-preview-classification\nnot json\n```'), null)
  assert.equal(extractBlock('```db-preview-classification\n{"issue":0,"classification":{}}\n```'), null)
  assert.equal(extractBlock(senderBody()).issue, 3027)
})

test('the receiver CLI is report-only: it always exits 0 and writes the decision line', () => {
  const lines = []
  assert.equal(main(['--receiver', '--pr', '7'], { io: io({ body: 'nothing' }), stdout: (l) => lines.push(l), env: {} }), 0)
  assert.match(lines[0], /decision=DATABASE_PREVIEW_REQUIRED/)
  assert.equal(main(['--receiver'], { io: io({}), stdout: () => {}, env: {} }), 2)
})
