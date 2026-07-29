import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aliasesMatch,
  bridgeMetadata,
  renditionDescription,
  validateStyleGuideProperty,
  classifyNonCharacterLabel,
  clusterAliases,
  codeSpecificity,
  editDistance,
  expandAbbreviations,
  invertSurnameFirst,
  isGroupingLabel,
  isMultiCharacterLabel,
  isSentinel,
  prepareAppearance,
  resolveIdentities,
  resolvePropertyForIdentity,
  splitAka,
  splitCombination,
  splitSlashAlias,
  stripQualifiers,
} from './resolve-character-identity.mjs';

test('royalty sentinels are recognised whatever their casing', () => {
  assert.equal(isSentinel('No Reportable Elements'), true);
  assert.equal(isSentinel('no reportable elements'), true);
  assert.equal(isSentinel('LOGO'), true);
  assert.equal(isSentinel('No Character Likeness'), true);
  assert.equal(isSentinel('Batman'), false);
});

test('non-character labels are classified by which rule fired', () => {
  assert.equal(classifyNonCharacterLabel('Avengers', 'Avengers Logo'), 'LOGO_LABEL');
  assert.equal(classifyNonCharacterLabel('Avengers', 'DNU-Cartoon Network Logo'), 'DO_NOT_USE_LABEL');
  assert.equal(classifyNonCharacterLabel('Avengers', 'Avengers (General) ( Avengers )'), 'GENERAL_ROYALTY_LABEL');
  assert.equal(classifyNonCharacterLabel('Bambi', 'Bambi'), 'SELF_NAMED_GUIDE');
  assert.equal(classifyNonCharacterLabel('Avengers', 'Iron Man'), null);
});

test('grouping labels are royalty combinations, not identities', () => {
  assert.equal(isGroupingLabel('Cars - King, Mario and Ferrari car grp of 4'), true);
  assert.equal(isGroupingLabel('Cars - Luigi in a mixed manufacturer grp'), true);
  assert.equal(isGroupingLabel('Lightning McQueen'), false);
});

test('multi-character labels are detected, quoted phrases are not', () => {
  assert.equal(isMultiCharacterLabel('BATMAN & ROBIN'), true);
  assert.equal(isMultiCharacterLabel('Camp Rock - Jason, Nate, Shane & Mitchie'), true);
  assert.equal(isMultiCharacterLabel('Tully House Motto "Family, Duty, Honor"'), false);
  assert.equal(isMultiCharacterLabel('Rogers, Steve'), false);
  assert.equal(isMultiCharacterLabel('Batman'), false);
});

test('likeness, portrayal and title-year qualifiers are stripped', () => {
  const likeness = stripQualifiers('Batman (non-talent likeness)');
  assert.equal(likeness.value, 'Batman');
  assert.deepEqual(likeness.rules, ['STRIP_LIKENESS']);

  const portrayal = stripQualifiers('Mera as portrayed by Amber Heard');
  assert.equal(portrayal.value, 'Mera');
  assert.deepEqual(portrayal.rules, ['STRIP_PORTRAYAL']);

  const both = stripQualifiers('Batman aka Bruce Wayne (Non-Likeness) (Batman Begins 2005)');
  assert.equal(both.value, 'Batman aka Bruce Wayne');
  assert.deepEqual(both.rules, ['STRIP_LIKENESS', 'STRIP_TITLE_YEAR']);
});

test('a trailing parenthetical repeating the style guide is guide context', () => {
  const result = stripQualifiers('Ant-Man ( Avengers )', 'Avengers');
  assert.equal(result.value, 'Ant-Man');
  assert.deepEqual(result.rules, ['STRIP_GUIDE_CONTEXT']);
  // A different guide name in parentheses is NOT stripped.
  assert.equal(stripQualifiers('Ant-Man ( Avengers )', 'X-Men').value, 'Ant-Man ( Avengers )');
});

test('surname-first names are inverted only when unambiguous', () => {
  assert.equal(invertSurnameFirst('Rogers, Steve'), 'Steve Rogers');
  assert.equal(invertSurnameFirst('Batman, Bane And The Joker'), null);
  assert.equal(invertSurnameFirst('Batman'), null);
});

test('slash and aka aliases split into primary + alias', () => {
  assert.deepEqual(splitSlashAlias('Batman/Bruce Wayne'), { primary: 'Batman', aliases: ['Bruce Wayne'] });
  assert.equal(splitSlashAlias('Batman'), null);
  assert.deepEqual(splitAka('Robin aka Dick Grayson'), { primary: 'Robin', alias: 'Dick Grayson' });
  assert.equal(splitAka('Robin'), null);
});

test('abbreviations expand so Dr. and Doctor are one identity', () => {
  assert.equal(expandAbbreviations('Dr. Harleen Francis Quinzel'), expandAbbreviations('Doctor Harleen Francis Quinzel'));
});

test('alias matching folds prefixes and single-character typos', () => {
  assert.equal(aliasesMatch('clark kent', 'clark kent kal el'), true);
  assert.equal(aliasesMatch('komand r', 'kommand r'), true);
  assert.equal(aliasesMatch('dick grayson', 'damian wayne'), false);
  assert.equal(editDistance('abc', 'abd'), 1);
  assert.ok(editDistance('abc', 'xyz') > 1);
});

test('alias clustering keeps genuinely different secondary identities apart', () => {
  const clusters = clusterAliases(['dick grayson', 'damian wayne', 'dick grayson as a boy']);
  assert.equal(clusters.length, 2);
  assert.equal(clusterAliases(['clark kent', 'clark kent kal el', 'clark kent kal el metal']).length, 1);
});

test('one alias for a primary merges; several keep the variants apart', () => {
  const rows = [
    { styleGuide: 'A', licensorId: 2, characterName: 'Harley Quinn' },
    { styleGuide: 'B', licensorId: 2, characterName: 'Harley Quinn aka Dr. Harleen Francis Quinzel' },
    { styleGuide: 'C', licensorId: 2, characterName: 'Robin' },
    { styleGuide: 'D', licensorId: 2, characterName: 'Robin aka Dick Grayson' },
    { styleGuide: 'E', licensorId: 2, characterName: 'Robin aka Damian Wayne' },
  ];
  const { rows: out } = resolveIdentities(rows);
  assert.equal(out[0].identityKey, out[1].identityKey, 'a single alias is a known secondary name');
  assert.match(out[1].rules, /ALIAS_UNIQUE_MERGED/);
  assert.equal(new Set([out[2].identityKey, out[3].identityKey, out[4].identityKey]).size, 3);
  assert.match(out[2].rules, /BARE_PRIMARY_KEPT/);
  assert.match(out[3].rules, /ALIAS_DISAMBIGUATED/);
});

test('identity is scoped to the legacy licensor', () => {
  const { counts } = resolveIdentities([
    { styleGuide: 'A', licensorId: 2, characterName: 'Max' },
    { styleGuide: 'B', licensorId: 1, characterName: 'Max' },
  ]);
  assert.equal(counts.IDENTITIES, 2);
});

test('rendition qualifiers collapse into one identity', () => {
  const { counts, rows } = resolveIdentities([
    { styleGuide: 'Batman Core', licensorId: 2, characterName: 'BATMAN' },
    { styleGuide: 'The Dark Knight (2008)', licensorId: 2, characterName: 'Batman As Portrayed By Christian Bale' },
    { styleGuide: 'Dark Knight Rises', licensorId: 2, characterName: 'Batman (non-talent likeness)' },
  ]);
  assert.equal(counts.IDENTITIES, 1);
  assert.equal(new Set(rows.map((row) => row.identityKey)).size, 1);
});

test('the resolver is deterministic — running it twice is identical', () => {
  const input = [
    { styleGuide: 'Avengers', licensorId: 3, characterName: 'Iron Man' },
    { styleGuide: 'Marvel Games', licensorId: 3, characterName: 'Stark, Tony' },
    { styleGuide: 'Avengers', licensorId: 3, characterName: 'Avengers Logo' },
  ];
  assert.deepEqual(resolveIdentities(input).counts, resolveIdentities(input).counts);
});

test('combination rows are excluded only when every component is already known', () => {
  const { rows } = resolveIdentities([
    { styleGuide: 'Batman Core', licensorId: 2, characterName: 'Batman' },
    { styleGuide: 'Batman Core', licensorId: 2, characterName: 'Robin' },
    { styleGuide: 'Batman Core', licensorId: 2, characterName: 'BATMAN & ROBIN' },
    { styleGuide: 'Pirates', licensorId: 1, characterName: 'Pirates - Jack & Will' },
  ]);
  assert.equal(rows[2].status, 'COMBINATION_COVERED');
  assert.equal(rows[3].status, 'NEEDS_HUMAN');
  assert.match(rows[3].reason, /appear nowhere else/);
});

test('combination splitting drops the franchise prefix', () => {
  assert.deepEqual(splitCombination('Camp Rock 2 - Jason, Nate & Shane'), ['jason', 'nate', 'shane']);
  assert.deepEqual(splitCombination('BATMAN & ROBIN'), ['batman', 'robin']);
});

test('appearance preparation reports the exclusion reason', () => {
  assert.equal(prepareAppearance({ styleGuide: 'X', characterName: 'LOGO' }).status, 'SENTINEL_EXCLUDED');
  assert.equal(prepareAppearance({ styleGuide: 'X', characterName: 'X' }).status, 'NON_CHARACTER_EXCLUDED');
  assert.equal(prepareAppearance({ styleGuide: 'Cars', characterName: 'Cars - Ford only grp' }).status, 'GROUPING_EXCLUDED');
  assert.equal(prepareAppearance({ styleGuide: 'X', characterName: 'Iron Man' }).status, 'CANDIDATE');
});

test('property specificity ranks assorted below umbrella below franchise', () => {
  assert.equal(codeSpecificity('MV'), 1);
  assert.equal(codeSpecificity('AV'), 2);
  assert.equal(codeSpecificity('CA'), 3);
});

test('property conflicts resolve by reviewed rule, then specificity, then majority', () => {
  assert.deepEqual(resolvePropertyForIdentity(new Map()), { code: null, rule: 'NO_PROPERTY_CANDIDATE' });
  assert.deepEqual(resolvePropertyForIdentity(new Map([['BM', 3]])), { code: 'BM', rule: 'SINGLE_CANDIDATE' });

  assert.equal(
    resolvePropertyForIdentity(new Map([['AV', 2], ['CA', 1]]), { franchiseCode: 'CA' }).rule,
    'REVIEWED_FRANCHISE_RULE',
  );
  assert.equal(resolvePropertyForIdentity(new Map([['AV', 1], ['CA', 1]])).code, 'CA');
  assert.equal(resolvePropertyForIdentity(new Map([['AV', 1], ['MV', 1]])).code, 'AV');
  assert.equal(
    resolvePropertyForIdentity(new Map([['BM', 3], ['SM', 1]])).rule,
    'MAJORITY_OF_APPEARANCES',
  );
  const tie = resolvePropertyForIdentity(new Map([['A9', 1], ['C3', 1]]));
  assert.equal(tie.rule, 'NEEDS_HUMAN');
  assert.equal(tie.code, null);
});

// --- preserved rendition detail (owner requirement, 2026-07-29) ---

test('stripped qualifier text is captured, never discarded', () => {
  const result = stripQualifiers('Batman aka Bruce Wayne as portrayed by Christian Bale (Batman Begins 2005)');
  assert.equal(result.value, 'Batman aka Bruce Wayne');
  assert.equal(result.captured.portrayedBy, 'Christian Bale');
  assert.equal(result.captured.titleYear, 'Batman Begins 2005');

  const likeness = stripQualifiers('Batman (non-talent likeness)');
  assert.equal(likeness.captured.likeness, 'non-talent likeness');

  const guide = stripQualifiers('Ant-Man ( Avengers )', 'Avengers');
  assert.equal(guide.captured.guideContext, 'Avengers');
});

test('the rendition description reads as a human phrase', () => {
  assert.equal(
    renditionDescription({ titleYear: 'Batman Begins 2005', portrayedBy: 'Christian Bale', likeness: 'Non-Likeness' }),
    'Batman Begins 2005 · as portrayed by Christian Bale · non-likeness',
  );
  assert.equal(renditionDescription({}), '');
});

test('bridge metadata keeps the source name and only non-empty rendition keys', () => {
  const metadata = bridgeMetadata({
    characterName: 'Batman (non-talent likeness)',
    sourceCharacterId: 'abc',
    captured: { likeness: 'non-talent likeness' },
    rules: ['STRIP_LIKENESS', 'PRIMARY_ONLY'],
  });
  assert.equal(metadata.source_character_name, 'Batman (non-talent likeness)');
  assert.equal(metadata.source_character_id, 'abc');
  assert.deepEqual(metadata.rendition, { likeness_label: 'non-talent likeness' });
  assert.equal(metadata.rendition_description, 'non-talent likeness');
  assert.equal('portrayed_by' in metadata.rendition, false);

  const plain = bridgeMetadata({ characterName: 'Batman', rules: ['PRIMARY_ONLY'] });
  assert.equal('rendition' in plain, false);
  assert.equal('rendition_description' in plain, false);
});

test('no likeness boolean is ever emitted into a core column', () => {
  const metadata = bridgeMetadata({ characterName: 'Batman (non-likeness)', captured: { likeness: 'non-likeness' } });
  assert.equal('has_likeness' in metadata, false);
  assert.equal('likeness' in metadata, false);
});

test('resolved rows carry the metadata; a disambiguating alias is identity not rendition', () => {
  const { rows } = resolveIdentities([
    { styleGuide: 'Batman Begins (2005)', licensorId: 2, characterName: 'Batman as portrayed by Christian Bale', sourceCharacterId: '1' },
    { styleGuide: 'A', licensorId: 2, characterName: 'Robin aka Dick Grayson', sourceCharacterId: '2' },
    { styleGuide: 'B', licensorId: 2, characterName: 'Robin aka Damian Wayne', sourceCharacterId: '3' },
  ]);
  assert.equal(rows[0].metadata.rendition.portrayed_by, 'Christian Bale');
  assert.equal(rows[0].identityName, 'Batman');
  // The alias distinguishes the identity here, so it is not repeated as rendition.
  assert.equal(rows[1].metadata.rendition, undefined);
  assert.equal(rows[1].identityName, 'Robin aka Dick Grayson');
});

// --- cross-licensor validation (added after the MU/MUPPETS defect) ---

test('a property under a different licensor fails closed', () => {
  const result = validateStyleGuideProperty({
    legacyLicensorId: 3,
    code: 'MU',
    property: { code: 'MU', name: 'MUPPETS', licensorCode: 'DY', licensorName: 'DISNEY' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'LICENSOR_MISMATCH');
  assert.match(result.detail, /MUPPETS/);
});

test('the correct Marvel code passes for a Marvel style guide', () => {
  assert.deepEqual(
    validateStyleGuideProperty({
      legacyLicensorId: 3,
      code: 'MV',
      property: { code: 'MV', name: 'MARVEL ASSORTED STYLES', licensorCode: 'MV', licensorName: 'MARVEL' },
    }),
    { ok: true },
  );
});

test('a WB style guide may resolve to DC, Harry Potter, or Friends', () => {
  for (const licensorCode of ['WB', 'DC', 'HP', 'FR']) {
    assert.equal(validateStyleGuideProperty({
      legacyLicensorId: 2,
      code: 'BM',
      property: { code: 'BM', name: 'BATMAN', licensorCode, licensorName: licensorCode },
    }).ok, true);
  }
  assert.equal(validateStyleGuideProperty({
    legacyLicensorId: 2,
    code: 'BP',
    property: { code: 'BP', name: 'BLACK PANTHER', licensorCode: 'MV', licensorName: 'MARVEL' },
  }).failure, 'LICENSOR_MISMATCH');
});

test('a code valid in Coldlion but absent from core.property fails closed', () => {
  const result = validateStyleGuideProperty({ legacyLicensorId: 2, code: 'LB', property: undefined });
  assert.equal(result.failure, 'CODE_NOT_IN_CORE_PROPERTY');
  assert.match(result.detail, /dangling property_id/);
});

test('an unknown legacy licensor fails closed rather than passing', () => {
  assert.equal(validateStyleGuideProperty({
    legacyLicensorId: 99,
    code: 'BM',
    property: { code: 'BM', name: 'BATMAN', licensorCode: 'DC', licensorName: 'DC' },
  }).failure, 'UNKNOWN_LEGACY_LICENSOR');
});

test('no code and the NONE marker are not validation failures', () => {
  assert.deepEqual(validateStyleGuideProperty({ legacyLicensorId: 2, code: '' }), { ok: true });
  assert.deepEqual(validateStyleGuideProperty({ legacyLicensorId: 2, code: 'NONE' }), { ok: true });
});

test('a franchise code that is not among the candidates is not invented', () => {
  const result = resolvePropertyForIdentity(new Map([['AV', 1], ['MU', 1]]), { franchiseCode: 'CA' });
  assert.notEqual(result.rule, 'REVIEWED_FRANCHISE_RULE');
});
