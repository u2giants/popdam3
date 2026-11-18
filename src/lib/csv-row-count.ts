/** Count data rows (excluding the header) in CSV text, ignoring newlines inside quoted fields. */
export function countCsvRows(text: string): number {
  let rows = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "\n" && !inQuotes) rows++;
  }
  if (text.length > 0 && !text.endsWith("\n")) rows++;
  return Math.max(0, rows - 1);
}
