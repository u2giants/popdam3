import assert from 'node:assert/strict';
import {
  classifyCandidates,
  classifyResponse,
  cleanCharacterName,
  csvObjects,
  norm,
} from './process-style-guide-licensing-review.mjs';

assert.equal(norm(' Lizzie McGuire - TV Series '), 'lizzie mcguire tv series');
assert.deepEqual(
  csvObjects('name,value\r\n"Hello, world","A""B"\r\n'),
  [{ name: 'Hello, world', value: 'A"B' }],
);

const codes = new Set(['CP', 'BM']);
assert.deepEqual(classifyResponse('cp', codes), {
  outcome: 'EXISTING_MG06',
  finalCode: 'CP',
});
assert.deepEqual(classifyResponse('never designed', codes), {
  outcome: 'NEVER_DESIGNED',
  finalCode: '',
});
assert.deepEqual(classifyResponse('multiple', codes), {
  outcome: 'MULTIPLE',
  finalCode: '',
});
assert.throws(() => classifyResponse('BAD', codes), /unknown MG06 code/);

assert.equal(classifyCandidates([], false), 'UNMATCHED');
assert.equal(classifyCandidates(['BM'], false), 'AUTO_UNIQUE');
assert.equal(classifyCandidates(['BM', 'CP'], false), 'CONFLICT');
assert.equal(classifyCandidates([], true), 'SENTINEL_EXCLUDED');
assert.equal(
  cleanCharacterName('Batman ( Marvel Cross-Franchise Art Packs )'),
  'Batman',
);
