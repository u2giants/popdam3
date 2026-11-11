/**
 * Suggested ColdLion Item Description for a buy-sheet assortment (one prepack
 * of a pack's styles). Proposed rule (shared-db business rules → Burlington HFC
 * buy sheet): licensor labels, then the shared product type, then size;
 * abbreviated only to fit ColdLion's 100-character description limit. It is a
 * suggestion for the salesperson to copy; JamieLynn still creates the SKU.
 */
export type AssortmentStyle = {
  sku: string;
  /** Burlington's short description on the sheet, e.g. "11X14 GEL SONIC". */
  sheetDescription: string | null;
  /** Item Master description and licensor, when the style is linked. */
  itemDescription?: string | null;
  licensor?: string | null;
};

export const COLDLION_DESCRIPTION_LIMIT = 100;

const PRODUCTS: Array<[RegExp, string]> = [
  [/3d\s*lenticular|3d\s*frm/i, "Framed 3D Lenticular"],
  [/vacuum|molded|mold\b/i, "Molded Shadowbox"],
  [/printed glass shadowbox|glass shadowbox|\bug\b/i, "Printed Glass Shadowbox"],
  [/printed glass|\bgls\b/i, "Printed Glass"],
  [/stagger/i, "Staggered Canvas"],
  [/long canvas|8x51/i, "Long Canvas"],
  [/canvas|\bcvs\b|\bcnvs\b/i, "Canvas"],
];

function licensorLabel(style: AssortmentStyle): string {
  const lic = (style.licensor ?? "").trim().toUpperCase();
  const text = `${style.itemDescription ?? ""} ${style.sheetDescription ?? ""}`;
  if (!lic) return "Generic";
  if (lic.startsWith("WARNER")) return /\bdc\b|batman|justice|superman|wonder woman/i.test(text) ? "DC" : "WB";
  if (lic.startsWith("VIACOM")) return "Paramount";
  if (lic === "SEGA" || lic === "DC") return lic;
  return lic.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function product(style: AssortmentStyle): string | null {
  const text = `${style.itemDescription ?? ""} ${style.sheetDescription ?? ""}`;
  return PRODUCTS.find(([re]) => re.test(text))?.[1] ?? null;
}

function size(style: AssortmentStyle): string | null {
  const m = (style.sheetDescription ?? style.itemDescription ?? "").match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  return m ? `${m[1]}x${m[2]}` : null;
}

function mostCommon(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Drop vowels inside words (keeping each word's first letter) until it fits. */
export function abbreviate(text: string, limit = COLDLION_DESCRIPTION_LIMIT): string {
  if (text.length <= limit) return text;
  const short = text.replace(/\b([A-Za-z])([A-Za-z]+)/g, (_, first: string, rest: string) => first + rest.replace(/[aeiou]/gi, ""));
  return short.length <= limit ? short : short.slice(0, limit);
}

export function suggestAssortmentDescription(styles: AssortmentStyle[]): string {
  const names = unique(styles.map(licensorLabel));
  const generic = names.includes("Generic") && names.length > 1;
  const named = names.filter((n) => n !== "Generic");
  const who = named.length === 0 ? "Generic" : named.join(", ") + (generic ? " and Generic" : "");
  const products = unique(styles.map(product).filter((p): p is string => !!p));
  // "Printed Glass Shadowbox" and "Printed Glass" in one pack read as "Printed Glass".
  const merged = products.filter((p) => !products.some((q) => q !== p && p.includes(q)));
  const what = merged.length === 1 ? merged[0] : merged.length > 1 ? `Asst ${merged.join("/")}` : "Asst";
  const dims = mostCommon(styles.map(size));
  return abbreviate([who, what, dims ? `${dims}"` : null].filter(Boolean).join(" "));
}
