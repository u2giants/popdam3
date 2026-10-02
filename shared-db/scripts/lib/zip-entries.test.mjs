import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readZipEntries, ZipError } from './zip-entries.mjs'
import { selectArtifactJson, selectArtifactFiles } from '../manage-migration-author-lanes.mjs'

// Build real zips with Python's zipfile (stored and deflated), the same format
// GitHub Actions artifacts use, so the test does not trust our own writer.
function makeZip(files, compression) {
  const dir = mkdtempSync(path.join(tmpdir(), 'zip-entries-test-'))
  try {
    const out = path.join(dir, 'a.zip')
    const py = process.platform === 'win32' ? 'python' : 'python3'
    execFileSync(py, ['-c', `import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w',${compression})\nfor k,v in json.loads(sys.stdin.read()).items(): z.writestr(k,v)\nz.close()`, out], { input: JSON.stringify(files) })
    return readFileSync(out)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

for (const [label, compression] of [['deflated', 'zipfile.ZIP_DEFLATED'], ['stored', 'zipfile.ZIP_STORED']]) {
  test(`reads ${label} artifact zips without tar (Linux GNU tar cannot)`, () => {
    const proof = JSON.stringify({ ok: true, pad: 'x'.repeat(2000) })
    const entries = readZipEntries(makeZip({ 'db-generated-types-proof.json': proof, 'dir/summary.txt': 'done' }, compression))
    assert.deepEqual([...entries.keys()].sort(), ['db-generated-types-proof.json', 'dir/summary.txt'])
    assert.equal(entries.get('db-generated-types-proof.json').toString('utf8'), proof)
  })
}

test('selectArtifactJson requires exactly the expected file', () => {
  const one = readZipEntries(makeZip({ 'p.json': '{"a":1}' }, 'zipfile.ZIP_DEFLATED'))
  assert.deepEqual(selectArtifactJson(one, 'p.json'), { a: 1 })
  const two = readZipEntries(makeZip({ 'p.json': '{}', 'extra.json': '{}' }, 'zipfile.ZIP_DEFLATED'))
  assert.throws(() => selectArtifactJson(two, 'p.json'), /must contain exactly p.json/)
})

test('selectArtifactFiles matches nested names and reports missing files', () => {
  const entries = readZipEntries(makeZip({ 'run/production-apply.json': '{"x":1}' }, 'zipfile.ZIP_DEFLATED'))
  assert.equal(selectArtifactFiles(entries, ['production-apply.json']).get('production-apply.json'), '{"x":1}')
  assert.throws(() => selectArtifactFiles(entries, ['missing.json']), /missing missing.json/)
})

test('rejects non-zip bytes', () => {
  assert.throws(() => readZipEntries(Buffer.from('not a zip at all, definitely not')), ZipError)
})
