import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isQualifierComponent } from './resolve-character-identity.mjs';

/**
 * Thrown when the generator is asked to produce a question a human cannot
 * answer. This is the B7 negative path: the generator REFUSES rather than
 * shipping a malformed question. Seven such questions reached the licensing
 * company reviewer in round 2
 * ("Unknown names: gen", "Unknown names: back to school", "wasp logo ms ant man
 * wasp quantumania") and all seven came back blank.
 */
export class UnanswerableQuestionError extends Error {
  constructor(ref, detail) {
    super(`refusing to ask ${ref}: ${detail}`);
    this.name = 'UnanswerableQuestionError';
    this.ref = ref;
  }
}

/**
 * The unknown names a combination question may legitimately put to a human.
 * Qualifier fragments are dropped here as well as upstream, so a stale
 * `identity-decisions-for-owner.csv` cannot reintroduce the round-2 defect.
 */
export function answerableComponents(componentsField) {
  return String(componentsField ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !isQualifierComponent(s));
}

/** Build one B-block question, or refuse. */
export function buildCombinationQuestion(row, { ref, licensor }) {
  const parts = answerableComponents(row.components);
  if (parts.length === 0) {
    throw new UnanswerableQuestionError(
      ref,
      `"${row.character_name}" yields no character name to ask about `
      + `(components: ${String(row.components ?? '').trim() || '(none)'})`,
    );
  }
  return {
    ref,
    issue: 'One row names several characters',
    licensor,
    style_guide: row.style_guide,
    character: row.character_name,
    places_used: '1',
    what_we_have: row.character_name,
    what_that_code_actually_is: '',
    the_problem:
      `This is one row listing more than one character. These names appear nowhere else, so we cannot confirm they are real characters: ${parts.join(', ')}.`,
    what_we_need_from_you:
      'Write DROP if this row is just a grouping label and not real characters. Otherwise list the correct full character names, separated by semicolons.',
    options: 'DROP  /  list the real character names',
    YOUR_ANSWER: '',
    YOUR_NOTES: '',
  };
}

const EV = 'C:/repos/shared-db/docs/verification/character-identity-rules-20260728';
const OUT = 'C:/repos/shared-db/docs/verification/character-identity-rules-20260728/licensing-questions-for-laura-20260729.csv';

const LICENSOR = {
  1: 'Disney', 2: 'Warner Bros', 3: 'Marvel', 10: 'NBCUniversal', 12: 'WWE',
  13: 'Coca Cola', 14: 'Strawberry Shortcake', 15: 'Sega', 16: 'Peanuts', 17: 'Paramount',
};

// Coldlion licensor CODE -> readable owner name (verified against core.licensor on preview)
const OWNER_OF_CODE = {
  MV: 'Marvel', NB: 'NBC', ZZ: 'DTR - NO LICENSE (i.e. not licensed)',
};

// style guide name -> legacy licensor id (500 rows, read from preview).
// Loaded lazily so this module can be imported by tests without the fixture.
let SG_LICENSOR = null;
const sgLicensor = () => (SG_LICENSOR ??= Object.fromEntries(
  JSON.parse(fs.readFileSync('sgmap.json', 'utf8')).map((r) => [r.sg.toLowerCase(), r.licensor_id])
));
const licOfStyleGuide = (sg) => {
  const id = sgLicensor()[String(sg || '').trim().toLowerCase()];
  return id ? (LICENSOR[id] || `licensor id ${id}`) : '';
};

// --- minimal RFC4180 parser ---
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const read = (f) => parseCsv(fs.readFileSync(path.join(EV, f), 'utf8'));

export function main() {
const out = [];
let n = 0;
const ref = (p) => `${p}${String(++n).padStart(3, '0')}`;

// ============ A. wrong or unusable MG06 codes ============
n = 0;
for (const r of read('cross-licensor-validation-failures.csv')) {
  const lic = LICENSOR[r.legacy_licensor_id] || `licensor id ${r.legacy_licensor_id}`;
  const isMissing = r.failure === 'CODE_NOT_IN_CORE_PROPERTY';
  out.push({
    ref: ref('A'),
    issue: 'MG06 code looks wrong',
    licensor: lic,
    style_guide: r.style_guide,
    character: '',
    places_used: r.appearances,
    what_we_have: `MG06 code ${r.answered_code}`,
    what_that_code_actually_is: isMissing
      ? 'a real Coldlion code, but it is not set up as a property in our system'
      : `${r.answered_property} (owned by ${OWNER_OF_CODE[r.answered_licensor] || r.answered_licensor})`,
    the_problem: isMissing
      ? `${r.answered_code} cannot be used yet because the property does not exist on our side.`
      : `${r.answered_code} is owned by ${OWNER_OF_CODE[r.answered_licensor] || r.answered_licensor}, but this style guide is ${lic}. A code cannot cross licensors.`,
    what_we_need_from_you: `Give the correct MG06 code for this style guide under ${lic}, or write NONE if POP has never produced against it.`,
    options: '',
    YOUR_ANSWER: '',
    YOUR_NOTES: '',
  });
}

// ============ B. rows naming several characters ============
n = 0;
for (const r of read('identity-decisions-for-owner.csv')) {
  out.push(buildCombinationQuestion(r, { ref: ref('B'), licensor: licOfStyleGuide(r.style_guide) }));
}

// ============ C. character sits under two or more MG06 codes ============
n = 0;
for (const r of read('property-decisions-for-owner.csv')) {
  const lic = LICENSOR[r.legacy_licensor_id] || `licensor id ${r.legacy_licensor_id}`;
  const codes = r.candidate_codes
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const bare = codes.map((s) => s.split('(')[0].trim()).join(' / ');
  out.push({
    ref: ref('C'),
    issue: 'Character sits under two or more MG06 codes',
    licensor: lic,
    style_guide: r.style_guides,
    character: r.character,
    places_used: r.appearances,
    what_we_have: codes.join('  |  '),
    what_that_code_actually_is: '',
    the_problem:
      'A character can only have one MG06 property. This one is used under more than one, with no clear winner.',
    what_we_need_from_you: 'Pick the one MG06 code this character belongs to.',
    options: bare,
    YOUR_ANSWER: '',
    YOUR_NOTES: '',
  });
}

// ============ write ============
const cols = [
  'ref', 'issue', 'licensor', 'style_guide', 'character', 'places_used',
  'what_we_have', 'what_that_code_actually_is', 'the_problem',
  'what_we_need_from_you', 'options', 'YOUR_ANSWER', 'YOUR_NOTES',
];
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [cols.join(','), ...out.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
fs.writeFileSync(OUT, '\ufeff' + csv, 'utf8');

const by = {};
for (const r of out) by[r.issue] = (by[r.issue] || 0) + 1;
console.log('wrote', OUT);
console.log('rows:', out.length);
console.table(Object.entries(by).map(([issue, rows]) => ({ issue, rows })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
