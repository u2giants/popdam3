import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const output = join(root, 'tmp-style-guide-property-mapping-test.csv');

try {
  execFileSync(process.execPath, [
    'tools/generate-style-guide-property-mapping.mjs',
    '--out',
    output,
  ], { cwd: root });

  const text = readFileSync(output, 'utf8');
  const lines = text.trimEnd().split(/\r?\n/);
  assert.equal(lines.length - 1, 335);
  assert.equal((text.match(/,ACCEPTED_DIRECT,/g) || []).length, 21);
  assert.equal((text.match(/,ACCEPTED_CLASSIC_CP,/g) || []).length, 5);
  assert.equal((text.match(/,ACCEPTED_NO_CODE,/g) || []).length, 3);
  assert.equal((text.match(/,NEEDS_REVIEW,/g) || []).length, 306);
  assert.match(text, /Dumbo,1,NEEDS_REVIEW,/);
  assert.match(text, /Dumbo \(2019\),10,NEEDS_REVIEW,/);
  assert.match(text, /"Lion King, The \(2019\)",1,NEEDS_REVIEW,/);
  assert.match(text, /Inside Out 2,1,NEEDS_REVIEW,/);
  assert.doesNotMatch(text, /,NEW,/);
} finally {
  rmSync(output, { force: true });
}
