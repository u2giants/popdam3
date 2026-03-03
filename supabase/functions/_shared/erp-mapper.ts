/**
 * ERP Mapper — Deterministic MG code → product attributes mapping.
 *
 * Mapping precedence:
 * 1. ERP direct fields (mgCategory populated) → confidence 1.0
 * 2. SKU deterministic rules (MG01 → category) → confidence 0.95
 * 3. AI fallback (for legacy items) → variable confidence
 */

// MG01 → Product Category mapping (from spreadsheet)
const MG01_TO_CATEGORY: Record<string, string> = {
  A: "Wall",
  B: "Wall",
  C: "Wall",
  D: "Wall",
  E: "Wall",
  F: "Tabletop",
  G: "Tabletop",
  H: "Tabletop",
  J: "Tabletop",
  K: "Tabletop",
  M: "Clock",
  N: "Storage",
  P: "Storage",
  Q: "Storage",
  R: "Storage",
  S: "Workspace",
  T: "Workspace",
  U: "Workspace",
  V: "Floor",
  W: "Garden",
};

// Valid product categories
export const VALID_CATEGORIES = [
  "Wall",
  "Tabletop",
  "Clock",
  "Storage",
  "Workspace",
  "Floor",
  "Garden",
] as const;

export type ProductCategory = typeof VALID_CATEGORIES[number];

export function isValidCategory(val: string): val is ProductCategory {
  return VALID_CATEGORIES.includes(val as ProductCategory);
}

// MG01 → Product Type (from spreadsheet)
const MG01_TO_TYPE: Record<string, string> = {
  A: "Stretched/Box",
  B: "Framed",
  C: "Plaque",
  D: "Functional",
  E: "Other Wall",
  F: "Block",
  G: "Box",
  H: "Photo Frames",
  J: "Object",
  K: "Other Tabletop",
  M: "Clocks",
  N: "Soft Storage",
  P: "Hard Storage",
  R: "Other Storage",
  S: "Stationery Org",
  T: "Desk Acc",
  U: "Other Workspace",
  V: "Floor Coverings",
  W: "Garden",
};

export interface ErpItemInput {
  external_id: string;
  style_number: string | null;
  item_description: string | null;
  mg_category: string | null;
  mg01_code: string | null;
  mg02_code: string | null;
  mg03_code: string | null;
  size_code: string | null;
  licensor_code: string | null;
  property_code: string | null;
  division_code: string | null;
  raw_mg_fields?: Record<string, unknown>;
}

export interface ResolvedAttributes {
  product_category: string | null;
  product_type: string | null;
  mg01_code: string | null;
  mg02_code: string | null;
  mg03_code: string | null;
  size_code: string | null;
  licensor_code: string | null;
  property_code: string | null;
  division_code: string | null;
  classification_source: "erp" | "rule" | "ai" | "none";
  confidence: number;
  needs_ai: boolean;
}

/**
 * Resolve product attributes for an ERP item using deterministic rules.
 * Returns needs_ai=true if mgCategory is missing AND MG01 code is also missing/unrecognized.
 */
export function resolveAttributes(item: ErpItemInput): ResolvedAttributes {
  const base: Omit<ResolvedAttributes, "product_category" | "classification_source" | "confidence" | "needs_ai" | "product_type"> = {
    mg01_code: item.mg01_code,
    mg02_code: item.mg02_code,
    mg03_code: item.mg03_code,
    size_code: item.size_code,
    licensor_code: item.licensor_code,
    property_code: item.property_code,
    division_code: item.division_code,
  };

  // 1. ERP direct: mgCategory is populated
  if (item.mg_category && isValidCategory(item.mg_category)) {
    return {
      ...base,
      product_category: item.mg_category,
      product_type: item.mg01_code ? MG01_TO_TYPE[item.mg01_code.toUpperCase()] || null : null,
      classification_source: "erp",
      confidence: 1.0,
      needs_ai: false,
    };
  }

  // 2. SKU deterministic: use MG01 code to derive category
  if (item.mg01_code) {
    const cat = MG01_TO_CATEGORY[item.mg01_code.toUpperCase()];
    if (cat) {
      return {
        ...base,
        product_category: cat,
        product_type: MG01_TO_TYPE[item.mg01_code.toUpperCase()] || null,
        classification_source: "rule",
        confidence: 0.95,
        needs_ai: false,
      };
    }
  }

  // 3. Try extracting MG01 from style_number
  if (item.style_number && item.style_number.length >= 1) {
    const firstChar = item.style_number[0].toUpperCase();
    const cat = MG01_TO_CATEGORY[firstChar];
    if (cat) {
      return {
        ...base,
        mg01_code: firstChar,
        product_category: cat,
        product_type: MG01_TO_TYPE[firstChar] || null,
        classification_source: "rule",
        confidence: 0.85,
        needs_ai: false,
      };
    }
  }

  // 4. Cannot resolve — needs AI
  return {
    ...base,
    product_category: null,
    product_type: null,
    classification_source: "none",
    confidence: 0,
    needs_ai: true,
  };
}
