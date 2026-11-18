/**
 * Which characters (and properties) a typed search names (u2giants/popdam3#1037 Step 2).
 *
 * Owner ruling D1 (Nov 17, 2026): "naming a character should show only products that contain
 * that character." The picture leg cannot tell one cartoon cat from another, so a search that
 * names a character sends search_dam_documents the character's ids and the typed name; every leg
 * then keeps only products tagged with the character or naming it in their own text
 * (p_filters.requiredCharacterIds / requiredLegacyCharacterIds / requiredCharacterNames,
 * popcre/shared-db#6607).
 *
 * A search that names a property and no character sends the property and its linked characters
 * (core.property_character_associations_current) as an accepted set for picture-only matches
 * (semanticPropertyIds / semanticPropertyCharacterIds). Exact-word matches are untouched.
 *
 * Browser and Deno shared code: keep this dependency-free.
 */

export type NamedRow = { id: string; name: string };
export type CharacterAliasRow = { characterId: string; alias: string };
export type PropertyCharacterRow = { propertyId: string; characterId: string };

export type NameIndexInput = {
  characters: ReadonlyArray<NamedRow>;
  aliases: ReadonlyArray<CharacterAliasRow>;
  legacyCharacters: ReadonlyArray<NamedRow>;
  properties: ReadonlyArray<NamedRow>;
  propertyCharacters: ReadonlyArray<PropertyCharacterRow>;
  /** Licensor names and aliases: a name that is also a licensor counts as the licensor. */
  licensorNames: ReadonlyArray<string>;
  /** Product words ("frame", "rug"): never a character name, even if a row says so. */
  productWords: Iterable<string>;
};

type NameEntry = { core: Set<string>; legacy: Set<string>; properties: Set<string>; licensor: boolean };

export type NameIndex = {
  names: Map<string, NameEntry>;
  maxWords: number;
  propertyCharacters: Map<string, Set<string>>;
  characterProperties: Map<string, Set<string>>;
};

export type NamedScope = {
  requiredCharacterIds?: string[];
  requiredLegacyCharacterIds?: string[];
  requiredCharacterNames?: string[];
  semanticPropertyIds?: string[];
  semanticPropertyCharacterIds?: string[];
};

/** Characters shorter than this ("Al", "Bo") are too ambiguous to require. */
const MIN_CHARACTER_NAME_LENGTH = 3;
/** Names longer than this many words are never matched (bounds the scan per query). */
const MAX_NAME_WORDS = 8;
/** Only the start of a very long query is scanned. */
const MAX_TEXT_LENGTH = 500;

export const normalizeName = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function searchWords(text: string): string[] {
  return normalizeName(text.slice(0, MAX_TEXT_LENGTH)).split(" ").filter(Boolean);
}

/** The only name keys the typed text or its spelling correction can match. */
export function namedSearchPhrases(texts: ReadonlyArray<string | null | undefined>): string[] {
  const phrases = new Set<string>();
  for (const text of texts) {
    const words = searchWords(text ?? "");
    for (let start = 0; start < words.length; start++) {
      for (let end = start + 1; end <= Math.min(words.length, start + MAX_NAME_WORDS); end++) {
        phrases.add(words.slice(start, end).join(" "));
      }
    }
  }
  return [...phrases];
}

export function buildNameIndex(input: NameIndexInput): NameIndex {
  const productWords = new Set([...input.productWords].map(normalizeName));
  const names = new Map<string, NameEntry>();
  let maxWords = 0;
  const entry = (raw: string): NameEntry | null => {
    const name = normalizeName(raw);
    if (!name) return null;
    const words = name.split(" ").length;
    if (words > MAX_NAME_WORDS) return null;
    let found = names.get(name);
    if (!found) {
      found = { core: new Set(), legacy: new Set(), properties: new Set(), licensor: false };
      names.set(name, found);
      maxWords = Math.max(maxWords, words);
    }
    return found;
  };
  const characterName = (raw: string) => {
    const name = normalizeName(raw);
    return name.length >= MIN_CHARACTER_NAME_LENGTH && !productWords.has(name);
  };
  for (const { id, name } of input.characters) if (characterName(name)) entry(name)?.core.add(id);
  for (const { characterId, alias } of input.aliases) if (characterName(alias)) entry(alias)?.core.add(characterId);
  for (const { id, name } of input.legacyCharacters) if (characterName(name)) entry(name)?.legacy.add(id);
  for (const { id, name } of input.properties) entry(name)?.properties.add(id);
  for (const name of input.licensorNames) {
    const found = entry(name);
    if (found) found.licensor = true;
  }
  const propertyCharacters = new Map<string, Set<string>>();
  const characterProperties = new Map<string, Set<string>>();
  for (const { propertyId, characterId } of input.propertyCharacters) {
    if (!propertyCharacters.has(propertyId)) propertyCharacters.set(propertyId, new Set());
    propertyCharacters.get(propertyId)!.add(characterId);
    if (!characterProperties.has(characterId)) characterProperties.set(characterId, new Set());
    characterProperties.get(characterId)!.add(propertyId);
  }
  return { names, maxWords, propertyCharacters, characterProperties };
}

type Match = { start: number; end: number; name: string; entry: NameEntry };

/** Every known name on word boundaries; a name inside a longer matched name is dropped. */
function matchNames(text: string, index: NameIndex): Match[] {
  const words = searchWords(text);
  const matches: Match[] = [];
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= Math.min(words.length, start + index.maxWords); end++) {
      const name = words.slice(start, end).join(" ");
      const entry = index.names.get(name);
      if (entry) matches.push({ start, end, name, entry });
    }
  }
  return matches.filter((m) =>
    !matches.some((other) => other !== m && other.start <= m.start && other.end >= m.end && other.end - other.start > m.end - m.start)
  );
}

/** The scope a search's texts (typed words, spelling correction) name. Empty when none. */
export function namedCharacterScope(texts: ReadonlyArray<string | null | undefined>, index: NameIndex): NamedScope {
  const characterNames = new Map<string, NameEntry>();
  const propertyIds = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const { name, entry } of matchNames(text, index)) {
      // A licensor or property name that is also a character name counts as the licensor/property.
      if (entry.licensor) continue;
      if (entry.properties.size) {
        entry.properties.forEach((id) => propertyIds.add(id));
        continue;
      }
      if (entry.core.size || entry.legacy.size) characterNames.set(name, entry);
    }
  }
  if (characterNames.size) {
    const core = new Set<string>();
    const legacy = new Set<string>();
    for (const entry of characterNames.values()) {
      // Same-named characters (two "Marie" rows) are one request; when the words also name a
      // property, keep the rows linked to it, if any are.
      const linked = propertyIds.size ? [...entry.core].filter((id) => [...(index.characterProperties.get(id) ?? [])].some((p) => propertyIds.has(p))) : [];
      (linked.length ? linked : [...entry.core]).forEach((id) => core.add(id));
      entry.legacy.forEach((id) => legacy.add(id));
    }
    const scope: NamedScope = { requiredCharacterNames: [...characterNames.keys()].sort() };
    if (core.size) scope.requiredCharacterIds = [...core].sort();
    if (legacy.size) scope.requiredLegacyCharacterIds = [...legacy].sort();
    return scope;
  }
  if (propertyIds.size) {
    const characters = new Set<string>();
    propertyIds.forEach((id) => index.propertyCharacters.get(id)?.forEach((c) => characters.add(c)));
    // The characters-per-property index is thin: a property with no linked character skips the
    // rule instead of hiding its untagged products.
    if (characters.size === 0) return {};
    return { semanticPropertyIds: [...propertyIds].sort(), semanticPropertyCharacterIds: [...characters].sort() };
  }
  return {};
}

/**
 * Filters for one search call. Character keys apply to every leg; property keys only when
 * pictures are searched. Explicit property/character filters already limit every match.
 */
export function withNamedScope(filters: Record<string, unknown>, scope: NamedScope, usesPictures: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...filters };
  if (scope.requiredCharacterNames?.length && !filters.characterId) {
    out.requiredCharacterNames = scope.requiredCharacterNames;
    if (scope.requiredCharacterIds?.length) out.requiredCharacterIds = scope.requiredCharacterIds;
    if (scope.requiredLegacyCharacterIds?.length) out.requiredLegacyCharacterIds = scope.requiredLegacyCharacterIds;
  }
  if (usesPictures && scope.semanticPropertyIds?.length && !filters.propertyId) {
    out.semanticPropertyIds = scope.semanticPropertyIds;
    out.semanticPropertyCharacterIds = scope.semanticPropertyCharacterIds ?? [];
  }
  return out;
}

export const hasNamedScope = (filters: Record<string, unknown>) =>
  ["requiredCharacterNames", "requiredCharacterIds", "requiredLegacyCharacterIds", "semanticPropertyIds"].some((key) =>
    Array.isArray(filters[key]) && (filters[key] as unknown[]).length > 0
  );

const SCOPE_KEYS = [
  "semanticLicensorIds",
  "requiredCharacterIds",
  "requiredLegacyCharacterIds",
  "requiredCharacterNames",
  "semanticPropertyIds",
  "semanticPropertyCharacterIds",
] as const;

/** Only the scope keys, for the picture-floor anchor (it applies no visibility filters). */
export function pickScopeKeys(filters: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(SCOPE_KEYS.flatMap((key) => filters[key] === undefined ? [] : [[key, filters[key]]]));
}
