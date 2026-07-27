# PopSG Property observation normalization contract v1

**Contract ID:** `popsg-property-observation-v1`

This contract freezes the current `normalizePopSGTag` behavior for PSG-0 evidence. It is a
specification only. It does not authorize application or database changes.

Apply these steps in this exact order:

1. Convert the input to Unicode NFKC.
2. Insert one ASCII space between a lowercase ASCII letter or digit and a following uppercase
   ASCII letter.
3. Convert text to lowercase using JavaScript `String.prototype.toLowerCase()`.
4. Remove straight and curly apostrophes without inserting a space.
5. Replace every run of underscore, slash, backslash, en dash, em dash, or ASCII hyphen with one
   ASCII space.
6. Replace every remaining run of characters outside ASCII `a-z` and `0-9` with one ASCII space.
   Ampersands and all remaining punctuation therefore become separators.
7. Trim leading and trailing whitespace.
8. Collapse every remaining whitespace run to one ASCII space.

The result is an ASCII lowercase key. Empty or punctuation-only inputs normalize to the empty
string and are not valid observations or aliases.

The canonical machine-readable fixture corpus is `normalization-fixtures-v1.json`; the matching
human-readable table is `normalization-fixtures-v1.csv`. PSG-5 must prove byte-for-byte
parity between the SQL and TypeScript implementations before either is used for a generated
column, uniqueness rule, mapping activation, or rebuild.

Known deliberate behavior:

- Apostrophes join surrounding characters: `Gabby’s` becomes `gabbys`.
- Ampersands separate words: `Parks & Rec` becomes `parks rec`.
- Hyphens and Unicode dashes separate words.
- NFKC expands compatibility forms such as full-width letters and ligatures.
- Accented letters are not transliterated. They are removed by the ASCII-only step.
- The contract does not perform fuzzy matching, synonym expansion, or Licensor/Property lookup.
