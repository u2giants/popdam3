#!/usr/bin/env node

/**
 * Character identity resolution rules for the Phase 3 backfill
 * (`fix_characters_style_guides.md`, model doc §7 question 4).
 *
 * The 9,622 legacy rows in `dflow.property_character_associations` are character
 * *appearances* — one row per (style guide × character). Each must resolve to ONE
 * canonical `core.character` identity or the backfill recreates the duplication the
 * whole plan exists to remove.
 *
 * Every decision this module makes is deterministic, records the rule that made it,
 * and records the evidence used. Nothing here writes to a database.
 */

import assert from 'node:assert/strict';

export const norm = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Royalty-reporting placeholders (model doc §2.3). Never characters. */
export const SENTINELS = new Set([
  'no reportable elements',
  'no character likeness',
  'logo',
]);

/** Abbreviations that must not split one identity into two (Dr. / Doctor). */
const ABBREVIATIONS = new Map([
  ['dr', 'doctor'],
  ['mr', 'mister'],
  ['mrs', 'missus'],
  ['ms', 'miss'],
  ['st', 'saint'],
  ['sgt', 'sergeant'],
  ['capt', 'captain'],
  ['prof', 'professor'],
]);

export const expandAbbreviations = (value) => norm(value)
  .split(' ')
  .filter(Boolean)
  .map((token) => ABBREVIATIONS.get(token) ?? token)
  .join(' ');

// ---------------------------------------------------------------------------
// Stage A — exclusions. These rows are not character identities at all.
// ---------------------------------------------------------------------------

export function isSentinel(characterName) {
  return SENTINELS.has(norm(characterName));
}

// --- marker matching -------------------------------------------------------
//
// WHY SEGMENTS. Until 2026-08-09 every marker rule below was a regex anchored to
// the start or the end of the WHOLE normalised name. Coldlion labels are
// compounds, so a marker that sits anywhere but an outer edge never fired:
//
//   "Marvel Studios' Ant-Man & Wasp Logo ( Ant-Man )"  -> `logo` is mid-string
//   "Moon Girl & Devil Dinosaur - Gen"                 -> `general` is abbreviated
//
// Those are two symptoms of one wrong approach, not two missing regexes. The fix
// is to split the label into the segments that can independently carry a marker,
// then match the marker against a SEGMENT edge rather than a STRING edge.
// Matching is still edge-anchored per segment, never a substring search, so
// "General Zod", "Genie" and "Logan" stay characters.

/**
 * Split a compound label into the segments that can independently carry a
 * marker. Segments break on brackets, slashes, pipes, commas, and a spaced dash
 * (a spaced dash separates a franchise prefix from its qualifier; an unspaced
 * one is part of a name, as in "Ant-Man").
 */
export function labelSegments(characterName) {
  return String(characterName ?? '')
    .split(/[()\[\]{}\/|,]|\s+[-–—]\s+/)
    .map((part) => norm(part))
    .filter(Boolean);
}

const tokensOf = (segment) => segment.split(' ').filter(Boolean);

const endsWithPhrase = (tokens, phrase) => {
  const p = phrase.split(' ');
  return tokens.length >= p.length
    && p.every((token, i) => token === tokens[tokens.length - p.length + i]);
};

const startsWithPhrase = (tokens, phrase) => {
  const p = phrase.split(' ');
  return tokens.length >= p.length && p.every((token, i) => token === tokens[i]);
};

/**
 * Does any segment of `characterName` carry `phrase` at the requested edge?
 *
 * `where` is 'end' (the segment is "<something> Logo"), 'start' (the segment is
 * "Logo <something>"), 'either', or 'exact' (the segment IS the phrase and
 * nothing else). 'exact' is the setting for short abbreviations, where a looser
 * edge match would start swallowing real names.
 */
export function segmentCarriesPhrase(characterName, phrase, where = 'end') {
  return labelSegments(characterName).some((segment) => {
    const tokens = tokensOf(segment);
    switch (where) {
      case 'exact': return tokens.join(' ') === phrase;
      case 'start': return startsWithPhrase(tokens, phrase);
      case 'either': return startsWithPhrase(tokens, phrase) || endsWithPhrase(tokens, phrase);
      default: return endsWithPhrase(tokens, phrase);
    }
  });
}

/**
 * Marker vocabularies. Each entry is [phrase, edge]. Spelled-out words are safe
 * at a segment edge; abbreviations are only safe as a whole segment of their own
 * ("... - Gen"), because "Gen" as an edge match would also catch a name that
 * merely happens to end in that token.
 */
export const LOGO_MARKERS = [['logo', 'either'], ['logos', 'either']];
export const GENERAL_MARKERS = [
  ['general', 'end'],
  ['gen', 'exact'],
];
export const DO_NOT_USE_MARKERS = [['dnu', 'start'], ['do not use', 'start']];

const carriesAnyMarker = (characterName, markers) =>
  markers.some(([phrase, where]) => segmentCarriesPhrase(characterName, phrase, where));

/**
 * A label that describes the artwork or the guide, not a character:
 * the style guide's own name, logos, and "(General)" royalty groupings.
 */
export function classifyNonCharacterLabel(styleGuide, characterName) {
  const n = norm(characterName);
  if (!n) return 'EMPTY_NAME';
  if (carriesAnyMarker(characterName, DO_NOT_USE_MARKERS)) return 'DO_NOT_USE_LABEL';
  if (carriesAnyMarker(characterName, LOGO_MARKERS)) return 'LOGO_LABEL';
  if (carriesAnyMarker(characterName, GENERAL_MARKERS)
    || /general (family )?(char|character)/.test(n)
    || (/\bgeneral\b/.test(n) && /no name likeness or voice royalty/.test(n))) {
    return 'GENERAL_ROYALTY_LABEL';
  }
  // The row's only name is the style guide's own name. It carries no identity
  // beyond the guide, which already exists as a `core.style_guide` row.
  if (n === norm(styleGuide)) return 'SELF_NAMED_GUIDE';
  return null;
}

export function isNonCharacterLabel(styleGuide, characterName) {
  return classifyNonCharacterLabel(styleGuide, characterName) !== null;
}

/**
 * A royalty grouping row rather than a character: "Cars - King, Mario and Ferrari
 * car grp of 4". These enumerate billing combinations, not identities.
 */
export function isGroupingLabel(characterName) {
  const n = norm(characterName);
  return /\bgrp of\b/.test(n)
    || /\bgroup of\b/.test(n)
    || /\bmanuftr grp\b/.test(n)
    || /\bgrp\b/.test(n);
}

/** A single row naming several characters at once. Cardinality is ambiguous. */
export function isMultiCharacterLabel(characterName) {
  // A quoted phrase ("Unbowed, Unbent, Unbroken") is one label, not a list.
  const raw = String(characterName ?? '').replace(/["“”][^"“”]*["“”]/g, ' ');
  if (/&/.test(raw) && raw.split('&').filter((part) => part.trim()).length > 1) return true;
  // "A, B and C" / "A, B, C" lists of two or more comma-separated proper names.
  const commaParts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 3) return true;
  if (commaParts.length === 2 && /\b(and)\b/i.test(commaParts[1])) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Stage B — qualifier stripping. Each strip is justified by the model doc.
// ---------------------------------------------------------------------------

const LIKENESS_PAREN = /\(\s*(with |non[- ]?)?(talent[- ]?)?likeness\s*\)/gi;
const LIKENESS_PAREN_2 = /\(\s*non[- ]?talent[- ]?likeness\s*\)/gi;
const PORTRAYED = /\s*as portrayed by[^()]*/gi;
const YEAR_PAREN = /\s*\([^()]*\b(?:18|19|20)\d{2}\)\s*/g;

const tidy = (value) => String(value ?? '')
  .replace(/[()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Remove qualifiers that describe the *rendition*, not the identity.
 *
 * The removed text is NEVER discarded: the owner (2026-07-29) requires the
 * movie/rendition fact to survive on the appearance. It is returned in
 * `captured` and lands on the `core.style_guide_character.metadata` bridge row —
 * never on `core.character`, and never as a likeness boolean in `core.*`
 * (likeness belongs to `dam.style_guide_file`, model doc §2.2).
 *
 * Returns { value, rules, captured }.
 */
export function stripQualifiers(characterName, styleGuide = '') {
  let value = String(characterName ?? '');
  const rules = [];
  const captured = {};

  // The two likeness patterns overlap, so dedupe by match position.
  const likeness = [...new Map([
    ...value.matchAll(LIKENESS_PAREN_2),
    ...value.matchAll(LIKENESS_PAREN),
  ].map((match) => [match.index, tidy(match[0])])).values()];
  if (likeness.length) {
    rules.push('STRIP_LIKENESS');
    captured.likeness = likeness.join('; ');
    value = value.replace(LIKENESS_PAREN_2, ' ').replace(LIKENESS_PAREN, ' ');
  }

  const portrayals = [...value.matchAll(PORTRAYED)]
    .map((match) => tidy(match[0]).replace(/^as portrayed by\s*/i, ''))
    .filter(Boolean);
  if (portrayals.length) {
    rules.push('STRIP_PORTRAYAL');
    captured.portrayedBy = portrayals.join('; ');
    value = value.replace(PORTRAYED, ' ');
  }

  const titles = [...value.matchAll(YEAR_PAREN)].map((match) => tidy(match[0])).filter(Boolean);
  if (titles.length) {
    rules.push('STRIP_TITLE_YEAR');
    captured.titleYear = titles.join('; ');
    value = value.replace(YEAR_PAREN, ' ');
  }

  // A trailing parenthetical that repeats the style guide is guide context; the
  // bridge row already carries it.
  const guide = norm(styleGuide);
  if (guide) {
    const trailing = value.match(/\(([^()]*)\)\s*$/);
    if (trailing && norm(trailing[1]) === guide) {
      rules.push('STRIP_GUIDE_CONTEXT');
      captured.guideContext = tidy(trailing[1]);
      value = value.slice(0, trailing.index);
    }
  }

  return { value: value.replace(/\s+/g, ' ').trim(), rules, captured };
}

/** A human-readable rendition phrase for the bridge row's description. */
export function renditionDescription(captured = {}) {
  const parts = [];
  if (captured.titleYear) parts.push(captured.titleYear);
  if (captured.portrayedBy) parts.push(`as portrayed by ${captured.portrayedBy}`);
  if (captured.likeness) parts.push(captured.likeness.toLowerCase());
  if (captured.alias) parts.push(`aka ${captured.alias}`);
  return parts.join(' · ');
}

/** "Rogers, Steve" -> "Steve Rogers". Only for a simple two-part personal name. */
export function invertSurnameFirst(value) {
  const match = String(value ?? '').match(/^([A-Za-z.`'’-]+),\s*([A-Za-z.`'’-]+)$/);
  if (!match) return null;
  return `${match[2]} ${match[1]}`;
}

/** "Batman/Bruce Wayne" -> primary "Batman", alias "Bruce Wayne". */
export function splitSlashAlias(value) {
  const parts = String(value ?? '').split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { primary: parts[0], aliases: parts.slice(1) };
}

/** "Robin aka Dick Grayson" -> primary "Robin", alias "Dick Grayson". */
export function splitAka(value) {
  const parts = String(value ?? '').split(/\s+aka\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { primary: parts[0], alias: parts.slice(1).join(' aka ') };
}

// ---------------------------------------------------------------------------
// Stage C — alias clustering.
// ---------------------------------------------------------------------------

/** Levenshtein distance, capped: only used to fold single-character typos. */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

/**
 * Two alias tails describe the same secondary identity when one is a token-prefix
 * of the other ("clark kent" vs "clark kent kal el") or when they differ by a
 * single-character typo ("komand r" vs "kommand r").
 */
export function aliasesMatch(left, right) {
  const a = expandAbbreviations(left);
  const b = expandAbbreviations(right);
  if (a === b) return true;
  const at = a.split(' ');
  const bt = b.split(' ');
  const shorter = at.length <= bt.length ? at : bt;
  const longer = at.length <= bt.length ? bt : at;
  if (shorter.every((token, index) => token === longer[index])) return true;
  return editDistance(a.replace(/ /g, ''), b.replace(/ /g, '')) <= 1;
}

/** Collapse alias tails into clusters; the shortest member names each cluster. */
export function clusterAliases(aliases) {
  const clusters = [];
  for (const alias of [...aliases].sort((l, r) => l.length - r.length || l.localeCompare(r))) {
    const found = clusters.find((cluster) => cluster.some((member) => aliasesMatch(member, alias)));
    if (found) found.push(alias);
    else clusters.push([alias]);
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * Classify one appearance without cross-row context.
 * Returns { status, primary, alias, rules }.
 */
export function prepareAppearance({ styleGuide, characterName }) {
  const rules = [];
  if (isSentinel(characterName)) {
    return { status: 'SENTINEL_EXCLUDED', rules: ['SENTINEL'], reason: 'Royalty reporting sentinel (model doc §2.3)' };
  }
  const labelRule = classifyNonCharacterLabel(styleGuide, characterName);
  if (labelRule) {
    return { status: 'NON_CHARACTER_EXCLUDED', rules: [labelRule], reason: 'Guide name, logo, or "general" royalty label' };
  }
  if (isGroupingLabel(characterName)) {
    return { status: 'GROUPING_EXCLUDED', rules: ['GROUPING_LABEL'], reason: 'Royalty grouping combination, not a character identity' };
  }

  const stripped = stripQualifiers(characterName, styleGuide);
  rules.push(...stripped.rules);
  const captured = { ...stripped.captured };
  let base = stripped.value;

  if (isMultiCharacterLabel(base)) {
    return { status: 'MULTI_CHARACTER_UNRESOLVED', rules: [...rules, 'MULTI_CHARACTER_LABEL'], reason: 'One row names several characters; splitting changes cardinality', base, captured };
  }

  const inverted = invertSurnameFirst(base);
  if (inverted) {
    rules.push('INVERT_SURNAME_FIRST');
    base = inverted;
  }

  let primary = base;
  let alias = '';

  const slash = splitSlashAlias(base);
  if (slash) {
    rules.push('SPLIT_SLASH_ALIAS');
    primary = slash.primary;
    alias = slash.aliases.join(' ');
  }

  const aka = splitAka(alias ? `${primary} aka ${alias}` : primary);
  if (aka) {
    rules.push('SPLIT_AKA');
    primary = aka.primary;
    alias = aka.alias;
  }

  if (!norm(primary)) {
    return { status: 'EMPTY_AFTER_STRIP', rules, reason: 'Nothing left after removing rendition qualifiers', base, captured };
  }

  if (alias) captured.alias = alias;
  return { status: 'CANDIDATE', primary, alias, rules, base, captured };
}

/**
 * The `core.style_guide_character.metadata` payload for one appearance.
 * Only keys with content are emitted, so an appearance with no qualifier gets
 * just its source provenance.
 */
export function bridgeMetadata({ characterName, sourceCharacterId, captured = {}, rules = [] }) {
  const metadata = {
    source_character_name: String(characterName ?? ''),
    identity_rules: [...rules],
  };
  if (sourceCharacterId) metadata.source_character_id = String(sourceCharacterId);
  const rendition = {};
  if (captured.likeness) rendition.likeness_label = captured.likeness;
  if (captured.portrayedBy) rendition.portrayed_by = captured.portrayedBy;
  if (captured.titleYear) rendition.title_year = captured.titleYear;
  if (captured.guideContext) rendition.guide_context = captured.guideContext;
  if (captured.alias) rendition.alias = captured.alias;
  if (Object.keys(rendition).length) {
    metadata.rendition = rendition;
    const description = renditionDescription(captured);
    if (description) metadata.rendition_description = description;
  }
  return metadata;
}

/**
 * Resolve every appearance to a canonical identity.
 *
 * @param {Array<{styleGuide:string, licensorId:string|number, characterName:string,
 *                sourceCharacterId?:string, styleGuideId?:string}>} appearances
 * @returns {{rows:Array, identities:Array, counts:Object}}
 */
export function resolveIdentities(appearances) {
  const prepared = appearances.map((row) => ({ row, prep: prepareAppearance(row) }));

  // Cluster alias tails per (licensor, primary).
  const aliasSets = new Map();
  for (const { row, prep } of prepared) {
    if (prep.status !== 'CANDIDATE' || !prep.alias) continue;
    const key = `${row.licensorId}|${expandAbbreviations(prep.primary)}`;
    if (!aliasSets.has(key)) aliasSets.set(key, new Set());
    aliasSets.get(key).add(expandAbbreviations(prep.alias));
  }
  const aliasClusters = new Map();
  for (const [key, set] of aliasSets) {
    aliasClusters.set(key, clusterAliases([...set]));
  }

  const rows = [];
  const identities = new Map();

  for (const { row, prep } of prepared) {
    if (prep.status !== 'CANDIDATE') {
      rows.push({
        ...row,
        status: prep.status,
        rules: prep.rules.join('+'),
        reason: prep.reason,
        base: prep.base ?? '',
        captured: prep.captured ?? {},
        identityKey: '',
        identityName: '',
      });
      continue;
    }
    const primaryNorm = expandAbbreviations(prep.primary);
    const key = `${row.licensorId}|${primaryNorm}`;
    const clusters = aliasClusters.get(key) ?? [];
    const rules = [...prep.rules];
    let identityName = prep.primary;
    let identityKey = `${row.licensorId}|${primaryNorm}`;

    if (prep.alias) {
      const aliasNorm = expandAbbreviations(prep.alias);
      const cluster = clusters.find((candidate) => candidate.some((member) => aliasesMatch(member, aliasNorm)));
      const canonicalAlias = cluster ? cluster[0] : aliasNorm;
      if (clusters.length <= 1) {
        // One secondary name for this primary in the whole corpus: a known alias
        // of the same identity. Merge it into the primary.
        rules.push('ALIAS_UNIQUE_MERGED');
      } else {
        // Several distinct secondary identities share this primary
        // (Robin = Dick Grayson / Duke Thomas / Damian Wayne). Keep them apart.
        rules.push('ALIAS_DISAMBIGUATED');
        identityKey = `${row.licensorId}|${primaryNorm}|${canonicalAlias}`;
        identityName = `${prep.primary} aka ${prep.alias}`;
      }
    } else if (clusters.length > 1) {
      // The unqualified name under a polysemous primary. It is the plain
      // character (Batman), deliberately NOT merged into any aka variant.
      rules.push('BARE_PRIMARY_KEPT');
    } else {
      rules.push('PRIMARY_ONLY');
    }

    if (!identities.has(identityKey)) {
      identities.set(identityKey, { identityKey, identityName, licensorId: row.licensorId, appearances: 0 });
    }
    identities.get(identityKey).appearances += 1;

    const captured = { ...prep.captured };
    // A disambiguating alias is part of the identity, not rendition detail.
    if (rules.includes('ALIAS_DISAMBIGUATED')) delete captured.alias;

    rows.push({
      ...row,
      status: 'AUTO_RESOLVED',
      rules: rules.join('+'),
      reason: '',
      captured,
      identityKey,
      identityName: identities.get(identityKey).identityName,
      metadata: bridgeMetadata({
        characterName: row.characterName,
        sourceCharacterId: row.sourceCharacterId,
        captured,
        rules,
      }),
    });
  }

  // ---------------------------------------------------------------------
  // Second pass — combination rows.
  // "BATMAN & ROBIN", "Camp Rock - Jason, Nate & Shane" are royalty combination
  // entries. If every component already resolved to an identity under the same
  // licensor, the combination row adds no identity and is safely excluded.
  // If any component is unknown, only a human can say what it means.
  // ---------------------------------------------------------------------
  const knownByLicensor = new Map();
  for (const identity of identities.values()) {
    const key = String(identity.licensorId);
    if (!knownByLicensor.has(key)) knownByLicensor.set(key, new Set());
    const bare = identity.identityName.split(/\s+aka\s+/i)[0];
    knownByLicensor.get(key).add(expandAbbreviations(bare));
  }

  for (const row of rows) {
    if (row.status !== 'MULTI_CHARACTER_UNRESOLVED') continue;
    const components = splitCombination(row.base ?? row.characterName);
    const known = knownByLicensor.get(String(row.licensorId)) ?? new Set();
    const missing = components.filter((component) => {
      const full = expandAbbreviations(component);
      const primary = expandAbbreviations(component.split(/\s+aka\s+/i)[0].split('/')[0]);
      return !known.has(full) && !known.has(primary);
    });
    row.components = components.join(' | ');
    if (components.length === 0) {
      // Every component was a royalty/logo/general qualifier. There is no
      // character name here to ask anybody about — asking is the defect.
      row.status = 'QUALIFIER_ONLY_LABEL';
      row.rules = `${row.rules}+QUALIFIER_ONLY_LABEL`;
      row.reason = 'Row carries only royalty/logo/general qualifiers, no character name to adjudicate';
    } else if (components.length >= 2 && missing.length === 0) {
      row.status = 'COMBINATION_COVERED';
      row.rules = `${row.rules}+COMBINATION_COVERED`;
      row.reason = 'Royalty combination row; every named character already resolved under this licensor';
    } else {
      row.status = 'NEEDS_HUMAN';
      row.rules = `${row.rules}+COMBINATION_UNCOVERED`;
      row.reason = missing.length
        ? `Combination row naming characters that appear nowhere else under this licensor: ${missing.join(', ')}`
        : 'Row names several characters and cannot be split deterministically';
    }
  }

  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const ruleCounts = {};
  for (const row of rows) {
    for (const rule of String(row.rules).split('+').filter(Boolean)) {
      ruleCounts[rule] = (ruleCounts[rule] ?? 0) + 1;
    }
  }
  counts.IDENTITIES = identities.size;
  counts.TOTAL = rows.length;

  return { rows, identities: [...identities.values()], counts, ruleCounts };
}

const SEPARATOR_RE = /\s*(?:&|,|\band\b)\s*/i;

/**
 * Royalty/rendition qualifiers that are NOT character names. They arrive as
 * components of a combination label — "General(No Name,Likeness,Voice Royalty)"
 * splits into `likeness` and `voice royalty`, neither of which anybody can
 * adjudicate as a character.
 */
export const QUALIFIER_COMPONENTS = new Set([
  'gen', 'general', 'core', 'assorted', 'misc', 'miscellaneous',
  'likeness', 'with likeness', 'no likeness', 'non likeness', 'talent likeness',
  'non talent likeness', 'voice', 'voice royalty', 'no voice', 'name', 'no name',
  'royalty', 'logo', 'logos', 'dnu', 'do not use', 'style guide', 'group', 'grp',
]);

/**
 * True when a split component describes the artwork, the royalty basis or the
 * guide rather than naming a character. Reuses the existing logo/general/DNU
 * marker vocabulary so there is one definition of "not a character", not two.
 */
export function isQualifierComponent(component) {
  const n = norm(component);
  if (!n) return true;
  if (QUALIFIER_COMPONENTS.has(n)) return true;
  if (carriesAnyMarker(component, LOGO_MARKERS)) return true;
  if (carriesAnyMarker(component, GENERAL_MARKERS)) return true;
  if (carriesAnyMarker(component, DO_NOT_USE_MARKERS)) return true;
  // A "logo" token anywhere makes the fragment artwork, not a character. The
  // edge-only LOGO_MARKERS rule misses mid-string fragments such as
  // "wasp logo ms ant man wasp quantumania".
  if (/\blogos?\b/.test(n)) return true;
  // Royalty-basis words. Deliberately NOT plain "general", which would swallow
  // real names such as "General Zod".
  if (/\broyalty\b/.test(n)) return true;
  if (/\bno name\b/.test(n)) return true;
  if (/\blikeness\b/.test(n)) return true;
  return false;
}

/**
 * Split a combination label into its component character names.
 *
 * Three corrections over the original naive split, each tied to a row that
 * reached the licensing company reviewer as an unanswerable question in round 2:
 *
 * 1. A trailing `( style guide )` scope suffix is removed before splitting.
 *    Without this, `Ant-Man & Wasp Logo ( MS` Ant-Man Wasp Quantumania )` split
 *    straight through the suffix and produced the fragment
 *    "wasp logo ms ant man wasp quantumania".
 * 2. The leading franchise prefix is dropped ONLY when the text after the dash
 *    actually looks like a list. `Camp Rock - Jason, Nate & Shane` keeps that
 *    behaviour; `Mickey & Pluto - Back To School` and
 *    `Moon Girl & Devil Dinosaur - Gen` do not — in those the names are in the
 *    PREFIX and the tail is a title/qualifier, so the old rule threw the
 *    characters away and asked about "back to school" and "gen".
 * 3. Qualifier components are dropped, never offered as unknown names.
 */
export function splitCombination(value) {
  let text = String(value ?? '');

  // 1. Drop a trailing parenthetical scope suffix.
  text = text.replace(/\s*\([^()]*\)\s*$/, ' ').trim();

  // 2. Conditional franchise-prefix drop.
  const dash = text.split(/\s+-\s+/);
  if (dash.length > 1) {
    const tail = dash.slice(1).join(' - ');
    if (SEPARATOR_RE.test(tail)) text = tail;
    else text = dash[0];
  }

  // 3. Split, normalise, and drop qualifiers.
  return text
    .split(SEPARATOR_RE)
    .map((part) => norm(part))
    .filter(Boolean)
    .filter((part) => !isQualifierComponent(part));
}

// ---------------------------------------------------------------------------
// Property resolution for a resolved identity (axis 1 — one property per character).
//
// A canonical character appears in several style guides, and those guides can
// carry different property codes ("Iron Man" appears under Avengers, Marvel
// Games, Marvel Universe...). Axis 1 allows exactly one, so the candidates must
// be ranked. No code is ever created and no code outside the captured Coldlion
// MG06 list is ever used — this only *chooses among* codes already assigned.
// ---------------------------------------------------------------------------

/** Least specific: catalogue-wide "assorted styles" buckets. */
export const ASSORTED_CODES = new Set(['MV', 'DC']);
/** Middle: group, bucket, and platform umbrellas. */
export const UMBRELLA_CODES = new Set(['AV', 'JG', 'SX', 'GM', 'CP', 'MP']);

export function codeSpecificity(code) {
  if (ASSORTED_CODES.has(code)) return 1;
  if (UMBRELLA_CODES.has(code)) return 2;
  return 3;
}

/**
 * @param {Map<string, number>|Array<[string, number]>} candidateCounts code -> appearances
 * @param {{franchiseCode?: string|null}} context
 */
export function resolvePropertyForIdentity(candidateCounts, context = {}) {
  const entries = [...(candidateCounts instanceof Map ? candidateCounts.entries() : candidateCounts)];
  if (entries.length === 0) return { code: null, rule: 'NO_PROPERTY_CANDIDATE' };
  if (entries.length === 1) return { code: entries[0][0], rule: 'SINGLE_CANDIDATE' };

  const { franchiseCode } = context;
  if (franchiseCode && entries.some(([code]) => code === franchiseCode)) {
    return { code: franchiseCode, rule: 'REVIEWED_FRANCHISE_RULE' };
  }

  const best = Math.max(...entries.map(([code]) => codeSpecificity(code)));
  const narrowed = entries.filter(([code]) => codeSpecificity(code) === best);
  if (narrowed.length === 1) return { code: narrowed[0][0], rule: 'MOST_SPECIFIC_CODE' };

  const sorted = [...narrowed].sort((l, r) => r[1] - l[1] || l[0].localeCompare(r[0]));
  if (sorted[0][1] > sorted[1][1]) return { code: sorted[0][0], rule: 'MAJORITY_OF_APPEARANCES' };

  return {
    code: null,
    rule: 'NEEDS_HUMAN',
    reason: `Equally specific, equally frequent property codes: ${narrowed.map(([code]) => code).sort().join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Cross-licensor validation (added 2026-07-29 after the MU/MUPPETS defect).
//
// Validating only "is this a real Coldlion code" is not enough: `MU` is a real
// code, but it is MUPPETS under DISNEY, and licensing's typo would have attached
// it to 1,041 Marvel character appearances. A style guide's resolved property
// must belong to the SAME licensor as the style guide. Mismatches FAIL CLOSED —
// they are reported and left unresolved, never auto-corrected.
// ---------------------------------------------------------------------------

/**
 * Legacy licensor id in `dflow.properties_and_characters` -> the canonical
 * `core.licensor` codes that a style guide under it may legitimately resolve to.
 * Derived from the style guides actually present under each id on preview.
 */
export const LEGACY_LICENSOR_ALLOWED_CODES = {
  1: ['DY', 'SW'], // Disney (sheet label "Dis/Mrv/SW")
  2: ['WB', 'DC', 'HP', 'FR'], // Warner Bros: WB, DC, Harry Potter, Friends
  3: ['MV'], // Marvel
  12: ['WW'], // WWE
  13: ['CC'], // Coca-Cola
  14: ['SS'], // Strawberry Shortcake
};

/**
 * @param {{legacyLicensorId:string|number, code:string,
 *          property:{code:string,name:string,licensorCode:string,licensorName:string}|null|undefined}} input
 * @returns {{ok:boolean, failure?:string, detail?:string}}
 */
export function validateStyleGuideProperty({ legacyLicensorId, code, property }) {
  if (!code || code === 'NONE') return { ok: true };
  if (!property) {
    return {
      ok: false,
      failure: 'CODE_NOT_IN_CORE_PROPERTY',
      detail: `MG06 code ${code} is valid in Coldlion but has no row in core.property, so it would leave a dangling property_id`,
    };
  }
  const allowed = LEGACY_LICENSOR_ALLOWED_CODES[legacyLicensorId];
  if (!allowed) {
    return {
      ok: false,
      failure: 'UNKNOWN_LEGACY_LICENSOR',
      detail: `legacy licensor ${legacyLicensorId} has no approved canonical licensor list`,
    };
  }
  if (!allowed.includes(property.licensorCode)) {
    return {
      ok: false,
      failure: 'LICENSOR_MISMATCH',
      detail: `${code} = ${property.name} belongs to licensor ${property.licensorCode} (${property.licensorName}), but the style guide's licensor allows only ${allowed.join(', ')}`,
    };
  }
  return { ok: true };
}

export default resolveIdentities;

assert(typeof resolveIdentities === 'function');
