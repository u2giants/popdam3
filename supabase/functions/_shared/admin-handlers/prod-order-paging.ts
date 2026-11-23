/**
 * The tracking grid API pages like AG Grid: startRow is a 0-based offset and
 * endRow is exclusive (designflow-tracking helpers/gridPage.js). The old
 * 1-based inclusive window skipped one row per page (popdam3#1272).
 */
export function prodOrderPageWindow(page: number, pageSize: number): { startRow: number; endRow: number } {
  const startRow = page * pageSize;
  return { startRow, endRow: startRow + pageSize };
}
