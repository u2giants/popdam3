import assert from 'node:assert/strict';
import {
  classifyCandidates,
  classifyFranchiseCharacter,
  classifyResponse,
  cleanCharacterName,
  csvObjects,
  isNonCharacterLabel,
  norm,
} from './process-style-guide-licensing-review.mjs';

assert.equal(norm(' Lizzie McGuire - TV Series '), 'lizzie mcguire tv series');
assert.deepEqual(
  csvObjects('name,value\r\n"Hello, world","A""B"\r\n'),
  [{ name: 'Hello, world', value: 'A"B' }],
);
assert.equal(
  classifyFranchiseCharacter(
    'DC Super Friends Collection Comics',
    'Superman aka Clark Kent aka Kal-EI',
  ).code,
  'SM',
);
assert.equal(
  classifyFranchiseCharacter(
    'DC Super Friends Collection Comics',
    'Wonder Woman aka Princess Diana aka Diana Prince',
  ).code,
  'WW',
);
assert.equal(
  classifyFranchiseCharacter(
    'DC Super Friends Collection Comics',
    'The Flash aka Jason Peter "Jay" Garrick',
  ).code,
  'FS',
);
assert.equal(
  classifyFranchiseCharacter(
    'DC Super Friends Collection Comics',
    'Green Lantern aka Hal Jordan',
  ).code,
  'GN',
);
for (const ambiguous of [
  'Bombshell', 'Nova', 'Shang-Chi', 'Mechasaur Binary', 'Mechasaur Arachno',
  'White Tiger',
]) {
  assert.equal(
    classifyFranchiseCharacter('Marvel Cross-Franchise Art Packs', ambiguous).code,
    'MV',
  );
}
assert.equal(
  isNonCharacterLabel(
    'Marvel Cross-Franchise Art Packs',
    'Marvel Cross-Franchise Art Packs )',
  ),
  true,
);
assert.equal(
  isNonCharacterLabel('Marvel Cross-Franchise Art Packs', 'Avengers Logo'),
  true,
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
assert.deepEqual(
  classifyFranchiseCharacter('DC Super Friends Collection Comics', 'Batman'),
  {
    code: 'BM',
    basis: 'Batman character family',
    rule: 'SPECIFIC_FRANCHISE',
  },
);
assert.deepEqual(
  classifyFranchiseCharacter('Marvel Cross-Franchise Art Packs', 'Parker, Peter'),
  {
    code: 'SP',
    basis: 'Spider-Man character family',
    rule: 'SPECIFIC_FRANCHISE',
  },
);
assert.deepEqual(
  classifyFranchiseCharacter('Marvel Cross-Franchise Art Packs', 'Blade'),
  {
    code: 'MV',
    basis: 'Marvel Assorted Styles catch-all; no narrower current MG06 franchise rule',
    rule: 'MARVEL_CATCH_ALL',
  },
);
