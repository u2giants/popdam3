#!/usr/bin/env node

/**
 * Phase 3 read-only evidence generator: character identity resolution.
 *
 * Reads the 9,622 legacy character *appearances* from the preview database,
 * applies the deterministic identity rules in `resolve-character-identity.mjs`
 * and the already-reviewed style-guide → property decisions, and writes the
 * evidence a human needs to approve (or reject) the rules.
 *
 * READ ONLY. This script issues SELECTs and writes files. It never writes a row.
 *
 * Usage:
 *   PREVIEW_URL=<postgres url> node tools/analyze-character-identity-resolution.mjs \
 *     --output-dir docs/verification/character-identity-rules-20260728
 */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  csvObjects,
  norm,
  classifyResponse,
  classifyFranchiseCharacter,
  cleanCharacterName,
  lookupFranchiseRule,
} from './process-style-guide-licensing-review.mjs';
import {
  resolveIdentities,
  resolvePropertyForIdentity,
  validateStyleGuideProperty,
} from './resolve-character-identity.mjs';

/**
 * Corrections to the returned licensing sheet, each explicitly authorized by the
 * owner. The licensing evidence file is never overwritten — the original answer
 * stays visible and the correction sits beside it.
 */
export const AUTHORIZED_LICENSING_CORRECTIONS = [
  {
    styleGuide: 'Marvel Universe',
    from: 'MU',
    to: 'MV',
    authorizedBy: 'owner (Albert)',
    authorizedOn: '2026-07-29',
    reason: 'Typo in the returned review sheet. MU = MUPPETS (licensor DISNEY); the Marvel Universe style guide is Marvel, so the intended code is MV = MARVEL ASSORTED STYLES.',
  },
];

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFICATION = join(HERE, '..', 'docs', 'verification');

/** Legacy licensor ids used by the reviewed DC/Marvel franchise rule table. */
export const LICENSOR_UNIVERSE = { 2: 'DC', 3: 'MARVEL' };

const getArg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

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

/**
 * Build the style guide -> property decision map from the two reviewed sources:
 * the 335-row generator audit and the 153 returned licensing answers.
 */
export function buildStyleGuideDecisions({ auditRows, returnedRows, validCodes }) {
  const decisions = new Map();
  for (const row of auditRows) {
    const noCode = row.decision_status === 'ACCEPTED_NO_CODE';
    decisions.set(norm(row.style_guide), {
      styleGuide: row.style_guide,
      outcome: noCode ? 'NO_CODE' : 'EXISTING_MG06',
      code: noCode ? '' : row.final_mg06_code,
      source: row.decision_status,
    });
  }
  for (const row of returnedRows) {
    const answer = classifyResponse(row.fuzzy_mg06_code, validCodes);
    decisions.set(norm(row.style_guide), {
      styleGuide: row.style_guide,
      outcome: answer.outcome,
      code: answer.finalCode,
      source: 'LICENSING_REVIEW_20260727',
      licensingAnswer: answer.finalCode,
    });
  }
  for (const correction of AUTHORIZED_LICENSING_CORRECTIONS) {
    const key = norm(correction.styleGuide);
    const decision = decisions.get(key);
    assert(decision, `correction targets an unknown style guide: ${correction.styleGuide}`);
    assert.equal(decision.code, correction.from,
      `correction for ${correction.styleGuide} expected ${correction.from}, found ${decision.code}`);
    assert(validCodes.has(correction.to), `correction code not in the Coldlion MG06 list: ${correction.to}`);
    decisions.set(key, {
      ...decision,
      code: correction.to,
      source: `OWNER_CORRECTED_${correction.authorizedOn.replaceAll('-', '')}`,
      correction,
    });
  }
  return decisions;
}

/** The property code one appearance contributes, per the reviewed rules. */
export function propertyCodeForAppearance(row, decisions) {
  const decision = decisions.get(norm(row.styleGuide));
  if (!decision) return { code: null, via: 'NO_STYLE_GUIDE_DECISION' };
  // Fail closed: a decision that failed cross-licensor validation contributes no
  // property. It is never auto-corrected.
  if (decision.validationFailure) return { code: null, via: `BLOCKED_${decision.validationFailure}` };
  if (decision.outcome === 'EXISTING_MG06' && decision.code && decision.code !== 'NONE') {
    return { code: decision.code, via: 'STYLE_GUIDE_CODE' };
  }
  if (decision.outcome === 'MULTIPLE') {
    const franchise = classifyFranchiseCharacter(row.styleGuide, cleanCharacterName(row.characterName));
    return franchise
      ? { code: franchise.code, via: franchise.rule }
      : { code: null, via: 'MULTIPLE_UNRESOLVED' };
  }
  return { code: null, via: decision.outcome };
}

async function fetchAppearances(url) {
  // `pg` is deliberately not a dependency of this repo. Point PG_PACKAGE_PATH at
  // a scratch directory that already has it installed (see AGENTS.md §9).
  const require = createRequire(process.env.PG_PACKAGE_PATH
    ? `${resolve(process.env.PG_PACKAGE_PATH)}/`
    : import.meta.url);
  const { Client } = require('pg');
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });
  await client.connect();
  try {
    const result = await client.query(`
      select
        sg.id   as style_guide_id,
        sg.name as style_guide,
        sg.licensor_id,
        ch.id   as character_row_id,
        ch.name as character_name,
        ch.source_character_id
      from dflow.property_character_associations a
      join dflow.properties_and_characters sg
        on sg.id = a.property_id and sg.type = 'PROPERTY'
      join dflow.properties_and_characters ch
        on ch.id = a.character_id and ch.type = 'CHARACTER'
      order by sg.name, ch.name, ch.id
    `);
    const properties = await client.query(`
      select p.code, p.name, p.status, l.code as licensor_code, l.name as licensor_name
      from core.property p
      join core.licensor l on l.id = p.licensor_id
      order by p.code
    `);
    const canonical = await client.query(`
      select
        (select count(*) from core.character) as character_rows,
        (select count(*) from core.style_guide) as style_guide_rows,
        (select count(*) from core.style_guide_character) as bridge_rows
    `);
    return { appearances: result.rows, properties: properties.rows, canonical: canonical.rows[0] };
  } finally {
    await client.end();
  }
}

async function main() {
  const outputDir = resolve(getArg('--output-dir') ?? join(VERIFICATION, 'character-identity-rules-20260728'));
  assert(process.env.PREVIEW_URL, 'PREVIEW_URL is required (preview database, read-only)');
  mkdirSync(outputDir, { recursive: true });

  const mappingDir = join(VERIFICATION, 'style-guide-property-mapping-20260726');
  const coldlion = JSON.parse(readFileSync(join(mappingDir, 'coldlion_mg06.json'), 'utf8').replace(/^﻿/, ''));
  const validCodes = new Set(coldlion
    .filter((row) => ['CW001', 'SP001'].includes(row.div))
    .map((row) => String(row.code).toUpperCase()));
  const codeDesc = new Map(coldlion
    .filter((row) => ['CW001', 'SP001'].includes(row.div))
    .map((row) => [String(row.code).toUpperCase(), row.desc]));

  // The delivered 153-row sheet is a subset; regenerate the full 335-row audit.
  const auditPath = getArg('--audit');
  assert(auditPath, '--audit <path to the 335-row audit csv> is required (generate with tools/generate-style-guide-property-mapping.mjs --all)');
  const auditRows = csvObjects(readFileSync(resolve(auditPath), 'utf8'));
  assert.equal(auditRows.length, 335, 'audit sheet must contain all 335 populated style guides');
  const returnedRows = csvObjects(readFileSync(
    join(VERIFICATION, 'style-guide-licensing-review-20260727', 'licensing-returned-style-guide-property-mapping.csv'),
    'utf8',
  ));
  assert.equal(returnedRows.length, 153, 'licensing return must contain all 153 review rows');
  const decisions = buildStyleGuideDecisions({ auditRows, returnedRows, validCodes });
  assert.equal(decisions.size, 335);

  const { appearances: raw, properties, canonical } = await fetchAppearances(process.env.PREVIEW_URL);
  assert.equal(raw.length, 9622, `expected 9,622 appearances, saw ${raw.length}`);
  // This tool is read-only. The three canonical tables must still be empty.
  assert.equal(Number(canonical.character_rows), 0, 'core.character is not empty — this tool must not write');
  assert.equal(Number(canonical.style_guide_rows), 0, 'core.style_guide is not empty');
  assert.equal(Number(canonical.bridge_rows), 0, 'core.style_guide_character is not empty');

  const propertyByCode = new Map(properties.map((row) => [String(row.code).toUpperCase(), {
    code: String(row.code).toUpperCase(),
    name: row.name,
    licensorCode: row.licensor_code,
    licensorName: row.licensor_name,
  }]));

  // ---- cross-licensor validation across every style-guide property decision ----
  const legacyLicensorByGuide = new Map();
  const appearanceCountByGuide = new Map();
  for (const row of raw) {
    const key = norm(row.style_guide);
    legacyLicensorByGuide.set(key, row.licensor_id);
    appearanceCountByGuide.set(key, (appearanceCountByGuide.get(key) ?? 0) + 1);
  }

  const validationFailures = [];
  for (const [key, decision] of decisions) {
    if (decision.outcome !== 'EXISTING_MG06' || !decision.code || decision.code === 'NONE') continue;
    const result = validateStyleGuideProperty({
      legacyLicensorId: legacyLicensorByGuide.get(key),
      code: decision.code,
      property: propertyByCode.get(String(decision.code).toUpperCase()),
    });
    if (result.ok) continue;
    decision.validationFailure = result.failure;
    validationFailures.push({
      style_guide: decision.styleGuide,
      legacy_licensor_id: legacyLicensorByGuide.get(key) ?? '',
      appearances: appearanceCountByGuide.get(key) ?? 0,
      answered_code: decision.code,
      answered_property: propertyByCode.get(String(decision.code).toUpperCase())?.name ?? '(absent from core.property)',
      answered_licensor: propertyByCode.get(String(decision.code).toUpperCase())?.licensorCode ?? '',
      decision_source: decision.source,
      failure: result.failure,
      detail: result.detail,
    });
  }
  validationFailures.sort((l, r) => r.appearances - l.appearances || l.style_guide.localeCompare(r.style_guide));

  const appearances = raw.map((row) => ({
    styleGuideId: row.style_guide_id,
    styleGuide: row.style_guide,
    licensorId: row.licensor_id,
    characterRowId: row.character_row_id,
    characterName: row.character_name,
    sourceCharacterId: row.source_character_id,
  }));

  const { rows, identities, counts, ruleCounts } = resolveIdentities(appearances);

  // Idempotency: the rules are pure, so a second run must be identical.
  const second = resolveIdentities(appearances);
  assert.deepEqual(second.counts, counts, 'identity rules are not deterministic');

  // ---- property resolution per identity ----
  const identityIndex = new Map(identities.map((identity) => [identity.identityKey, identity]));
  for (const identity of identityIndex.values()) {
    identity.codeCounts = new Map();
    identity.styleGuides = new Set();
  }
  for (const row of rows) {
    if (row.status !== 'AUTO_RESOLVED') continue;
    const identity = identityIndex.get(row.identityKey);
    identity.styleGuides.add(row.styleGuide);
    const { code, via } = propertyCodeForAppearance(row, decisions);
    row.propertyCode = code ?? '';
    row.propertyVia = via;
    if (code) identity.codeCounts.set(code, (identity.codeCounts.get(code) ?? 0) + 1);
  }

  const propertyRuleCounts = {};
  const propertyReview = [];
  for (const identity of identityIndex.values()) {
    const universe = LICENSOR_UNIVERSE[identity.licensorId];
    const primary = identity.identityName.split(/\s+aka\s+/i)[0];
    const franchise = universe
      ? (lookupFranchiseRule(universe, identity.identityName) ?? lookupFranchiseRule(universe, primary))
      : null;
    const resolved = resolvePropertyForIdentity(identity.codeCounts, { franchiseCode: franchise?.code });
    identity.propertyCode = resolved.code ?? '';
    identity.propertyRule = resolved.rule;
    identity.propertyReason = resolved.reason ?? '';
    propertyRuleCounts[resolved.rule] = (propertyRuleCounts[resolved.rule] ?? 0) + 1;
    if (resolved.rule === 'NEEDS_HUMAN') {
      propertyReview.push({
        character: identity.identityName,
        legacy_licensor_id: identity.licensorId,
        appearances: identity.appearances,
        candidate_codes: [...identity.codeCounts.entries()]
          .sort((l, r) => r[1] - l[1] || l[0].localeCompare(r[0]))
          .map(([code, n]) => `${code}(${codeDesc.get(code) ?? '?'})x${n}`)
          .join(' | '),
        style_guides: [...identity.styleGuides].sort().join(' | '),
        reason: resolved.reason,
        chosen_mg06_code: '',
      });
    }
    if (identity.propertyCode) {
      assert(validCodes.has(identity.propertyCode), `property code outside the Coldlion MG06 list: ${identity.propertyCode}`);
    }
  }

  // ---- preserved rendition detail (owner requirement, 2026-07-29) ----
  const preserved = { likeness_label: 0, portrayed_by: 0, title_year: 0, guide_context: 0, alias: 0 };
  let withRendition = 0;
  for (const row of rows) {
    const rendition = row.metadata?.rendition;
    if (!rendition) continue;
    withRendition += 1;
    for (const key of Object.keys(preserved)) if (rendition[key]) preserved[key] += 1;
  }

  // ---- outputs ----
  writeCsv(join(outputDir, 'appearance-identity-resolution.csv'),
    ['styleGuide', 'characterName', 'sourceCharacterId', 'status', 'rules', 'identityName', 'propertyCode', 'propertyVia', 'reason'],
    rows);

  writeCsv(join(outputDir, 'cross-licensor-validation-failures.csv'),
    ['style_guide', 'legacy_licensor_id', 'appearances', 'answered_code', 'answered_property', 'answered_licensor', 'decision_source', 'failure', 'detail'],
    validationFailures);

  writeCsv(join(outputDir, 'authorized-licensing-corrections.csv'),
    ['style_guide', 'original_licensing_answer', 'corrected_code', 'authorized_by', 'authorized_on', 'reason'],
    AUTHORIZED_LICENSING_CORRECTIONS.map((correction) => ({
      style_guide: correction.styleGuide,
      original_licensing_answer: correction.from,
      corrected_code: correction.to,
      authorized_by: correction.authorizedBy,
      authorized_on: correction.authorizedOn,
      reason: correction.reason,
    })));

  writeCsv(join(outputDir, 'bridge-metadata-sample.csv'),
    ['styleGuide', 'characterName', 'identityName', 'metadata'],
    rows
      .filter((row) => row.metadata?.rendition)
      .slice(0, 200)
      .map((row) => ({ ...row, metadata: JSON.stringify(row.metadata) })));

  writeCsv(join(outputDir, 'canonical-character-identities.csv'),
    ['identityName', 'licensorId', 'appearances', 'styleGuideCount', 'propertyCode', 'propertyRule', 'propertyReason'],
    [...identityIndex.values()]
      .map((identity) => ({ ...identity, styleGuideCount: identity.styleGuides.size }))
      .sort((l, r) => r.appearances - l.appearances || l.identityName.localeCompare(r.identityName)));

  const identityReview = rows
    .filter((row) => row.status === 'NEEDS_HUMAN')
    .map((row) => ({
      style_guide: row.styleGuide,
      character_name: row.characterName,
      source_character_id: row.sourceCharacterId,
      components: row.components ?? '',
      reason: row.reason,
      decision: '',
    }))
    .sort((l, r) => l.style_guide.localeCompare(r.style_guide) || l.character_name.localeCompare(r.character_name));
  writeCsv(join(outputDir, 'identity-decisions-for-owner.csv'),
    ['style_guide', 'character_name', 'source_character_id', 'components', 'reason', 'decision'],
    identityReview);

  writeCsv(join(outputDir, 'property-decisions-for-owner.csv'),
    ['character', 'legacy_licensor_id', 'appearances', 'candidate_codes', 'style_guides', 'reason', 'chosen_mg06_code'],
    propertyReview);

  const batman = rows.filter((row) => norm(row.identityName) === 'batman' && row.licensorId === 2);
  const summary = {
    appearances: rows.length,
    identityCounts: counts,
    identityRuleCounts: ruleCounts,
    propertyRuleCounts,
    identityDecisionsNeeded: identityReview.length,
    identityDecisionStyleGuides: new Set(identityReview.map((row) => row.style_guide)).size,
    propertyDecisionsNeeded: propertyReview.length,
    propertyDecisionAppearances: propertyReview.reduce((sum, row) => sum + row.appearances, 0),
    batman: { appearances: batman.length, styleGuides: new Set(batman.map((row) => row.styleGuide)).size },
    crossLicensorValidation: {
      styleGuidesChecked: [...decisions.values()].filter((d) => d.outcome === 'EXISTING_MG06' && d.code && d.code !== 'NONE').length,
      failures: validationFailures.length,
      failureAppearances: validationFailures.reduce((sum, row) => sum + row.appearances, 0),
      byFailure: validationFailures.reduce((acc, row) => ({ ...acc, [row.failure]: (acc[row.failure] ?? 0) + 1 }), {}),
    },
    authorizedCorrections: AUTHORIZED_LICENSING_CORRECTIONS.length,
    preservedRenditionDetail: { appearances: withRendition, byQualifier: preserved },
    canonicalTablesStillEmpty: canonical,
  };
  writeFileSync(join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
