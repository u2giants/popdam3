/**
 * Customer bulk buy-sheet import (Burlington "PURCHASE ORDER WORKSHEET -
 * DOMESTIC", HFC / up-front production). Reads the sheet into a plain cell
 * grid and turns it into one OrderList line per style per delivery.
 *
 * The sheet's header row is not trusted for item columns (on the sample the
 * labels sit one column off the data), so item columns are found by content.
 * Its quantity cells are mostly formulas saved without results, so the
 * worksheet's own formula rules are re-applied here:
 *   - Total # of Prepacks: a typed number, or (formula) the last value for
 *     that Complex Pack ID, else nothing;
 *   - Total Prepack Units: prepacks x qty in each prepack.
 * The database function (public.import_dam_buy_sheet) decides matching.
 */

export type BuySheetCell = string | number | null | { formula: string };
export type BuySheetGrid = BuySheetCell[][]; // [row][col], 0-based

export type BuySheetDelivery = {
  index: number;
  label: string;
  date: string; // yyyy-mm-dd ex-factory date
  firstColumn: number;
};

export type BuySheetLine = {
  sku: string;
  delivery_date: string;
  quantity: number;
  case_pack: number | null;
  group: string;
  pack: string;
  sheet_row: number; // 1-based
  delivery: number;
  qty_per_prepack: number;
  prepacks: number;
  burl_style: string | null;
  label: string | null;
  season: string | null;
  color: string | null;
  description: string | null;
  fob_price: number | null;
};

export type BuySheetParse = {
  headerFields: Record<string, string>;
  deliveries: BuySheetDelivery[];
  lines: BuySheetLine[];
  itemRowCount: number;
  totalsByDelivery: Record<string, number>;
  columns: Record<string, string>;
};

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function text(cell: BuySheetCell | undefined): string {
  if (cell == null || typeof cell === "object") return "";
  return String(cell).replace(/\s+/g, " ").trim();
}

function num(cell: BuySheetCell | undefined): number | null {
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  if (typeof cell === "string" && /^-?\d+(\.\d+)?$/.test(cell.trim())) return Number(cell.trim());
  return null;
}

const isFormula = (cell: BuySheetCell | undefined) => cell != null && typeof cell === "object";
const STYLE = /^[A-Z0-9]{6,15}$/;

/** "12/20 X FACT" → yyyy-mm-dd, in the first year that is not long past `reference`. */
export function exFactoryDate(label: string, reference: Date): string | null {
  const m = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/.exec(label);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : reference.getFullYear();
  if (!m[3]) {
    const candidate = Date.UTC(year, month - 1, day);
    const floor = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()) - 120 * 86400000;
    if (candidate < floor) year += 1;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseBuySheetGrid(grid: BuySheetGrid, reference: Date = new Date()): BuySheetParse {
  const width = Math.max(0, ...grid.map((r) => r?.length ?? 0));
  const cell = (r: number, c: number) => grid[r]?.[c];

  // Item header row: the one naming the Complex Pack ID.
  const headerRow = grid.findIndex((row) => (row ?? []).some((c) => /complex\s*pack\s*id/i.test(text(c))));
  if (headerRow < 0) throw new Error("This does not look like a buy sheet: no 'Complex Pack ID' header row.");
  const header = (c: number) => text(cell(headerRow, c));
  const packCol = (grid[headerRow] ?? []).findIndex((c) => /complex\s*pack\s*id/i.test(text(c)));
  const findHeader = (re: RegExp) => {
    for (let c = 0; c < width; c += 1) if (re.test(header(c))) return c;
    return -1;
  };

  // Item rows: a numeric Complex Pack ID and some style-like code on the row.
  const itemRows: number[] = [];
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const pack = num(cell(r, packCol));
    if (pack == null) continue;
    if ((grid[r] ?? []).some((c) => /\btotal\b/i.test(text(c)))) continue;
    itemRows.push(r);
  }
  if (itemRows.length === 0) throw new Error("No item rows found under the header row.");

  // POP style: the column (left of the deliveries) whose every item cell is a style code.
  const deliveryStarts: number[] = [];
  for (let r = 0; r < headerRow; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const m = /^delivery\s*#\s*(\d+)$/i.exec(text(cell(r, c)));
      if (m && text(cell(r, c - 1)) !== text(cell(r, c))) deliveryStarts.push(c);
    }
    if (deliveryStarts.length) break;
  }
  if (deliveryStarts.length === 0) throw new Error("No DELIVERY # columns found.");
  const firstDelivery = Math.min(...deliveryStarts);
  let styleCol = -1;
  for (let c = packCol + 1; c < firstDelivery; c += 1) {
    const values = itemRows.map((r) => text(cell(r, c)).toUpperCase());
    if (values.every((v) => STYLE.test(v.replace(/\s/g, ""))) && values.every((v) => v !== "NEW") && /\d/.test(values.join(""))) {
      styleCol = c;
      break;
    }
  }
  if (styleCol < 0) throw new Error("Could not find the POP style column (every item row must carry a style number).");
  const burlStyleCol = findHeader(/burl/i);
  const labelCol = findHeader(/^label$/i);
  const seasonCol = findHeader(/^season$/i);
  const colorCol = findHeader(/catalog color/i);
  const descriptionCol = findHeader(/^description$/i);
  const fobCol = findHeader(/fob/i);

  // Header fields above the item header ("Label:" → value to its right).
  const headerFields: Record<string, string> = {};
  for (let r = 0; r < headerRow; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const key = text(cell(r, c));
      if (!key.endsWith(":") || headerFields[key.slice(0, -1)] !== undefined) continue;
      let v = c + 1;
      while (v < width && text(cell(r, v)) === key) v += 1;
      const value = text(cell(r, v));
      if (value && !value.endsWith(":")) headerFields[key.slice(0, -1)] = value;
    }
  }

  // Deliveries: within each 5-column block find quantity columns by header.
  const deliveries: BuySheetDelivery[] = [];
  const lines: BuySheetLine[] = [];
  const totalsByDelivery: Record<string, number> = {};
  for (const [i, start] of deliveryStarts.entries()) {
    const span = [start, start + 1, start + 2, start + 3, start + 4];
    const qtyCol = span.find((c) => /qty in each prepack/i.test(header(c)));
    const packsCol = span.find((c) => /total # of prepacks/i.test(header(c)));
    const unitsCol = span.find((c) => /total prepack units/i.test(header(c)));
    if (qtyCol == null || packsCol == null || unitsCol == null) continue;
    let label = "";
    for (let r = 0; r < headerRow && !label; r += 1) {
      const v = text(cell(r, start));
      if (/x\s*fact/i.test(v)) label = v;
    }
    const date = label ? exFactoryDate(label, reference) : null;
    // A delivery with no date and no quantity is an unused block.
    const prepacksByPack = new Map<number, number>();
    const rows = itemRows.map((r) => {
      const pack = num(cell(r, packCol))!;
      const raw = cell(r, packsCol);
      let prepacks = num(raw);
      if (prepacks == null) prepacks = isFormula(raw) ? prepacksByPack.get(pack) ?? 0 : 0;
      prepacksByPack.set(pack, prepacks);
      const qtyPer = num(cell(r, qtyCol)) ?? 0;
      const typedUnits = num(cell(r, unitsCol));
      const units = typedUnits ?? prepacks * qtyPer;
      return { r, pack, prepacks, qtyPer, units };
    });
    const total = rows.reduce((s, x) => s + x.units, 0);
    if (!date) {
      if (total > 0) throw new Error(`Delivery #${i + 1} has quantities but no ex-factory date.`);
      continue;
    }
    deliveries.push({ index: i + 1, label, date, firstColumn: start });
    totalsByDelivery[date] = (totalsByDelivery[date] ?? 0) + total;
    const casePack = new Map<number, number>();
    for (const x of rows) if (x.prepacks > 0) casePack.set(x.pack, (casePack.get(x.pack) ?? 0) + x.qtyPer);
    for (const x of rows) {
      if (x.prepacks <= 0) continue; // the pack does not ship in this delivery
      lines.push({
        sku: text(cell(x.r, styleCol)).toUpperCase().replace(/\s/g, ""),
        delivery_date: date,
        quantity: x.units,
        case_pack: casePack.get(x.pack) ?? null,
        group: `${date}|${x.pack}`,
        pack: String(x.pack),
        sheet_row: x.r + 1,
        delivery: i + 1,
        qty_per_prepack: x.qtyPer,
        prepacks: x.prepacks,
        burl_style: burlStyleCol >= 0 ? text(cell(x.r, burlStyleCol)) || null : null,
        label: labelCol >= 0 ? text(cell(x.r, labelCol)) || null : null,
        season: seasonCol >= 0 ? text(cell(x.r, seasonCol)) || null : null,
        color: colorCol >= 0 ? text(cell(x.r, colorCol)) || null : null,
        description: descriptionCol >= 0 ? text(cell(x.r, descriptionCol)) || null : null,
        fob_price: fobCol >= 0 ? num(cell(x.r, fobCol)) : null,
      });
    }
  }

  const duplicate = new Set<string>();
  for (const l of lines) {
    const key = `${l.sku}|${l.delivery_date}`;
    if (duplicate.has(key)) throw new Error(`Style ${l.sku} appears twice for ${l.delivery_date}.`);
    duplicate.add(key);
  }

  return {
    headerFields,
    deliveries,
    lines,
    itemRowCount: itemRows.length,
    totalsByDelivery,
    columns: { pack: columnLetter(packCol), style: columnLetter(styleCol), fob: fobCol >= 0 ? columnLetter(fobCol) : "" },
  };
}

/** Reads the first worksheet of an .xlsx into a cell grid (formulas without results kept as formulas). */
export async function readBuySheetGrid(data: ArrayBuffer | Uint8Array): Promise<{ sheetName: string; grid: BuySheetGrid }> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.load((data instanceof Uint8Array ? data : new Uint8Array(data)) as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets.");
  const grid: BuySheetGrid = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const out: BuySheetCell[] = [];
    row.eachCell({ includeEmpty: true }, (c, col) => {
      const v: any = c.value;
      let value: BuySheetCell = null;
      if (v == null) value = null;
      else if (typeof v === "number" || typeof v === "string") value = v;
      else if (typeof v === "boolean") value = String(v);
      else if (v instanceof Date) value = v.toISOString().slice(0, 10);
      else if (v.richText) value = v.richText.map((t: any) => t.text).join("");
      else if ("result" in v && v.result !== undefined && (typeof v.result !== "object" || v.result === null)) value = v.result ?? null;
      else if (v.formula || v.sharedFormula) value = { formula: String(v.formula ?? `=${v.sharedFormula}`) };
      else if (v.text) value = String(v.text);
      else if (v.error) value = String(v.error);
      out[col - 1] = value;
    });
    grid[rowNumber - 1] = out;
  });
  return { sheetName: sheet.name, grid };
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
