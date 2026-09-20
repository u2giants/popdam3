import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probeShapeProblem } from './check-live-proof-probe.mjs';

const sql = readFileSync(new URL('../.github/live-proofs/2863.sql', import.meta.url), 'utf8');
test('recovered replay proof passes the production single-read-statement guard', () => {
  assert.equal(probeShapeProblem(sql), null);
});
test('both required endpoint witnesses are conjunctive, never alternative evidence', () => {
  assert.match(sql, /SELECT EXISTS \(SELECT 1 FROM prepack_replay\)\s+AND EXISTS \(SELECT 1 FROM prod_replay\)/);
  assert.doesNotMatch(sql, /\b(?:10111|10119|17303|7263)\b/);
});
