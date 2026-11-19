// @ts-self-types="./canonical-item-identity.d.ts"
export function canonicalItemKey(item) {
  return `${item.source_system}|${item.division_code ?? ""}|${item.source_id}`;
}

export function canonicalItemMatchKey(styleNumber, divisionCode) {
  return `${divisionCode ?? ""}|${styleNumber ?? ""}`;
}

export function uniqueCanonicalItemIds(
  rows,
) {
  const ids = new Map();
  const ambiguous = new Set();
  for (const row of rows) {
    const key = canonicalItemKey({ source_system: row.source_system, division_code: row.raw?.divisionCode ?? null, source_id: row.item_number });
    if (ambiguous.has(key)) continue;
    const existing = ids.get(key);
    if (existing !== undefined && existing !== row.id) {
      ids.delete(key);
      ambiguous.add(key);
      continue;
    }
    ids.set(key, row.id);
  }
  return ids;
}
