// Loose Property-name key for comparing ColdLion MG06 names with scraped licensor
// Submissions vocabularies. Two names that reduce to the same key are the same name for
// comparison purposes; the key is never stored or shown as a Property name.
//
// It deliberately ignores only presentation noise that licensing staff cannot see or
// reasonably reproduce by hand: case, accents, dash style (– — − vs -), spacing, quote
// and apostrophe style (’ ' " etc.), "&" vs "and", and a leading/trailing article
// ("The Lost Boys" vs "Lost Boys, The (1987)" keeps the year, so it still differs from
// "The Lost Boys"). Every word and number must still agree.

export function propertyNameKey(name) {
  let s = String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.replace(/[‐-―−]/g, "-");
  s = s.replace(/[‘’‚‛“”„‟'"`´]/g, "");
  s = s.replace(/&/g, " and ");
  // "Lost Boys, The (1987)" -> "the lost boys (1987)"
  const trailing = /^(.*?),\s*the(\s*\(.*\))?\s*$/.exec(s);
  if (trailing) s = `the ${trailing[1]}${trailing[2] ?? ""}`;
  s = s.replace(/^\s*the\s+/, "");
  return s.replace(/[^a-z0-9]+/g, "");
}

// Classify each ColdLion name against a scraped vocabulary.
// Returns { exact, loose, unmatched } arrays of the input rows.
export function matchPropertyNames(coldlionRows, scrapedLabels) {
  const exact = new Set(scrapedLabels);
  const loose = new Set(scrapedLabels.map(propertyNameKey));
  const out = { exact: [], loose: [], unmatched: [] };
  for (const row of coldlionRows) {
    if (exact.has(row.name)) out.exact.push(row);
    else if (propertyNameKey(row.name) !== "" && loose.has(propertyNameKey(row.name))) out.loose.push(row);
    else out.unmatched.push(row);
  }
  return out;
}
