// Issue #562 — the question generator must REFUSE to ask a question no human
// can answer (backlog B7 standard: assert the guard FIRES, not that the happy
// path passes).
//
// Every negative case below is a VERBATIM row from the production evidence file
// `docs/verification/character-identity-rules-20260728/identity-decisions-for-owner.csv`
// — the exact input `build-licensing-questions-csv.mjs` read when it generated
// round 1, and the exact rows that produced round 2's unanswerable questions.
// The cases are fed through `buildCombinationQuestion`, which is the function
// the script's own `main()` calls for every B-block row, and through
// `splitCombination`/`resolveIdentities`, the shared tokeniser that produced
// the `components` field in the first place. Nothing here asserts on a value
// the production path never sees.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCombinationQuestion,
  answerableComponents,
  UnanswerableQuestionError,
} from './build-licensing-questions-csv.mjs';
import {
  splitCombination,
  isQualifierComponent,
  resolveIdentities,
} from './resolve-character-identity.mjs';

const ask = (row) =>
  buildCombinationQuestion(row, { ref: 'B001', licensor: 'Disney' });

// ---------------------------------------------------------------------------
// 1. The generator refuses qualifier-only rows.
// ---------------------------------------------------------------------------

test('refuses the "Unknown names: gen" question (Moon Girl & Devil Dinosaur - Gen)', () => {
  assert.throws(
    () => ask({
      style_guide: "Marvel's Moon Girl and Devil Dinosaur",
      character_name: 'Moon Girl & Devil Dinosaur - Gen ( Marvel`s Moon Girl and Devil Dinosaur )',
      components: 'gen',
    }),
    (err) => err instanceof UnanswerableQuestionError && /refusing to ask B001/.test(err.message),
  );
});

test('refuses a General royalty label whose only components are royalty qualifiers', () => {
  assert.throws(
    () => ask({
      style_guide: 'High School Musical: The Musical: The Series',
      character_name: 'High School Musical: The Musical-General (No Name, Likeness, Voice Royalty)',
      components: 'high school musical the musical general no name | likeness | voice royalty',
    }),
    UnanswerableQuestionError,
  );
});

test('refuses the mangled Ant-Man logo fragment', () => {
  assert.throws(
    () => ask({
      style_guide: "Marvel Studios' Ant-Man Wasp Quantumania - No Likeness",
      character_name: 'Marvel Studios` Ant-Man & Wasp Logo ( MS` Ant-Man Wasp Quantumania ) ',
      components: 'wasp logo ms ant man wasp quantumania',
    }),
    UnanswerableQuestionError,
  );
});

test('refuses a row whose components field is empty rather than emitting a blank question', () => {
  assert.throws(() => ask({ style_guide: 'Mickey Mouse', character_name: 'Mickey', components: '' }),
    UnanswerableQuestionError);
});

test('the refusal names the row, so the operator can fix the data instead of guessing', () => {
  try {
    ask({ style_guide: 'x', character_name: 'Some Label - Gen', components: 'gen' });
    assert.fail('expected a refusal');
  } catch (err) {
    assert.match(err.message, /Some Label - Gen/);
    assert.match(err.message, /components: gen/);
  }
});

// ---------------------------------------------------------------------------
// 2. The generator still asks the questions it SHOULD ask. A guard that
//    refuses everything has removed the capability, not repaired it.
// ---------------------------------------------------------------------------

test('still asks the genuine Camp Rock combination question', () => {
  const q = ask({
    style_guide: 'Camp Rock',
    character_name: 'Camp Rock - Jason, Nate & Shane',
    components: 'jason | nate | shane',
  });
  assert.match(q.the_problem, /jason, nate, shane/);
  assert.equal(q.ref, 'B001');
});

test('a mixed row keeps its real names and drops only the qualifier', () => {
  assert.deepEqual(answerableComponents('jason | logo | nate'), ['jason', 'nate']);
});

// ---------------------------------------------------------------------------
// 3. The tokeniser itself — the upstream half of the same defect.
// ---------------------------------------------------------------------------

test('a trailing style-guide scope suffix is removed before splitting', () => {
  assert.deepEqual(
    splitCombination('Moon Girl & Devil Dinosaur - Gen ( Marvel`s Moon Girl and Devil Dinosaur )'),
    ['moon girl', 'devil dinosaur'],
  );
});

test('the franchise-prefix drop no longer throws the characters away', () => {
  // Names are in the PREFIX; "Back To School" is the title, not a character.
  assert.deepEqual(splitCombination('Mickey & Pluto - Back To School'), ['mickey', 'pluto']);
});

test('the franchise-prefix drop is preserved where it was correct', () => {
  assert.deepEqual(
    splitCombination('Camp Rock 2 - Jason, Nate & Shane'),
    ['jason', 'nate', 'shane'],
  );
});

test('royalty and logo fragments are never returned as character names', () => {
  assert.deepEqual(splitCombination('Pirates 5 - General(No Name,Likeness,Voice Royalty)').filter(
    (c) => isQualifierComponent(c)), []);
  assert.equal(isQualifierComponent('gen'), true);
  assert.equal(isQualifierComponent('voice royalty'), true);
  assert.equal(isQualifierComponent('wasp logo ms ant man wasp quantumania'), true);
  assert.equal(isQualifierComponent('mickey'), false);
});

// ---------------------------------------------------------------------------
// 4. End to end through resolveIdentities — the path that WRITES the
//    components field the generator later reads.
// ---------------------------------------------------------------------------

test('a qualifier-only combination row is not put to a human at all', () => {
  const { rows } = resolveIdentities([{
    styleGuide: "Marvel's Moon Girl and Devil Dinosaur",
    licensorId: 3,
    characterRowId: 1,
    characterName: 'Moon Girl ( Marvel`s Moon Girl and Devil Dinosaur )',
    sourceCharacterId: 'a',
  }, {
    styleGuide: "Marvel's Moon Girl and Devil Dinosaur",
    licensorId: 3,
    characterRowId: 2,
    characterName: 'Devil Dinosaur ( Marvel`s Moon Girl and Devil Dinosaur )',
    sourceCharacterId: 'b',
  }, {
    styleGuide: "Marvel's Moon Girl and Devil Dinosaur",
    licensorId: 3,
    characterRowId: 3,
    characterName: 'Moon Girl & Devil Dinosaur - Gen ( Marvel`s Moon Girl and Devil Dinosaur )',
    sourceCharacterId: 'c',
  }]);
  const combo = rows.find((r) => r.characterRowId === 3);
  assert.notEqual(combo.status, 'NEEDS_HUMAN');
  assert.equal(String(combo.components ?? '').includes('gen'), false);
  // And the generator refuses it even if a stale evidence file still carries it.
  assert.throws(
    () => buildCombinationQuestion(
      { style_guide: 'x', character_name: combo.characterName, components: 'gen' },
      { ref: 'B042', licensor: 'Marvel' },
    ),
    UnanswerableQuestionError,
  );
});
