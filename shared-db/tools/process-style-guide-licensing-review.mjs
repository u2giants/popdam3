#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const norm = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  return rows.filter((candidate) => candidate.some((cell) => cell !== ''));
}

export function csvObjects(text) {
  const rows = parseCsv(text);
  const header = rows.shift();
  return rows.map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])));
}

export function classifyResponse(value, validCodes) {
  const answer = String(value ?? '').trim();
  const normalized = answer.toLowerCase();
  if (normalized === 'never designed') {
    return { outcome: 'NEVER_DESIGNED', finalCode: '' };
  }
  if (normalized === 'multiple') {
    return { outcome: 'MULTIPLE', finalCode: '' };
  }
  const code = answer.toUpperCase();
  assert(validCodes.has(code), `unknown MG06 code in licensing response: ${answer}`);
  return { outcome: 'EXISTING_MG06', finalCode: code };
}

export function classifyCandidates(candidates, sentinel = false) {
  if (sentinel) return 'SENTINEL_EXCLUDED';
  if (candidates.length === 0) return 'UNMATCHED';
  if (candidates.length === 1) return 'AUTO_UNIQUE';
  return 'CONFLICT';
}

export const cleanCharacterName = (value) => String(value ?? '')
  .replace(/\(\s*Marvel Cross-Franchise Art Packs\s*\)/gi, '')
  .replace(/\s+/g, ' ')
  .replace(/\s+\)$/, '')
  .trim();

const franchiseRules = new Map();
let ruleUniverse = 'DC';
const addRule = (code, basis, names) => {
  for (const name of names) {
    const key = `${ruleUniverse}|${norm(name)}`;
    assert(!franchiseRules.has(key), `duplicate franchise rule for ${name}`);
    franchiseRules.set(key, { code, basis });
  }
};

addRule('AQ', 'Aquaman character family', [
  'Aquaman aka Arthur Curry', 'Black Manta',
]);
addRule('BM', 'Batman character family', [
  'Ace the Bat-Hound', 'Bane', 'Batgirl aka Barbara Gordon', 'Batman', 'Catwoman',
  'Killer Croc', 'Mister Freeze', 'Penguin', 'Poison Ivy', 'Riddler',
  'Robin aka Dick Grayson', 'Scarecrow aka Jonathan Crane', 'Solomon Grundy',
  'Two Face aka Harvey Dent',
]);
addRule('FS', 'Flash character family', [
  'Captain Cold', 'Flash', 'Gorilla Grod', 'Reverse Flash',
  'The Flash aka Jason Peter "Jay" Garrick',
]);
addRule('GN', 'Green Lantern character family', [
  'Green Lantern', 'Green Lantern aka Alan Scott', 'Green Lantern aka Hal Jordan',
  'Sinestro',
]);
addRule('HQ', 'Harley Quinn exact character property', [
  'Harley Quinn aka Dr. Harleen Francis Quinzel',
]);
addRule('JK', 'Joker exact character property', ['Joker']);
addRule('SG', 'Supergirl exact character property', ['Supergirl']);
addRule('SM', 'Superman character family', [
  'Bizzaro', 'Brainiac', 'Doomsday', 'Krypto', 'Lex Luthor', 'Mettalo',
  'Streaky the Supercat', 'Superman aka Clark Kent aka Kal-EI',
]);
addRule('WW', 'Wonder Woman character family', [
  'Cheetah', 'Wonder Woman', 'Wonder Woman aka Princess Diana aka Diana Prince',
]);
addRule('JG', 'Justice League umbrella', [
  'Bumblebee aka Karen Beecher Duncan', 'Cyborg aka Victor "Vic" Stone',
  'Darkseid', 'Green Arrow',
]);

ruleUniverse = 'MARVEL';
addRule('BP', 'Black Panther character family', [
  'Black Panther', 'Killmonger, Erik', 'Klaw', 'Okoye', 'Shuri', 'T`Challa',
]);
addRule('BW', 'Black Widow exact character property', ['Black Widow']);
addRule('CA', 'Captain America character family', [
  'Barnes, Bucky', 'Baron Zemo', 'Cap-Wolf', 'Captain America',
  'Captain America (Sam Wilson)', 'Crossbones', 'Falcon', 'Red Skull',
  'Rogers, Steve', 'Winter Soldier', 'Zola, Arnim',
]);
addRule('CM', 'Captain Marvel character family', [
  'Captain Mar-Vell', 'Captain Marvel', 'Flerkittens', 'Goose', 'Photon',
]);
addRule('DP', 'Deadpool exact character property', ['Deadpool']);
addRule('DR', 'Doctor Strange character family', [
  'Baron Mordo', 'Dormammu', 'Dr. Strange', 'Wong',
]);
addRule('ER', 'Eternals character family', [
  'Druig', 'Gilgamesh', 'Ikaris', 'Kingo', 'Makkari', 'Phastos', 'Sersi',
  'Sprite', 'Thena',
]);
addRule('GG', 'Guardians of the Galaxy character family', [
  'Collector', 'Cosmo', 'Drax', 'Ego the Living Planet', 'Gamora',
  'Grandmaster', 'Guardians of the Galaxy Logo', 'Mantis', 'Nebula',
  'Ronan the Accuser', 'Star-Lord', 'The Milano', 'Yondu',
]);
addRule('GR', 'Groot exact character property', ['Groot']);
addRule('HU', 'Hulk character family', [
  'Abomination', 'Hulk', 'Leader', 'Red Hulk', 'She-Hulk',
  'Thunderbolt Ross', 'Mechasaur Gamma Smasher',
]);
addRule('LK', 'Loki character family', ['Alligator Loki', 'Loki']);
addRule('MK', 'Moon Knight exact character property', ['Moon Knight']);
addRule('PU', 'Punisher exact character property', ['Punisher']);
addRule('RM', 'Iron Man character family', [
  'Hulkbuster Armor Iron Man', 'Iron Man', 'Mechasaur Iron Stomper',
  'Stark Industries', 'Stark, Tony', 'War Machine',
]);
addRule('RR', 'Rocket Raccoon exact character property', ['Rocket Raccoon']);
addRule('SP', 'Spider-Man character family', [
  'Doctor Octopus', 'Electro', 'Electro (Francine Frye)',
  'Ghost-Spider', 'Green Goblin', 'Hobgoblin', 'Iron Spider-Man',
  'Jack o Lantern', 'Jackal', 'Jameson, J. Jonah', 'Kraven the Hunter',
  'Lizard', 'Man-Spider', 'Morales, Miles', 'Morbius', 'Mysterio',
  'O`Hara, Miguel', 'Parker, May', 'Parker, Peter', 'Parker, Richard',
  'Prowler', 'Rhino', 'Sandman', 'Scarlet Spider Ben Reilly', 'Scorpion',
  'Shocker', 'Silk', 'Spider Woman', 'Spider-Girl',
  'Spider-Girl (Anya Corazon)', 'Spider-Ham', 'Spider-Man', 'Spider-Man 2099',
  'Spider-Rex', 'Spot', 'Spyder-Knight', 'Stacy, Gwen',
  'Superior Spider-Man', 'Ultimate Spider-Man Morales', 'Vulture',
  'Watson, Mary Jane',
]);
addRule('TH', 'Thor character family', [
  'Enchantress', 'Hela', 'Mighty Thor', 'Skurge', 'Thor', 'Thor (Female)',
  'Throg', 'Valkyrie', 'Mechasaur Thunderhoof',
]);
addRule('TN', 'Thanos character family', ['Infinity Gauntlet', 'Thanos']);
addRule('VN', 'Venom character family', ['Agent Venom', 'Carnage', 'Venom']);
addRule('WR', 'Wolverine character family', ['Wolverine', 'X-23']);
addRule('XM', 'X-Men character family', [
  'Angel', 'Apocalypse', 'Archangel', 'Beast', 'Bishop', 'Colossus',
  'Cyclops', 'Frost, Emma', 'Gambit', 'Grey, Jean', 'Havok', 'Jubilee',
  'Juggernaut', 'Lockheed', 'Magik', 'Magneto', 'Marvel Girl',
  'Mr. Sinister', 'Nightcrawler', 'Polaris', 'Pryde, Kitty', 'Rogue',
  'Sentinel', 'Storm', 'Sunfire', 'Sunspot', 'Thunderbird', 'X-Men Logo',
]);
addRule('AV', 'Avengers character family', [
  'A.I.M.', 'Absorbing Man', 'Ant-Man', 'Avengers Logo', 'Bulldozer',
  'Coulson, Phil', 'Echo', 'Giant Man', 'Hawkeye', 'Hercules', 'Hill, Maria',
  'Jarvis', 'Kang', 'M.O.D.O.K', 'Madame Masque',
  'Mech Strike Mechasaurs (General)', 'Mech Strike Mechasaurs Logo',
  'Mechasaur Dragonscale',
  'Mechasaur Guardian', 'Mechasaur R4ptor Sentries', 'Mechasaur Redwing',
  'Mechasaur Sabre Claw', 'Mechasaur T-R3x', 'Mechasaur Ultron Primeval',
  'Nick Fury', 'Patriot', 'Piledriver', 'Pym, Hank', 'Quake', 'Quinjet',
  'Ronin', 'S.H.I.E.L.D.', 'Scarlet Witch', 'Sentry',
  'Squirrel Girl', 'Task Master', 'Thunderball', 'Tigra', 'Ultron',
  'Ultron Drone', 'Vision', 'Wasp', 'Wonder Man', 'Wrecker',
  'Yellowjacket',
]);

export function classifyFranchiseCharacter(styleGuide, characterName, allowCatchAll = true) {
  const normalizedGuide = norm(styleGuide);
  const universe = normalizedGuide === norm('Marvel Cross-Franchise Art Packs')
    ? 'MARVEL'
    : [
        norm('DC Super Friends Collection Comics'),
        norm('DC Women Core'),
      ].includes(normalizedGuide)
      ? 'DC'
      : null;
  if (!universe) return null;
  const exact = franchiseRules.get(`${universe}|${norm(characterName)}`);
  if (exact) return { ...exact, rule: 'SPECIFIC_FRANCHISE' };
  if (!allowCatchAll) return null;
  if (universe === 'MARVEL') {
    return {
      code: 'MV',
      basis: 'Marvel Assorted Styles catch-all; no narrower current MG06 franchise rule',
      rule: 'MARVEL_CATCH_ALL',
    };
  }
  if (universe === 'DC') {
    return {
      code: 'DC',
      basis: 'DC Assorted Styles catch-all; no narrower current MG06 franchise rule',
      rule: 'DC_CATCH_ALL',
    };
  }
  return null;
}

export function isNonCharacterLabel(styleGuide, characterName) {
  const cleaned = cleanCharacterName(characterName);
  const normalized = norm(cleaned);
  return normalized === norm(styleGuide)
    || normalized === norm('Marvel Cross-Franchise Art Packs')
    || normalized.endsWith(' logo')
    || normalized.endsWith(' general');
}

const csv = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const writeCsv = (path, columns, rows) => {
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csv(row[column])).join(',')),
  ];
  writeFileSync(path, `${lines.join('\r\n')}\r\n`, 'utf8');
};

const getArg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

async function main() {
  const inputPath = resolve(getArg('--input'));
  const auditPath = resolve(getArg('--audit'));
  const outputDir = resolve(getArg('--output-dir'));
  assert(process.env.DB_PASSWORD, 'DB_PASSWORD is required');
  mkdirSync(outputDir, { recursive: true });

  const coldlionPath = join(dirname(auditPath), 'coldlion_mg06.json');
  const coldlion = JSON.parse(readFileSync(coldlionPath, 'utf8').replace(/^﻿/, ''));
  const validCodes = new Set(coldlion
    .filter((row) => ['CW001', 'SP001'].includes(row.div))
    .map((row) => String(row.code).toUpperCase()));

  const auditRows = csvObjects(readFileSync(auditPath, 'utf8'));
  const returnedRows = csvObjects(readFileSync(inputPath, 'utf8'));
  assert.equal(auditRows.length, 335, 'audit sheet must contain all 335 style guides');
  assert.equal(returnedRows.length, 153, 'licensing return must contain all 153 review rows');

  const decisions = new Map();
  for (const row of auditRows) {
    const key = norm(row.style_guide);
    assert(!decisions.has(key), `duplicate style guide: ${row.style_guide}`);
    const noCode = row.decision_status === 'ACCEPTED_NO_CODE';
    decisions.set(key, {
      styleGuide: row.style_guide,
      outcome: noCode ? 'NO_CODE' : 'EXISTING_MG06',
      finalCode: noCode ? '' : row.final_mg06_code,
      source: row.decision_status,
    });
  }

  const normalizedReturns = [];
  for (const row of returnedRows) {
    const key = norm(row.style_guide);
    const answer = classifyResponse(row.fuzzy_mg06_code, validCodes);
    assert(decisions.has(key), `returned style guide missing from audit: ${row.style_guide}`);
    decisions.set(key, {
      styleGuide: row.style_guide,
      outcome: answer.outcome,
      finalCode: answer.finalCode,
      source: 'LICENSING_REVIEW_20260727',
    });
    normalizedReturns.push({
      licensor: row.licensor,
      style_guide: row.style_guide,
      characters: row.characters,
      licensing_answer: row.fuzzy_mg06_code.trim(),
      outcome: answer.outcome,
      final_mg06_code: answer.finalCode,
    });
  }

  assert.equal(decisions.size, 335);
  for (const decision of decisions.values()) {
    if (decision.outcome === 'EXISTING_MG06') {
      assert(validCodes.has(decision.finalCode), `invalid final code ${decision.finalCode} for ${decision.styleGuide}`);
    }
  }

  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const client = new Client({
    host: 'aws-1-us-east-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.qsllyeztdwjgirsysgai',
    database: 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const result = await client.query(`
    select
      sg.id as style_guide_row_id,
      sg.name as style_guide,
      sg.licensor_id,
      ch.id as character_row_id,
      ch.name as character_name,
      ch.source_character_id
    from dflow.property_character_associations a
    join dflow.properties_and_characters sg
      on sg.id = a.property_id
     and sg.type = 'PROPERTY'
    join dflow.properties_and_characters ch
      on ch.id = a.character_id
     and ch.type = 'CHARACTER'
    order by sg.name, ch.name, ch.id
  `);
  await client.end();
  assert.equal(result.rows.length, 9622, 'expected 9,622 style-guide character appearances');

  const candidatesByCharacter = new Map();
  for (const row of result.rows) {
    const decision = decisions.get(norm(row.style_guide));
    assert(decision, `database style guide missing from decision map: ${row.style_guide}`);
    if (decision.outcome !== 'EXISTING_MG06') continue;
    const key = `${row.licensor_id}|${norm(row.character_name)}`;
    if (!candidatesByCharacter.has(key)) candidatesByCharacter.set(key, new Set());
    candidatesByCharacter.get(key).add(decision.finalCode);
  }

  const sentinels = new Set(['no reportable elements', 'no character likeness', 'logo']);
  const multipleRows = [];
  for (const row of result.rows) {
    const decision = decisions.get(norm(row.style_guide));
    if (decision.outcome !== 'MULTIPLE') continue;
    const key = `${row.licensor_id}|${norm(row.character_name)}`;
    const candidates = [...(candidatesByCharacter.get(key) ?? new Set())].sort();
    const sentinel = sentinels.has(norm(row.character_name));
    const nonCharacter = isNonCharacterLabel(row.style_guide, row.character_name);
    const specificFranchise = sentinel
      ? null
      : classifyFranchiseCharacter(row.style_guide, cleanCharacterName(row.character_name), false);
    const franchise = specificFranchise
      ?? (candidates.length === 1
        ? {
            code: candidates[0],
            basis: 'One unique same-licensor property found in already resolved style guides',
            rule: 'AUTO_UNIQUE',
          }
        : sentinel
          ? null
          : classifyFranchiseCharacter(row.style_guide, cleanCharacterName(row.character_name)));
    const status = sentinel
      ? 'SENTINEL_EXCLUDED'
      : nonCharacter
        ? 'NON_CHARACTER_EXCLUDED'
      : franchise
        ? franchise.rule
        : classifyCandidates(candidates);
    multipleRows.push({
      style_guide: row.style_guide,
      character_name: row.character_name,
      source_character_id: row.source_character_id,
      candidate_mg06_codes: candidates.join('|'),
      status,
      final_mg06_code: ['SENTINEL_EXCLUDED', 'NON_CHARACTER_EXCLUDED'].includes(status)
        ? ''
        : franchise?.code ?? (status === 'AUTO_UNIQUE' ? candidates[0] : ''),
      rule_basis: status === 'NON_CHARACTER_EXCLUDED'
        ? 'Guide, logo, or general label; not a canonical character'
        : status === 'SENTINEL_EXCLUDED'
          ? 'Royalty reporting sentinel; not a canonical character'
          : franchise?.basis ?? '',
    });
  }
  assert.equal(multipleRows.length, 338, 'expected 338 appearances under MULTIPLE style guides');
  for (const row of multipleRows) {
    if (['SENTINEL_EXCLUDED', 'NON_CHARACTER_EXCLUDED'].includes(row.status)) continue;
    assert(validCodes.has(row.final_mg06_code), `invalid franchise code for ${row.character_name}`);
  }

  const exceptions = multipleRows.filter((row) => ['UNMATCHED', 'CONFLICT'].includes(row.status));
  const followupByCharacter = new Map();
  for (const row of exceptions) {
    const cleaned = cleanCharacterName(row.character_name);
    const key = norm(cleaned);
    const current = followupByCharacter.get(key) ?? {
      character_name: cleaned,
      style_guides: new Set(),
      candidate_mg06_codes: new Set(),
    };
    current.style_guides.add(row.style_guide);
    for (const code of row.candidate_mg06_codes.split('|').filter(Boolean)) {
      current.candidate_mg06_codes.add(code);
    }
    followupByCharacter.set(key, current);
  }
  const followup = [...followupByCharacter.values()]
    .map((row) => {
      const candidates = [...row.candidate_mg06_codes].sort();
      return {
        character_name: row.character_name,
        style_guides: [...row.style_guides].sort().join(' | '),
        candidate_mg06_codes: candidates.join('|'),
        reason: candidates.length ? 'CONFLICT' : 'UNMATCHED',
        final_mg06_code: '',
      };
    })
    .sort((left, right) => left.character_name.localeCompare(right.character_name));
  const rawCopy = join(outputDir, 'licensing-returned-style-guide-property-mapping.csv');
  for (const obsolete of [
    'multiple-character-followup-for-licensing.csv',
    'multiple-character-followup-for-licensing.xlsx',
    'multiple-style-guide-character-exceptions.csv',
  ]) {
    rmSync(join(outputDir, obsolete), { force: true });
  }
  copyFileSync(inputPath, rawCopy);
  writeCsv(
    join(outputDir, 'licensing-responses-normalized.csv'),
    ['licensor', 'style_guide', 'characters', 'licensing_answer', 'outcome', 'final_mg06_code'],
    normalizedReturns,
  );
  writeCsv(
    join(outputDir, 'multiple-style-guide-character-reconcile.csv'),
    ['style_guide', 'character_name', 'source_character_id', 'candidate_mg06_codes', 'status', 'final_mg06_code', 'rule_basis'],
    multipleRows,
  );
  const returnedCounts = Object.groupBy(normalizedReturns, (row) => row.outcome);
  const reconcileCounts = Object.groupBy(multipleRows, (row) => row.status);
  const count = (group, key) => group[key]?.length ?? 0;
  const readme = `# Licensing review results and MULTIPLE reconciliation

**Captured:** 2026-07-27

**Database work:** read-only. No row or schema was changed.

## Licensing answers

| Answer | Style guides | Character appearances |
|---|---:|---:|
| Existing MG06 code | ${count(returnedCounts, 'EXISTING_MG06')} | ${normalizedReturns.filter((row) => row.outcome === 'EXISTING_MG06').reduce((sum, row) => sum + Number(row.characters), 0)} |
| Never designed | ${count(returnedCounts, 'NEVER_DESIGNED')} | ${normalizedReturns.filter((row) => row.outcome === 'NEVER_DESIGNED').reduce((sum, row) => sum + Number(row.characters), 0)} |
| Multiple | ${count(returnedCounts, 'MULTIPLE')} | ${normalizedReturns.filter((row) => row.outcome === 'MULTIPLE').reduce((sum, row) => sum + Number(row.characters), 0)} |

All returned MG06 codes exist in the captured Coldlion MG06 dictionary.

## MULTIPLE character reconciliation

| Result | Character appearances |
|---|---:|
| Specific franchise rule | ${count(reconcileCounts, 'SPECIFIC_FRANCHISE')} |
| One unique property found automatically | ${count(reconcileCounts, 'AUTO_UNIQUE')} |
| Marvel catch-all rule | ${count(reconcileCounts, 'MARVEL_CATCH_ALL')} |
| DC catch-all rule | ${count(reconcileCounts, 'DC_CATCH_ALL')} |
| Conflicting properties found | ${count(reconcileCounts, 'CONFLICT')} |
| No property found | ${count(reconcileCounts, 'UNMATCHED')} |
| Non-character labels excluded | ${count(reconcileCounts, 'NON_CHARACTER_EXCLUDED')} |
| Royalty sentinel excluded | ${count(reconcileCounts, 'SENTINEL_EXCLUDED')} |
| **Total** | **${multipleRows.length}** |

Specific rules use the closest existing MG06 franchise. Characters without a narrower current
Marvel or DC property use the existing \`MV\` or \`DC\` assorted-styles property. The licensing
follow-up now contains **${followup.length} character names**.

The retired 305-row licensing workbook was removed. \`character-franchise-rule-audit.xlsx\` is
internal evidence only and must not be sent to licensing.

## Rules

- An existing MG06 answer maps the style guide to that canonical property code.
- Never designed keeps the style guide, leaves its property blank, and never creates a placeholder property.
- Multiple leaves the style guide property blank.
- A character under Multiple uses the closest specific existing MG06 franchise code.
- A unique same-licensor match from resolved style guides is preserved when no specific rule exists.
- A Marvel or DC character with no narrower current property uses \`MV\` or \`DC\`.
- Royalty sentinels are excluded from canonical characters.
`;
  writeFileSync(join(outputDir, 'README.md'), readme, 'utf8');

  console.log(JSON.stringify({
    returned: {
      existingMg06: count(returnedCounts, 'EXISTING_MG06'),
      neverDesigned: count(returnedCounts, 'NEVER_DESIGNED'),
      multiple: count(returnedCounts, 'MULTIPLE'),
    },
    multipleReconcile: {
      specificFranchise: count(reconcileCounts, 'SPECIFIC_FRANCHISE'),
      autoUnique: count(reconcileCounts, 'AUTO_UNIQUE'),
      marvelCatchAll: count(reconcileCounts, 'MARVEL_CATCH_ALL'),
      dcCatchAll: count(reconcileCounts, 'DC_CATCH_ALL'),
      nonCharacterExcluded: count(reconcileCounts, 'NON_CHARACTER_EXCLUDED'),
      conflict: count(reconcileCounts, 'CONFLICT'),
      unmatched: count(reconcileCounts, 'UNMATCHED'),
      sentinelExcluded: count(reconcileCounts, 'SENTINEL_EXCLUDED'),
      exceptions: exceptions.length,
      followupCharacters: followup.length,
    },
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
