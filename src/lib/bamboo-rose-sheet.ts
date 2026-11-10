/**
 * Burlington "Bamboo Rose" quote sheet (quote_excel.xml), built from a parsed
 * HFC buy sheet plus the OrderList lines it created. Rules follow the sales
 * assistant's own field guide (bamboo_rose_explanation.xlsx, 2026-11-10):
 * one PARENT row per pack per delivery, then one CHILD row per style.
 *
 * Fields a person still supplies (carton sizes/weights, materials, inner
 * packs, pallets) are left blank; cells the generator guessed (HTS when not in
 * ColdLion, factory # when the vendor is unknown) are listed in `checks`.
 */
import type { BuySheetParse } from "@/lib/buy-sheet-import";

export const BAMBOO_ROSE_COLUMNS = [
  "Buyer", "Catalog Style Name/Number", "Description", "Catalog Color", "Pack Method", "Complex Pack Name",
  "Complex Parent / Child", "NRF Color Code", "UPC", "Image File Name", "Label from Vendor", "First Cost", "Total Units",
  "Qty in Master Ctn", "Qty in Each Inner", "Inners/Ctn", "Width", "Length", "Height", "IN or CM",
  "Carton Volume (CBM) Vendor Override", "Product Weight (Net Weight KG)", "Carton Weight (KG)", "Pallet?",
  "Number of Pallets", "Pallet Assortment", "Category Selection for Classification",
  "Material % of Commodity and Components", "Description of Commodity and Components", "New / Carryover", "Set?",
  "Multi HTS?", "HTS Code", "Vendor #", "Vendor Email Address", "Supplier Notes for Buyer", "Terms Set/Inco",
  "Factory #", "Is Fcty the Stuffing Location?", "Stuffing Location #", "Port of Origin",
  "Earliest Ship / X Factory Date", "MOQ", "Lead Days", "Response Due Date (MM/DD/YYYY)", "Size Range",
] as const;

type Col = (typeof BAMBOO_ROSE_COLUMNS)[number];
export type BambooRoseRow = Partial<Record<Col, string | number>>;

/** OrderList facts for one style on one delivery date. */
export type OrderListFact = {
  sku: string;
  start_ship_date: string; // yyyy-mm-dd
  assortment_id: string | null;
  ship_to: string | null;
  vendor_name: string | null;
};

/** Burlington's Bamboo Rose factory numbers, by OrderList vendor (from Fabi's 10-20-26 sheet). */
export const BAMBOO_ROSE_FACTORY: Record<string, string> = {
  "aggie chen": "006138",
  "rita okay home": "007767",
  "jerome chen": "006121",
  "lucy wang": "006051",
  "jojo xu": "006741",
};

/** HTS by product wording when ColdLion has none: canvas/gel/glitter prints vs framed/glass/molded. */
export function guessHts(description: string): string {
  return /\b(CVS|CNVS|CANVAS|GEL|GLT|DD|STAGGER|STAGR)\b/i.test(description) ? "4911914040" : "4911998000";
}

export type BambooRoseOptions = {
  buyer: string;
  vendorEmail: string;
  packSuffix: string; // e.g. "V2" → AAQ1403-V2
  vendorNumber?: string;
  terms?: string;
  category?: string;
  hts?: Record<string, string>; // sku → HTS (ColdLion), digits only
};

export type BambooRoseResult = { rows: BambooRoseRow[]; checks: string[] };

const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

export function buildBambooRoseRows(parse: BuySheetParse, facts: OrderListFact[], opts: BambooRoseOptions): BambooRoseResult {
  const fact = new Map(facts.map((f) => [`${f.sku.toUpperCase()}|${f.start_ship_date}`, f]));
  const checks: string[] = [];
  const common: BambooRoseRow = {
    Buyer: opts.buyer,
    "Catalog Color": "MULTI",
    "Pack Method": "COMPLEX",
    "Pallet?": "N",
    "Category Selection for Classification": opts.category ?? "HOME DECOR - WALL ART",
    "Set?": "N",
    "Vendor #": opts.vendorNumber ?? "90001808",
    "Vendor Email Address": opts.vendorEmail,
    "Terms Set/Inco": opts.terms ?? "DI FOB CY",
    "Is Fcty the Stuffing Location?": "Y",
    "Size Range": "ITEM NOT SIZED",
  };

  // Packs in delivery-date order, each keeping the sheet's row order.
  const groups = new Map<string, typeof parse.lines>();
  for (const l of [...parse.lines].sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.sheet_row - b.sheet_row)) {
    if (l.quantity <= 0) continue;
    groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  }

  // An assortment shipping on more than one date gets a -MMDD suffix.
  const assortmentOf = (lines: typeof parse.lines) =>
    lines.map((l) => fact.get(`${l.sku}|${l.delivery_date}`)?.assortment_id?.trim()).find(Boolean) ?? null;
  const datesPerAssortment = new Map<string, Set<string>>();
  for (const lines of groups.values()) {
    const a = assortmentOf(lines);
    if (a) datesPerAssortment.set(a, (datesPerAssortment.get(a) ?? new Set()).add(lines[0].delivery_date));
  }

  const rows: BambooRoseRow[] = [];
  for (const lines of groups.values()) {
    const date = lines[0].delivery_date;
    const facts = lines.map((l) => fact.get(`${l.sku}|${date}`));
    let assortment = assortmentOf(lines);
    if (!assortment) {
      assortment = `PACK${lines[0].pack}-${date.slice(5, 7)}${date.slice(8, 10)}`;
      checks.push(`Pack ${lines[0].pack} (${usDate(date)}) has no assortment ID in OrderList; used ${assortment}.`);
    } else if ((datesPerAssortment.get(assortment)?.size ?? 0) > 1) {
      assortment = `${assortment}-${date.slice(5, 7)}${date.slice(8, 10)}`;
    }
    const packName = opts.packSuffix ? `${assortment}-${opts.packSuffix}` : assortment;
    const vendor = facts.map((f) => f?.vendor_name?.trim()).find(Boolean) ?? "";
    const factory = BAMBOO_ROSE_FACTORY[vendor.toLowerCase()] ?? "";
    if (!factory) checks.push(`${packName}: no Bamboo Rose factory # known for vendor "${vendor || "unknown"}".`);
    const port = facts.map((f) => f?.ship_to?.trim()).find(Boolean) ?? "";
    if (!port) checks.push(`${packName}: no port of origin in OrderList.`);
    const shared: BambooRoseRow = {
      ...common,
      "Complex Pack Name": packName,
      "Factory #": factory,
      "Port of Origin": port,
      "Earliest Ship / X Factory Date": usDate(date),
    };
    const pieces = lines.reduce((s, l) => s + l.qty_per_prepack, 0);
    rows.push({
      ...shared,
      "Catalog Style Name/Number": assortment,
      Description: `${assortment} ${pieces}PC WALL ART ASSORTMENT`,
      "Complex Parent / Child": "PARENT",
      "Image File Name": assortment,
      "Total Units": lines[0].prepacks,
      "Qty in Master Ctn": 1,
      "Material % of Commodity and Components": "NA",
      "New / Carryover": "NEW",
      "Multi HTS?": "Y",
      "HTS Code": "MULTI",
    });
    for (const l of lines) {
      const description = l.description ?? "";
      let hts = opts.hts?.[l.sku] ?? "";
      if (!hts) {
        hts = guessHts(description);
        checks.push(`${l.sku}: HTS ${hts} guessed from "${description}" (not in ColdLion).`);
      }
      rows.push({
        ...shared,
        "Catalog Style Name/Number": l.sku,
        Description: description,
        "Complex Parent / Child": "CHILD",
        "Image File Name": l.sku,
        "Label from Vendor": l.label || "NO LABEL",
        "First Cost": l.fob_price ?? "",
        "Total Units": l.quantity,
        "Qty in Master Ctn": l.qty_per_prepack,
        "New / Carryover": (l.burl_style ?? "").toUpperCase() === "NEW" ? "NEW" : "CARRYOVER",
        "Multi HTS?": "N",
        "HTS Code": hts,
      });
    }
  }
  return { rows, checks };
}

/** Column letters A.. for the 46 Bamboo Rose columns. */
const LETTERS = BAMBOO_ROSE_COLUMNS.map((_, i) => {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
});
const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
};

/**
 * Writes the rows into a Bamboo Rose template (the blank sheet downloaded from
 * the portal, or an earlier filled one). Edits only the first sheet's cells in
 * columns A–AT from row 2 on, straight in the file's XML, so every other sheet,
 * lookup list, dropdown and hidden formula stays exactly as Burlington sent it.
 * Past the data rows the template's own formulas are kept and old typed values cleared.
 */
export async function fillBambooRoseTemplate(template: ArrayBuffer | Uint8Array, rows: BambooRoseRow[]): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(template);
  const read = async (path: string) => {
    const f = zip.file(path);
    if (!f) throw new Error(`This is not a Bamboo Rose quote sheet (missing ${path}).`);
    return f.async("string");
  };
  const parser = new DOMParser();
  const workbook = parser.parseFromString(await read("xl/workbook.xml"), "application/xml");
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  const relId = firstSheet?.getAttribute("r:id");
  const rels = parser.parseFromString(await read("xl/_rels/workbook.xml.rels"), "application/xml");
  const target = [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === relId)?.getAttribute("Target");
  if (!target) throw new Error("Could not find the template's first sheet.");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const doc = parser.parseFromString(await read(sheetPath), "application/xml");
  const ns = doc.documentElement.namespaceURI;
  const el = (name: string) => doc.createElementNS(ns, name);

  // Shared strings, only to check the header row.
  const shared: string[] = [];
  const sst = zip.file("xl/sharedStrings.xml");
  if (sst) {
    const sdoc = parser.parseFromString(await sst.async("string"), "application/xml");
    for (const si of [...sdoc.getElementsByTagName("si")]) {
      shared.push([...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""));
    }
  }
  const sheetData = doc.getElementsByTagName("sheetData")[0];
  const rowEls = new Map<number, Element>();
  for (const r of [...sheetData.getElementsByTagName("row")]) rowEls.set(Number(r.getAttribute("r")), r);
  const cellText = (c: Element | undefined) => {
    if (!c) return "";
    const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
    if (c.getAttribute("t") === "s") return shared[Number(v)] ?? "";
    if (c.getAttribute("t") === "inlineStr") return c.getElementsByTagName("t")[0]?.textContent ?? "";
    return v;
  };
  const cellsOf = (row: Element) => new Map([...row.getElementsByTagName("c")].map((c) => [c.getAttribute("r") ?? "", c]));
  const headerCells = cellsOf(rowEls.get(1) ?? el("row"));
  BAMBOO_ROSE_COLUMNS.forEach((name, i) => {
    const got = cellText(headerCells.get(`${LETTERS[i]}1`)).trim();
    if (got !== name) throw new Error(`Template column ${LETTERS[i]} is "${got}", expected "${name}". Is this the Bamboo Rose quote sheet?`);
  });

  const getRow = (r: number) => {
    let row = rowEls.get(r);
    if (row) return row;
    row = el("row");
    row.setAttribute("r", String(r));
    const after = [...rowEls.keys()].sort((a, b) => a - b).find((k) => k > r);
    sheetData.insertBefore(row, after == null ? null : rowEls.get(after)!);
    rowEls.set(r, row);
    return row;
  };
  const clear = (c: Element) => {
    while (c.firstChild) c.removeChild(c.firstChild);
    c.removeAttribute("t");
  };

  const lastTemplateRow = Math.max(0, ...rowEls.keys());
  const last = Math.max(lastTemplateRow, rows.length + 1);
  for (let r = 2; r <= last; r += 1) {
    const data = rows[r - 2];
    if (!data && !rowEls.has(r)) continue;
    const row = getRow(r);
    const cells = cellsOf(row);
    BAMBOO_ROSE_COLUMNS.forEach((name, i) => {
      const ref = `${LETTERS[i]}${r}`;
      let c = cells.get(ref);
      if (!data) {
        if (c && !c.getElementsByTagName("f").length) clear(c);
        return;
      }
      const value = data[name];
      if (value === undefined || value === "") {
        if (c) clear(c);
        return;
      }
      if (!c) {
        c = el("c");
        c.setAttribute("r", ref);
        const next = [...row.getElementsByTagName("c")].find((x) => colIndex(x.getAttribute("r") ?? "") > i);
        row.insertBefore(c, next ?? null);
      }
      clear(c);
      if (typeof value === "number") {
        const v = el("v");
        v.textContent = String(value);
        c.appendChild(v);
      } else {
        c.setAttribute("t", "inlineStr");
        const is = el("is");
        const t = el("t");
        t.textContent = value;
        is.appendChild(t);
        c.appendChild(is);
      }
    });
    row.removeAttribute("spans");
  }
  zip.file(sheetPath, new XMLSerializer().serializeToString(doc));

  // Formulas were replaced by values: drop the stale calculation chain and recalc on open.
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const ct = await read("[Content_Types].xml");
    zip.file("[Content_Types].xml", ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
    zip.file("xl/_rels/workbook.xml.rels", (await read("xl/_rels/workbook.xml.rels")).replace(/<Relationship[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, ""));
  }
  const calcPr = workbook.getElementsByTagName("calcPr")[0];
  if (calcPr) {
    calcPr.setAttribute("fullCalcOnLoad", "1");
    zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(workbook));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
