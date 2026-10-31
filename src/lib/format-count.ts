/** "1,000" — counts are exact only (owner ask 2026-10-29; search_dam_documents
 * no longer reports lower bounds). */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
