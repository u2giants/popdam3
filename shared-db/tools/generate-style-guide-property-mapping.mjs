#!/usr/bin/env node
// Regenerate the style-guide -> property review sheet for the licensing team.
//
//   node tools/generate-style-guide-property-mapping.mjs [--all] [--out <path>]
//
// Emits, by default, ONLY the rows that still need a human decision
// (bucket 'needs-review'). Pass --all to emit all 335 style guides.
//
// Inputs (checked in under docs/verification/style-guide-property-mapping-20260726/):
//   style-guide-source-rows.json  the 335 style guides that have characters, pre-bucketed
//   coldlion_mg06.json            Coldlion MG06 property dictionary, all divisions
//   styleguide_tree.txt           folder listing from edge1:/volume1/styleguides
//
// See docs/style-guides-characters-and-royalties.md for the model these encode, and
// that folder's README.md for how each input was captured and how to refresh it.
//
// IMPORTANT: the two match columns are FUZZY TEXT SIMILARITY, not authority. They exist to
// give the licensing team a starting point. The authoritative answer is whatever a human
// puts in the final column. A blank guess is itself a finding: it usually means no property
// code exists for that title in Coldlion or on the style-guide server.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'docs', 'verification', 'style-guide-property-mapping-20260726');
const readJson = (f) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8').replace(/^﻿/, ''));

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const outIdx = argv.indexOf('--out');
const OUT = outIdx !== -1 ? argv[outIdx + 1] : join(DATA_DIR, 'style-guide-property-mapping.csv');

// ---------------------------------------------------------------- inputs
const ROWS = readJson('style-guide-source-rows.json');

// Coldlion properties: licensed divisions only. CW001/SP001 are the two divisions where
// mgTypeCode 06 actually means "Property" (docs/merch-group-taxonomy-architecture.md §2).
const COLDLION = (() => {
  const seen = new Set();
  const out = [];
  for (const r of readJson('coldlion_mg06.json')) {
    if (r.div !== 'CW001' && r.div !== 'SP001') continue;
    const k = `${r.code}|${r.desc}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ code: r.code, desc: r.desc });
  }
  return out;
})();

// Style-guide server tree: /volume1/styleguides/<licensor L1>/<property L2>/<leaf L3>
const FOLDERS = readFileSync(join(DATA_DIR, 'styleguide_tree.txt'), 'utf8')
  .split(/\r?\n/).filter(Boolean)
  .map((line) => {
    const parts = line.split('/').slice(3); // drop '', volume1, styleguides
    return { lic: parts[0] || '', prop: parts[1] || '', name: parts[parts.length - 1], depth: parts.length };
  })
  .filter((f) => f.depth >= 2);

// Constrain folder matching to the same licensor, so a WB title cannot match a Marvel folder.
const LICENSOR_FOLDERS = {
  'WB': ['WB'],
  'Marvel': ['Marvel Style Guide'],
  'Dis/Mrv/SW': ['Disney', 'Marvel Style Guide', 'Star Wars'],
  'Coca Cola': ['Coca Cola'],
  'Strawberry Shortcake': ['Strawberry Shortcake'],
  'WWE': ['WWE'],
};

// ---------------------------------------------------------------- matching
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
// Kept deliberately small: franchise-identifying words ("story", "marvel") must survive.
const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'with', 'no', 'likeness', 'tv', 'vol', 'x']);
// Folder names add their own noise vocabulary that never identifies a property.
const FOLDER_STOP = new Set([...STOP, 'style', 'guide', 'guides', 'portfolio', 'art', 'archive',
  'publishing', 'branding', 'packaging', 'holiday', 'seasonal', 'opportunity', 'case', 'by',
  'pdfs', 'pdf', 'assets', 'asset', 'gallery', 'wip', 'updated', 'other', 'general', 'core', 'group']);
const tokens = (s, stop) =>
  new Set(norm(s).split(' ').filter((t) => t && !stop.has(t) && !/^\d{4}$/.test(t) && t.length > 1));

function overlap(a, b, stop) {
  const ta = tokens(a, stop), tb = tokens(b, stop);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (!inter) return 0;
  const jaccard = inter / (ta.size + tb.size - inter);
  // One side fully contained in the other is a strong franchise signal.
  return inter === ta.size || inter === tb.size ? Math.max(jaccard, 0.5 + 0.4 * jaccard) : jaccard;
}

function coldlionScore(styleGuide, property) {
  const a = norm(styleGuide), b = norm(property.desc);
  if (!a || !b) return 0;
  let score = overlap(styleGuide, property.desc, STOP);
  // Whole-string prefix in EITHER direction: "Batman Core" ~ "BATMAN", "Toy Story" ~ "TOY STORY 4".
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long === short || long.startsWith(`${short} `)) {
    score = Math.max(score, 0.62 + 0.38 * (short.length / long.length));
  }
  return score;
}

const coldlionGuess = (styleGuide) =>
  COLDLION.map((p) => ({ p, s: coldlionScore(styleGuide, p) }))
    .filter((x) => x.s >= 0.28)
    .sort((x, y) => y.s - x.s)[0] ?? null;

function folderGuess(licensor, styleGuide) {
  const allowed = LICENSOR_FOLDERS[licensor];
  let best = null;
  for (const f of FOLDERS) {
    if (allowed && !allowed.includes(f.lic)) continue;
    const s = overlap(styleGuide, f.name, FOLDER_STOP);
    // Prefer a property-level (L2) hit over a leaf (L3) hit at equal score.
    const ranked = s + (f.depth === 2 ? 0.001 : 0);
    if (!best || ranked > best.ranked) best = { s, ranked, f };
  }
  return best && best.s >= 0.4
    ? { property: best.f.prop, leaf: best.f.depth === 3 ? best.f.name : '', conf: Math.round(best.s * 100) }
    : null;
}

// ---------------------------------------------------------------- output
const HEADER = ['licensor', 'style_guide', 'characters',
  'folder_property', 'folder_leaf_match', 'folder_confidence',
  'coldlion_mg06_code', 'coldlion_mg06_desc', 'coldlion_confidence',
  'final_mg06_code (licensing team fills in)'];
const csv = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const lines = [HEADER.join(',')];
const stats = { emitted: 0, folder: 0, coldlion: 0, neither: 0 };

for (const row of ROWS) {
  if (!ALL && row.bucket !== 'needs-review') continue;
  const folder = folderGuess(row.licensor, row.style_guide);
  const cold = coldlionGuess(row.style_guide);
  stats.emitted++;
  if (folder) stats.folder++;
  if (cold) stats.coldlion++;
  if (!folder && !cold) stats.neither++;
  lines.push([row.licensor, row.style_guide, row.characters,
    folder?.property ?? '', folder?.leaf ?? '', folder ? `${folder.conf}%` : '',
    cold?.p.code ?? '', cold?.p.desc ?? '', cold ? `${Math.round(cold.s * 100)}%` : '',
    ''].map(csv).join(','));
}

writeFileSync(OUT, `${lines.join('\r\n')}\r\n`, 'utf8');
console.log(`wrote ${OUT}`);
console.log(`  rows: ${stats.emitted}${ALL ? ' (all style guides)' : ' (needing a decision)'}`);
console.log(`  with folder-tree property: ${stats.folder}`);
console.log(`  with Coldlion guess:       ${stats.coldlion}`);
console.log(`  with NEITHER (true gaps):  ${stats.neither}`);
