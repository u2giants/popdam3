#!/usr/bin/env node
// Build one complete style-guide -> property decision sheet.
//
// Default: only rows that still need a licensing-team answer.
// --all: all 335 populated style guides for audit.
// --out <path>: write to another path.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'docs', 'verification', 'style-guide-property-mapping-20260726');
const RECONCILE_DIR = join(HERE, '..', 'docs', 'verification', 'characters-property-reconcile-20260726');
const readJson = (file) => JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8').replace(/^﻿/, ''));
const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const outIndex = argv.indexOf('--out');
const OUT = outIndex >= 0 ? argv[outIndex + 1] : join(DATA_DIR, 'style-guide-property-mapping.csv');

if (outIndex >= 0 && !OUT) throw new Error('--out requires a path');

const norm = (value) => (value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  return rows.filter((candidate) => candidate.some((cell) => cell !== ''));
}

const sourceRows = readJson('style-guide-source-rows.json');
const coldlion = (() => {
  const seen = new Set();
  const rows = [];
  for (const row of readJson('coldlion_mg06.json')) {
    if (!['CW001', 'SP001'].includes(row.div)) continue;
    const key = `${row.code}|${row.desc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ code: row.code, desc: row.desc });
  }
  return rows;
})();

const reconcileRows = (() => {
  const parsed = parseCsv(readFileSync(join(RECONCILE_DIR, 'property-reconcile.csv'), 'utf8'));
  const header = parsed.shift();
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  return parsed.map((row) => Object.fromEntries(header.map((name) => [name, row[index[name]]])));
})();

const acceptedDirect = new Map();
for (const row of reconcileRows) {
  if (row.match_method !== 'normalized_name' || Number(row.character_rows) === 0) continue;
  const key = norm(row.legacy_property);
  if (acceptedDirect.has(key)) throw new Error(`duplicate accepted direct property: ${row.legacy_property}`);
  acceptedDirect.set(key, {
    code: row.core_property_code,
    desc: row.core_property_name,
  });
}

const CONFIRMED_CLASSICS = new Set([
  '101 dalmatians',
  'aristocats',
  'bambi',
  'jungle book',
  'lion king',
]);
const CONFIRMED_NO_CODE = new Set([
  'inside out',
  'kim possible',
  'luca',
]);

const folders = readFileSync(join(DATA_DIR, 'styleguide_tree.txt'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const parts = line.split('/').slice(3);
    return {
      licensor: parts[0] || '',
      property: parts[1] || '',
      name: parts[parts.length - 1],
      depth: parts.length,
    };
  })
  .filter((folder) => folder.depth >= 2);

const LICENSOR_FOLDERS = {
  WB: ['WB'],
  Marvel: ['Marvel Style Guide'],
  'Dis/Mrv/SW': ['Disney', 'Marvel Style Guide', 'Star Wars'],
  'Coca Cola': ['Coca Cola'],
  'Strawberry Shortcake': ['Strawberry Shortcake'],
  WWE: ['WWE'],
};
const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'with', 'no', 'likeness', 'tv', 'vol', 'x']);
const FOLDER_STOP = new Set([...STOP, 'style', 'guide', 'guides', 'portfolio', 'art', 'archive',
  'publishing', 'branding', 'packaging', 'holiday', 'seasonal', 'opportunity', 'case', 'by',
  'pdfs', 'pdf', 'assets', 'asset', 'gallery', 'wip', 'updated', 'other', 'general', 'core', 'group']);
const tokens = (value, stop) => new Set(norm(value).split(' ')
  .filter((token) => token && !stop.has(token) && !/^\d{4}$/.test(token) && token.length > 1));

function overlap(left, right, stop) {
  const leftTokens = tokens(left, stop);
  const rightTokens = tokens(right, stop);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection++;
  if (!intersection) return 0;
  const jaccard = intersection / (leftTokens.size + rightTokens.size - intersection);
  return intersection === leftTokens.size || intersection === rightTokens.size
    ? Math.max(jaccard, 0.5 + 0.4 * jaccard)
    : jaccard;
}

function coldlionScore(styleGuide, property) {
  const left = norm(styleGuide);
  const right = norm(property.desc);
  if (!left || !right) return 0;
  let score = overlap(styleGuide, property.desc, STOP);
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (long === short || long.startsWith(`${short} `)) {
    score = Math.max(score, 0.62 + 0.38 * (short.length / long.length));
  }
  return score;
}

function coldlionGuess(styleGuide) {
  return coldlion
    .map((property) => ({ property, score: coldlionScore(styleGuide, property) }))
    .filter((candidate) => candidate.score >= 0.28)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function folderGuess(licensor, styleGuide) {
  const allowed = LICENSOR_FOLDERS[licensor];
  let best = null;
  for (const folder of folders) {
    if (allowed && !allowed.includes(folder.licensor)) continue;
    const score = overlap(styleGuide, folder.name, FOLDER_STOP);
    const ranked = score + (folder.depth === 2 ? 0.001 : 0);
    if (!best || ranked > best.ranked) best = { score, ranked, folder };
  }
  return best && best.score >= 0.4
    ? {
      property: best.folder.property,
      leaf: best.folder.depth === 3 ? best.folder.name : '',
      confidence: Math.round(best.score * 100),
    }
    : null;
}

function exactSourceSuggestion(row) {
  if (row.bucket !== 'name-matched' || !row.resolved_property) return null;
  const matches = coldlion.filter((property) => norm(property.desc) === norm(row.resolved_property));
  return matches.length === 1 ? matches[0] : null;
}

function decision(row, fuzzy) {
  const key = norm(row.style_guide);
  const direct = acceptedDirect.get(key);
  if (direct) {
    return {
      status: 'ACCEPTED_DIRECT',
      code: direct.code,
      desc: direct.desc,
      basis: 'Owner accepted exact normalized DAM parent + licensor agreement',
      finalCode: direct.code,
    };
  }
  if (CONFIRMED_CLASSICS.has(key)) {
    return {
      status: 'ACCEPTED_CLASSIC_CP',
      code: 'CP',
      desc: 'CLASSIC PROPERTIES',
      basis: 'Owner-confirmed Disney Classic',
      finalCode: 'CP',
    };
  }
  if (CONFIRMED_NO_CODE.has(key)) {
    return {
      status: 'ACCEPTED_NO_CODE',
      code: 'NONE',
      desc: 'No Coldlion property code',
      basis: 'Owner confirmed no code; do not create a placeholder',
      finalCode: 'NONE',
    };
  }
  const exact = exactSourceSuggestion(row);
  if (exact) {
    return {
      status: 'ACCEPTED_CLEAR_MG06',
      code: exact.code,
      desc: exact.desc,
      basis: 'Clear existing MG06 property name match',
      finalCode: exact.code,
    };
  }
  if (fuzzy && fuzzy.score >= 0.7) {
    return {
      status: 'ACCEPTED_CLEAR_MG06',
      code: fuzzy.property.code,
      desc: fuzzy.property.desc,
      basis: 'Strong existing MG06 name match (70% or higher)',
      finalCode: fuzzy.property.code,
    };
  }
  return {
    status: 'NEEDS_REVIEW',
    code: '',
    desc: '',
    basis: '',
    finalCode: '',
  };
}

const HEADER = [
  'licensor',
  'style_guide',
  'characters',
  'decision_status',
  'suggested_existing_mg06_code',
  'suggested_existing_mg06_desc',
  'decision_basis',
  'folder_property',
  'folder_leaf_match',
  'folder_confidence',
  'fuzzy_mg06_code',
  'fuzzy_mg06_desc',
  'fuzzy_confidence',
  'final_mg06_code',
];
const csv = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const lines = [HEADER.join(',')];
const stats = {};
for (const row of sourceRows) {
  const fuzzy = coldlionGuess(row.style_guide);
  const resolved = decision(row, fuzzy);
  stats[resolved.status] = (stats[resolved.status] || 0) + 1;
  if (!ALL && resolved.status !== 'NEEDS_REVIEW') continue;
  const folder = folderGuess(row.licensor, row.style_guide);
  lines.push([
    row.licensor,
    row.style_guide,
    row.characters,
    resolved.status,
    resolved.code,
    resolved.desc,
    resolved.basis,
    folder?.property ?? '',
    folder?.leaf ?? '',
    folder ? `${folder.confidence}%` : '',
    fuzzy?.property.code ?? '',
    fuzzy?.property.desc ?? '',
    fuzzy ? `${Math.round(fuzzy.score * 100)}%` : '',
    resolved.finalCode,
  ].map(csv).join(','));
}

writeFileSync(OUT, `${lines.join('\r\n')}\r\n`, 'utf8');
console.log(`wrote ${OUT}`);
console.log(`  rows: ${lines.length - 1}`);
for (const [status, count] of Object.entries(stats)) console.log(`  ${status}: ${count}`);
