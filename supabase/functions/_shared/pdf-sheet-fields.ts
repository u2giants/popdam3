/**
 * Parses licensing-sheet / tech-pack fields from OCR text. Two layouts exist:
 *   v1: same-line labels ("Designer: X", "License:", "FILES USED:") plus "Description" then value.
 *   v2: a heading, then its value on a later line, possibly with other headings between.
 * A blank field stays null: a value is never taken across another field's heading.
 */
export interface PdfSheetFields {
  layout: "v1" | "v2" | null;
  sku: string | null;
  sku_source: "filename" | "text" | null;
  description: string | null;
  files_used: string[];
  creative_designer: string | null;
  technical_designer: string | null;
  art_director: string | null;
  manager: string | null;
  retailer: string | null;
  product_type: string | null;
  product_size: string | null;
  materials: string | null;
  packaging_type: string | null;
  licensor: string | null;
  style_guide: string | null;
}

type V2Field =
  | "creative_designer"
  | "technical_designer"
  | "art_director"
  | "retailer"
  | "product_type"
  | "product_size"
  | "packaging_type"
  | "materials"
  | "licensor";

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9&/]+/g, "");

const V2_FIELD_HEADINGS: Record<string, V2Field> = {
  CREATIVEDESIGNER: "creative_designer",
  TECHNICALDESIGNER: "technical_designer",
  ARTDIRECTOR: "art_director",
  "RETAILER&ONSHELF": "retailer",
  RETAILER: "retailer",
  PRODUCTTYPE: "product_type",
  PRODUCTSTYLE: "product_type",
  PRODUCTSIZE: "product_size",
  OVERALLPRODUCTSIZE: "product_size",
  PACKAGINGTYPE: "packaging_type",
  PACKAGINGSTYLE: "packaging_type",
  "CONSTRUCTION/MATERIALS": "materials",
  LICENSE: "licensor",
  "LICENSE/LEGALLINE": "licensor",
};

const ASSET_HEADINGS = new Set(["ASSET/STYLEGUIDE", "ASSETS/STYLEGUIDE", "ASSETS", "STYLEGUIDE/ASSETS"]);

/** Headings that hold no requested value. Skipped between a field heading and its value. */
const OTHER_HEADINGS = new Set([
  "PRODUCTDESIGN",
  "PRODUCTEXAMPLEPHOTO",
  "EXAMPLEPHOTOOFTHEPRODUCTTYPE",
  "EXAMPLEOFTHEPRODUCTTYPE",
  "PACKAGINGDESIGN",
  "LEGALLINE",
  "PACKAGINGLEGALLINE",
  "PANTONEREFERENCE",
  "ADDITIONALCALLOUTS",
  "PACKAGINGSIZE",
  "DIMENSIONS",
  "PRODUCTDIMENSIONS",
  "PACKAGINGDIMENSIONS",
  "FRONTVIEW",
  "BACKVIEW",
  "SIDE",
  "FRONT",
  "BACK",
  "CONSTRUCTION",
  "UPCSTICKER",
  "POP",
]);

const isFieldHeading = (line: string) => norm(line) in V2_FIELD_HEADINGS || ASSET_HEADINGS.has(norm(line));
const isOtherHeading = (line: string) => OTHER_HEADINGS.has(norm(line)) || /^(PRODUCT|PACKAGING)\s*:$/i.test(line);

const clean = (s: string | undefined | null): string | null => {
  const v = (s ?? "").replace(/\s+/g, " ").trim().replace(/^[•·*\-\s]+/, "").trim();
  return v.length > 0 ? v : null;
};

function inline(lines: string[], label: RegExp): string | null {
  for (const line of lines) {
    const m = line.match(label);
    if (m) return clean(m[1]);
  }
  return null;
}

function splitFiles(value: string | null): string[] {
  if (!value) return [];
  return value.split(/[,;|]/).map((v) => clean(v)).filter((v): v is string => !!v && v.length >= 2);
}

const CONTINUES = /(\b(AND|WITH|FOR|OF|OR)|[,&+])$/i;
const CONTINUATION = /^(AND|WITH|&)\s+[A-Z]{2}/i;

/** First value line after a heading, plus its obvious wrapped continuation. */
function valueAfter(lines: string[], start: number, wrap: boolean, joinSingleWord = false): string | null {
  for (let i = start, seen = 0; i < lines.length && seen < 5; i++) {
    const line = lines[i];
    if (!line) continue;
    if (isFieldHeading(line)) return null;
    if (isOtherHeading(line)) continue;
    seen++;
    let value = line;
    if (wrap) {
      const next = lines[i + 1];
      if (
        next && !isFieldHeading(next) && !isOtherHeading(next) && (CONTINUES.test(value) || CONTINUATION.test(next) || (joinSingleWord && !/\s/.test(value)))
      ) {
        value = `${value} ${next}`;
      }
    }
    return clean(value);
  }
  return null;
}

const looksLikeAssetCode = (t: string) => t.length >= 4 && /\d/.test(t) && !/^[A-Z]{1,2}:/.test(t) && !/["”]/.test(t);

function assetsAfter(lines: string[], start: number): string[] {
  const found: string[] = [];
  for (let i = start; i < lines.length && i < start + 14; i++) {
    const line = lines[i];
    if (!line) continue;
    if (isFieldHeading(line)) break;
    if (isOtherHeading(line)) {
      if (found.length > 0) break;
      continue;
    }
    const stripped = line.replace(/^ASSETS?\s*:\s*/i, "");
    for (const token of splitFiles(stripped)) {
      if (looksLikeAssetCode(token)) found.push(token);
    }
  }
  return found;
}

function materialsAfter(lines: string[], start: number): string | null {
  const out: string[] = [];
  for (let i = start; i < lines.length && out.length < 10; i++) {
    const line = lines[i];
    if (!line) continue;
    if (isFieldHeading(line) || isOtherHeading(line)) break;
    out.push(line);
  }
  return clean(out.join("; "));
}

const FILENAME_SKU = /(?:^|[^A-Z0-9])([A-Z]{2,3}[A-Z0-9]{8,9})(?=[^A-Z0-9]|$)/;

/** The filename wins over OCR: sheets misread O for 0 in SKUs. */
export function skuFromFilename(filename: string): string | null {
  const m = filename.toUpperCase().match(FILENAME_SKU);
  return m && /\d/.test(m[1]) ? m[1] : null;
}

const EMPTY: Omit<PdfSheetFields, "sku" | "sku_source"> = {
  layout: null,
  description: null,
  files_used: [],
  creative_designer: null,
  technical_designer: null,
  art_director: null,
  manager: null,
  retailer: null,
  product_type: null,
  product_size: null,
  materials: null,
  packaging_type: null,
  licensor: null,
  style_guide: null,
};

export function parsePdfSheetFields(text: string, filename: string): PdfSheetFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: PdfSheetFields = { ...EMPTY, files_used: [], sku: null, sku_source: null };

  const hasV1 = lines.some((l) => /^(Designer|Manager|Style#\/SKU)\s*:/i.test(l) || /^(CORE\/STYLE GUIDE USED|FILES USED)\s*:/i.test(l));
  const hasV2 = lines.some((l) => norm(l) in V2_FIELD_HEADINGS && norm(l) !== "LICENSE");
  out.layout = hasV2 ? "v2" : hasV1 ? "v1" : null;

  let textSku: string | null = null;
  if (hasV1) {
    out.creative_designer = inline(lines, /^Designer\s*:\s*(.*)$/i);
    out.manager = inline(lines, /^Manager\s*:\s*(.*)$/i);
    out.licensor = inline(lines, /^License\s*:\s*(.*)$/i);
    out.style_guide = inline(lines, /^CORE\/STYLE GUIDE USED\s*:\s*(.*)$/i);
    out.files_used = splitFiles(inline(lines, /^FILES USED\s*:\s*(.*)$/i));
    textSku = inline(lines, /^Style#\/SKU\s*:\s*(.*)$/i) ?? inline(lines, /^STYLE#\s*:\s*(.*)$/i);
    const d = lines.findIndex((l) => /^description$/i.test(l));
    if (d >= 0) {
      const next = lines.slice(d + 1).find((l) => l.length > 0) ?? "";
      if (!/^(\S{1,2}\)?\s+)?(Artwork Approved|Revised|Date\s*:|REV\s*\d)/i.test(next)) out.description = clean(next);
    }
  }

  if (hasV2) {
    const seen = new Set<V2Field>();
    lines.forEach((line, i) => {
      const key = norm(line);
      const field = V2_FIELD_HEADINGS[key];
      if (field && !seen.has(field)) {
        seen.add(field);
        if (field === "materials") out.materials = materialsAfter(lines, i + 1);
        else if (field === "licensor") out.licensor = clean(valueAfter(lines, i + 1, false)?.replace(/^[©Ø]\s*/, ""));
        else out[field] = valueAfter(lines, i + 1, field === "product_type" || field === "packaging_type", field === "product_type");
      }
      if (ASSET_HEADINGS.has(key) && out.files_used.length === 0) out.files_used = assetsAfter(lines, i + 1);
    });
    if (!out.licensor) out.licensor = clean(lines.find((l) => /^©\s*[A-Za-z]{3}/.test(l))?.replace(/^©\s*/, ""));
    textSku = textSku ?? inline(lines, /^SKU\s*[#:]+\s*(.*)$/i);
  }

  out.files_used = [...new Set(out.files_used)];
  const fileSku = skuFromFilename(filename);
  if (fileSku) {
    out.sku = fileSku;
    out.sku_source = "filename";
  } else if (textSku) {
    out.sku = textSku;
    out.sku_source = "text";
  }
  return out;
}
