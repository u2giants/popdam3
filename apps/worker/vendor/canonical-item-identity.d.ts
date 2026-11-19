export interface CanonicalItemIdentity {
  source_id: string;
  source_system: string;
  division_code: string | null;
}

export function canonicalItemKey(item: CanonicalItemIdentity): string;

export function canonicalItemMatchKey(styleNumber: string | null, divisionCode: string | null): string;

export function uniqueCanonicalItemIds(
  rows: Array<{ id: string; source_system: string; item_number: string; raw?: { divisionCode?: string | null } | null }>,
): Map<string, string>;
