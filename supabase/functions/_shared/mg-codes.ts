/**
 * MerchGroup code resolution helpers for the ERP sync pipeline.
 *
 * The ERP API returns either:
 *   - Single-character letter/digit codes (e.g. "A", "3", "0") — legacy / already-correct format
 *   - Full text descriptions (e.g. "Stretched/Box", "Canvas", "Foil") — post-May-2025 API format
 *
 * These functions detect which format is present and normalise to single-character codes,
 * so that mg01_code / mg02_code / mg03_code in erp_items_current always hold the canonical
 * letter/digit code. The original API value is preserved in raw_mg_fields for display.
 */

/** True if val is already a single-character code (letter or digit). */
export function isMgCode(val: string | null | undefined): boolean {
  if (!val) return false;
  return val.trim().length === 1;
}

// ── MG01 ────────────────────────────────────────────────────────────────────

/** Reverse map: MG01 description (lowercase) → single-letter code */
const MG01_DESC_TO_CODE: Record<string, string> = {
  "stretched/box": "A",
  "framed": "B",
  "plaque": "C",
  "functional": "D",
  "other wall": "E",
  "block": "F",
  "box": "G",
  "photo frames": "H",
  "object": "J",
  "other tabletop": "K",
  "clocks": "M",
  "soft storage": "N",
  "hard storage": "P",
  "other storage": "R",
  "stationery org": "S",
  "desk acc": "T",
  "other workspace": "U",
  "floor coverings": "V",
  "garden": "W",
};

/**
 * Resolve an MG01 value from the API to a single-character code.
 * Returns the code if val is already a code, reverse-looks up if it's a description,
 * or returns null if it can't be resolved.
 */
export function resolveMg01Code(val: string | null | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (trimmed.length === 1) return trimmed; // already a code
  return MG01_DESC_TO_CODE[trimmed.toLowerCase()] ?? null;
}

// ── MG02 ────────────────────────────────────────────────────────────────────

/** Reverse map: mg01_code → { mg02_description_lowercase → mg02_code } */
const MG02_DESC_TO_CODE: Record<string, Record<string, string>> = {
  A: { "canvas": "A", "special material": "S", "greyboard": "G", "fabric": "F", "mdf box": "M" },
  B: { "fabric": "F", "lenticular/3d": "3", "glass": "G", "object": "J", "mirror": "M", "print": "R" },
  C: { "plain": "A", "diy": "D", "leaner": "P", "relief/3d molded": "R", "sign": "S", "plastic": "T", "lenticular": "3", "other": "9" },
  D: { "countdown calendar": "C", "hook": "H", "framed": "F", "shelf": "S", "memo board": "M" },
  E: { "dimensional": "D", "hanging": "H", "string": "S", "box": "B", "shades": "6" },
  F: { "none": "0", "glass": "G", "monogram": "M", "led": "E", "word": "W", "calendar": "C" },
  G: { "ceramic": "C", "glass": "G", "mdf": "M" },
  H: { "single": "S", "collage": "C", "infant": "F" },
  J: { "book end": "B", "candle": "C", "planter": "P", "orb": "R", "lightup led": "D", "easel": "E", "snow globe": "G", "figural": "U" },
  K: { "bank": "B", "other": "9" },
  M: { "wall clock": "W", "desktop clock": "D" },
  N: {
    "hamper": "H", "bin (shelftop)": "B", "chest": "C",
    "basket (floor)": "K", "basket (carrying)": "H", // "basket (carrying)" maps to H (hamper) per schema proximity
    "tower/stand": "T", "cube-collapsible": "U",
  },
  P: {
    "faux shaped box": "B", "chest": "C",
    "jewelry/music box": "J", "jewellery/music box": "J", // spelling variant
    "lift-off": "F", "kitchen": "K", "ottoman non-collapsible": "N",
  },
  R: { "tray/dish": "T" },
  S: { "single item holder": "H", "pencil cup": "P", "set": "S", "multi section": "M", "phone stand": "N", "headphone stand": "E" },
  T: { "perpetual calendar": "C", "deskmat": "M", "paperweight": "W", "sticky note holder": "S", "memo pad": "P" },
  U: { "monitor stand": "M", "lapdesk": "P" },
  V: { "door": "D", "rug": "R", "kitchen": "K" },
  W: { "decor": "D", "tool": "T", "accessory": "A" },
};

/**
 * Resolve an MG02 value from the API to a single-character code.
 * Requires a resolved mg01Code for context (same description can mean different things
 * under different MG01 categories).
 */
export function resolveMg02Code(mg01Code: string | null | undefined, val: string | null | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (trimmed.length === 1) return trimmed; // already a code
  if (!mg01Code) return null; // can't resolve without context
  const submap = MG02_DESC_TO_CODE[mg01Code];
  if (!submap) return null;
  return submap[trimmed.toLowerCase()] ?? null;
}

// ── MG03 ────────────────────────────────────────────────────────────────────

/** Reverse map: "mg01:mg02" → { mg03_description_lowercase → mg03_code } */
const MG03_DESC_TO_CODE: Record<string, Record<string, string>> = {
  "A:A": {
    "none": "0", "foil": "1", "shaped": "2", "other embellishment": "8", "other": "9",
    "embroidery": "B", "diy": "D", "led": "E", "staggered": "G", "hi-gloss": "H",
    "glitter/sequins/rhinest": "Q", "handpaint": "P", "physical attachment": "Y",
    "gel/other coat": "W", "gel coat": "W",
  },
  "A:S": { "specialty fabric": "N", "metallic": "M", "suede/pu leather": "U", "suede/pu leather/pvc": "U" },
  "A:G": { "led": "E" },
  "A:F": { "cross-stitch": "C", "linen/cotton": "L" },
  "A:M": { "none": "0", "diecut/attachment": "D", "diecut/attach/raised": "D", "led": "E", "glitter/sequins/rhinest": "Q" },
  "B:F": { "cross-stitch": "C", "linen/cotton": "L", "specialty fabric": "N" },
  "B:3": { "greyboard frame": "G", "mdf frame": "M", "slits / slats": "S", "slits/slats": "S" },
  "B:G": {
    "led infinity": "D", "led backlit": "E",
    "printed": "F", "printed flat": "F", // "printed flat" treated as "printed"
    "sbox w glit/foil": "Q", "sbox w attachment": "R", "glass sandwich": "W", "sbox printed": "X",
  },
  "B:J": { "bank": "B", "fabric/jersey": "F", "polyresin": "P", "yarn/string": "Y" },
  "B:M": { "none": "0", "diecut mdf": "C", "mdf frame": "D", "metal frame": "M" },
  "B:R": {
    "none": "0", "foil": "1", "collage/paper": "C", "diecut/attachment": "D", "led": "E",
    "fabric": "F", "handpaint": "H", "mdf gel coat": "M", "natural frame": "N", "matting": "P",
    "glitter/sequins/rhinest": "Q", "specialty paper": "S", "metallic/holofoil": "T",
    "shaped/molded frame": "Y",
  },
  "C:A": { "none": "0", "attachment": "A", "diecut": "C", "holofoil": "H", "foil": "Q", "specialty paper": "S" },
  "C:D": { "none": "0" },
  "C:P": { "none": "0", "diecut": "C", "led": "E", "glow-in-the-dark": "G", "glitter": "Q" },
  "C:R": { "foam/felt": "F", "mdf": "M" },
  "C:S": { "door hanger lentic": "3", "door hanger mdf": "D", "glass": "G", "metal sign": "M", "wall hanger mdf": "W" },
  "C:T": { "led": "D", "suncatcher": "S" },
  "C:3": { "on mdf": "M", "none": "0" },
  "C:9": { "cork": "C", "natural": "N" },
  "D:C": { "none": "0" },
  "D:H": { "single mdf": "M", "multi mdf": "U" },
  "D:F": { "none": "0", "cork": "C", "dry-erase": "D", "pinboard": "P", "letterboard": "T" },
  "D:S": { "mdf": "M", "natural": "N", "plastic": "P", "woven": "W" },
  "D:M": { "dry-erase/magnetic": "D" },
  "E:D": { "natural": "N", "plastic": "P", "paper rope": "R" },
  "E:H": { "banner": "B", "pennant": "P", "tapestry": "T", "scroll": "S" },
  "E:S": { "banner/bunting/pennant": "B", "clip/photo holder": "C", "string light led": "S" },
  "E:B": { "led": "D" },
  "E:6": { "paper": "P" },
  "F:0": { "mdf": "M" },
  "F:G": { "none": "0" },
  "F:M": { "greyboard": "G", "mdf": "M", "natural": "N", "plush/fabric": "P" },
  "F:E": { "mdf": "M" },
  "F:W": { "mdf": "M" },
  "F:C": { "mdf": "M" },
  "G:C": { "none": "0" },
  "G:G": { "jewelry": "J" },
  "G:M": { "none": "0", "foil": "1", "led": "E", "raised/diecut": "R", "glitter": "Q", "paint stroke": "S" },
  "H:S": { "fabric": "F", "diecut/attachment": "R", "diecut/attach/raised": "R" },
  "H:C": { "fabric": "F", "diecut/attachment": "R", "diecut/attach/raised": "R" },
  "H:F": { "12 month collage": "2", "clay/ink": "C" },
  "J:B": { "ceramic/polyresin": "C" },
  "J:C": { "holder/polyresin": "R" },
  "J:P": { "ceramic": "C" },
  "J:R": { "terracotta": "K" },
  "J:D": { "etched acrylic": "E", "glass": "G", "plastic": "P" },
  "J:E": { "dry-erase": "D" },
  "J:G": { "none": "0" },
  "J:U": { "woven": "W" },
  "K:B": { "ceramic": "C", "mdf": "M" },
  "K:9": { "mug": "M" },
  "M:W": { "basic plastic": "B", "diecut mdf": "C", "round mdf": "M", "countdown mdf": "N", "metal": "S" },
  "M:D": { "vintage alarm": "A", "metal": "S" },
  "N:H": {
    "oxford+pe coat": "2", "felt": "F", "polymesh": "M", "poly/linen+eva": "N",
    "pu/plastic+eva": "P", "oxford+greyb": "X", "nonwoven+greyb": "W",
  },
  "N:B": { "oxford": "X" },
  "N:C": { "oxford": "X" },
  "N:K": { "paper seagrass": "P", "rope": "R" },
  "N:T": { "steel w nonwoven": "S", "steel w woven": "T" },
  "N:U": { "nonwoven": "N", "ottoman/oxford": "T" },
  "P:B": { "greyboard book": "G", "mdf book": "M", "greyboard suitcase": "U" },
  "P:C": { "greyboard": "G", "emb greyboard": "Q" },
  "P:J": { "greyboard": "G", "glass": "S" },
  "P:F": { "emb greyboard": "Q" },
  "P:K": { "plastic": "P" },
  "P:N": { "mdf": "M" },
  "R:T": { "acrylic": "A", "ceramic/polyresin": "C", "glass": "G", "wood": "W" },
  "S:H": { "paper items": "P", "fabric": "F" },
  "S:P": { "acrylic": "A", "ceramic/polyresin": "C", "greyboard": "G", "mdf": "M" },
  "S:S": { "mdf": "M" },
  "S:M": { "acrylic": "A", "greyboard": "G", "metal": "S" },
  "S:N": { "mdf": "M", "plastic": "P" },
  "S:E": { "metal": "S" },
  "T:C": { "mdf": "M" },
  "T:M": { "rubber": "R" },
  "T:W": { "glass": "G" },
  "T:S": { "ceramic/polyresin": "C" },
  "T:P": { "ceramic/polyresin": "C" },
  "U:M": { "none": "0" },
  "U:P": { "none": "0" },
  "V:D": {
    "coir w/ plain print": "C", "coir w/ emboss": "D", "coir diecut": "E",
    "rubber w/ plain print": "R", "tpe w/ print": "U", "rubber w/ embossed": "Q", "tpe w/ diecut": "T",
  },
  "V:R": { "rabbit fur rectang": "A", "rabbit fur diecut": "R", "throw, loop": "T" },
  "V:K": { "pvc foam": "P" },
  "W:D": { "birdhouse": "H", "plastic": "P", "stepping stone": "S", "planter": "T", "oxford": "X" },
  "W:T": { "metal tool set": "8", "thermometer": "T", "watering can": "W" },
  "W:A": { "glove": "G", "accessory set": "8", "tool&acc set": "8" },
};

/**
 * Resolve an MG03 value from the API to a single-character (or single-digit) code.
 * Requires resolved mg01Code and mg02Code for context.
 */
export function resolveMg03Code(
  mg01Code: string | null | undefined,
  mg02Code: string | null | undefined,
  val: string | null | undefined,
): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (trimmed.length === 1) return trimmed; // already a code
  if (!mg01Code || !mg02Code) return null;
  const submap = MG03_DESC_TO_CODE[`${mg01Code}:${mg02Code}`];
  if (!submap) return null;
  return submap[trimmed.toLowerCase()] ?? null;
}
