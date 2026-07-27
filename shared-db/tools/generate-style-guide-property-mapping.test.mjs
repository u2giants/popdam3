import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const reviewOutput = join(root, 'tmp-style-guide-property-review-test.csv');
const auditOutput = join(root, 'tmp-style-guide-property-all-test.csv');

try {
  execFileSync(process.execPath, [
    'tools/generate-style-guide-property-mapping.mjs',
    '--out',
    reviewOutput,
  ], { cwd: root });
  execFileSync(process.execPath, [
    'tools/generate-style-guide-property-mapping.mjs',
    '--all',
    '--out',
    auditOutput,
  ], { cwd: root });

  const review = readFileSync(reviewOutput, 'utf8');
  const audit = readFileSync(auditOutput, 'utf8');
  assert.equal(review.trimEnd().split(/\r?\n/).length - 1, 153);
  assert.equal(audit.trimEnd().split(/\r?\n/).length - 1, 335);
  assert.equal((audit.match(/,ACCEPTED_DIRECT,/g) || []).length, 21);
  assert.equal((audit.match(/,ACCEPTED_CLEAR_MG06,/g) || []).length, 153);
  assert.equal((audit.match(/,ACCEPTED_CLASSIC_CP,/g) || []).length, 5);
  assert.equal((audit.match(/,ACCEPTED_NO_CODE,/g) || []).length, 3);
  assert.equal((audit.match(/,NEEDS_REVIEW,/g) || []).length, 153);
  assert.match(audit, /Lizzie McGuire - TV Series,2,ACCEPTED_CLEAR_MG06,MCG,LIZZIE MCGUIRE/);
  assert.match(audit, /Monsters University,1,ACCEPTED_CLEAR_MG06,MS,MONSTERS/);
  assert.match(audit, /Toy Story 3,36,ACCEPTED_CLEAR_MG06,TS,TOY STORY 4/);
  assert.match(audit, /Marvel Studios' Captain Marvel 2 - No Likeness,24,ACCEPTED_CLEAR_MG06,CM,CAPTAIN MARVEL/);
  assert.match(review, /Wreck-It Ralph 2,1,NEEDS_REVIEW,/);
  assert.match(review, /Smiling Friends: Animated Series,7,NEEDS_REVIEW,/);
  assert.match(review, /Dumbo,1,NEEDS_REVIEW,/);
  assert.match(review, /Dumbo \(2019\),10,NEEDS_REVIEW,/);
  assert.match(audit, /"Lion King, The \(2019\)",1,ACCEPTED_CLEAR_MG06,NG,LION KING \(LIVE ACTION\)/);
  assert.match(review, /Inside Out 2,1,NEEDS_REVIEW,/);
  assert.doesNotMatch(review, /,ACCEPTED_/);
  assert.doesNotMatch(audit, /,NEW,/);
} finally {
  rmSync(reviewOutput, { force: true });
  rmSync(auditOutput, { force: true });
}
