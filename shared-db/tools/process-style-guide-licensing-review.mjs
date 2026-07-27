#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
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
    const status = classifyCandidates(candidates, sentinels.has(norm(row.character_name)));
    multipleRows.push({
      style_guide: row.style_guide,
      character_name: row.character_name,
      source_character_id: row.source_character_id,
      candidate_mg06_codes: candidates.join('|'),
      status,
    });
  }
  assert.equal(multipleRows.length, 338, 'expected 338 appearances under MULTIPLE style guides');

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
  copyFileSync(inputPath, rawCopy);
  writeCsv(
    join(outputDir, 'licensing-responses-normalized.csv'),
    ['licensor', 'style_guide', 'characters', 'licensing_answer', 'outcome', 'final_mg06_code'],
    normalizedReturns,
  );
  writeCsv(
    join(outputDir, 'multiple-style-guide-character-reconcile.csv'),
    ['style_guide', 'character_name', 'source_character_id', 'candidate_mg06_codes', 'status'],
    multipleRows,
  );
  writeCsv(
    join(outputDir, 'multiple-style-guide-character-exceptions.csv'),
    ['style_guide', 'character_name', 'source_character_id', 'candidate_mg06_codes', 'status'],
    exceptions,
  );
  writeCsv(
    join(outputDir, 'multiple-character-followup-for-licensing.csv'),
    ['character_name', 'style_guides', 'candidate_mg06_codes', 'reason', 'final_mg06_code'],
    followup,
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
| One unique property found automatically | ${count(reconcileCounts, 'AUTO_UNIQUE')} |
| Conflicting properties found | ${count(reconcileCounts, 'CONFLICT')} |
| No property found | ${count(reconcileCounts, 'UNMATCHED')} |
| Royalty sentinel excluded | ${count(reconcileCounts, 'SENTINEL_EXCLUDED')} |
| **Total** | **${multipleRows.length}** |

Only the conflict and unmatched rows belong in a licensing follow-up.
The deduplicated licensing follow-up contains **${followup.length} character names**.
Use \`multiple-character-followup-for-licensing.xlsx\` for the licensing team.
They should fill only \`final_mg06_code\` with an existing MG06 code or \`never designed\`.
They should not enter \`multiple\`, because every row now represents one character.

## Rules

- An existing MG06 answer maps the style guide to that canonical property code.
- Never designed keeps the style guide, leaves its property blank, and never creates a placeholder property.
- Multiple leaves the style guide property blank.
- A character under Multiple is accepted automatically only when its normalized name, within the same licensor, resolves to exactly one MG06 code through already resolved style guides.
- Conflicts and unmatched names require licensing review.
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
      autoUnique: count(reconcileCounts, 'AUTO_UNIQUE'),
      conflict: count(reconcileCounts, 'CONFLICT'),
      unmatched: count(reconcileCounts, 'UNMATCHED'),
      sentinelExcluded: count(reconcileCounts, 'SENTINEL_EXCLUDED'),
      exceptions: exceptions.length,
      followupCharacters: followup.length,
    },
  }, null, 2));
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
