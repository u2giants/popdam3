import { getLicensorLookup, getPropertyLookup } from "./coldlion.ts";

// ── MG01: Product Type ──────────────────────────────────────────
const MG01: Record<string, string> = {
  A: "Stretched/Box", B: "Framed", C: "Plaque",
  D: "Functional", E: "Other Wall", F: "Block",
  G: "Box", H: "Photo Frames", J: "Object",
  K: "Other Tabletop", M: "Clocks", N: "Soft Storage",
  P: "Hard Storage", R: "Other Storage", S: "Stationery Org",
  T: "Desk Acc", U: "Other Workspace", V: "Floor Coverings",
  W: "Garden",
};

// ── MG02: Product Sub-Type ──────────────────────────────────────
const MG02: Record<string, string> = {
  A: "Canvas/Plain", B: "Fabric/Bank", C: "Chest/Ceramic/Calendar",
  D: "Door/DIY/Dimensional", E: "LED", F: "Floating Frame/Framed",
  G: "Glass/Greyboard", H: "Hamper/Hook/Hanging", J: "Object/Jewelry",
  K: "Basket/Kitchen", M: "MDF/Mirror/Multi", N: "Soft/Phone Stand",
  P: "Leaner/Lapdesk/Pencil Cup", R: "Print/Relief/Rug/Tray",
  S: "Sign/Special Material/Shelf", T: "Plastic/Tower/Tool",
  U: "Cube/Other Workspace", W: "Wall Clock/Word/Garden",
  X: "Shadowbox", "3": "Lenticular/3D", "9": "Other",
};

// ── MG03: Product Sub-Sub-Type ──────────────────────────────────
const MG03: Record<string, string> = {
  "0": "None", "1": "Foil", "2": "Shaped", "8": "Other Embellishment",
  "9": "Other", A: "Acrylic/Attachment", B: "Embroidery/Banner/Basic",
  C: "Diecut/Coir Plain/Ceramic", D: "DIY/LED/Coir Emboss/Dry-Erase",
  E: "LED/Coir Diecut", F: "Felt/Fabric/Printed Flat/Foam",
  G: "Staggered/Greyboard", H: "Hi-Gloss/Holofoil/Handpaint",
  I: "Denim", J: "Fabric/Jersey", K: "Sparkle", L: "Linen/Cotton",
  M: "Metallic/MDF/Round MDF", N: "Specialty Fabric/Natural/Nonwoven",
  P: "Handpaint/Matting/Plastic/PVC", Q: "Glitter/Sequins/Rhinestones",
  R: "Specialty Fabric w Attachment/Rope/Rubber",
  S: "Satin/Specialty Paper/Metal/Steel", T: "Metallic/Holofoil/TPE/Tapestry",
  U: "Suede/PU Leather/Suitcase", W: "Gel Coat/Wall Hanger/Woven",
  X: "Oxford/Shadowbox Printed", Y: "Physical Attachment/Shaped Frame",
};

// ── Size tables by MG01 group ───────────────────────────────────
const WALL_MG01 = new Set(["A","B","C","D","E"]);
const TABLETOP_MG01 = new Set(["F","G","H","J","K"]);
const CLOCK_MG01 = new Set(["M"]);
const STORAGE_MG01 = new Set(["N","P","Q","R"]);
const WORKSPACE_MG01 = new Set(["S","T","U"]);
const FLOOR_MG01 = new Set(["V"]);
const GARDEN_MG01 = new Set(["W"]);

const SIZE_WALL: Record<string,string> = {
  "13":'10x13"',"14":'11x14"',"17":'11x17"',"18":'18x18"',
  "21":'12x12"',"22":'25x25"',"23":'23x23"',"24":'12x24"',
  "26":'12x16"',"27":'23x31"',"28":'12x18"',"29":'24x30"',
  "30":'10x30"',"33":'13x13"',"36":'24x36"',"37":'13x17"',
  "42":'14x20"',"44":'14x14"',"46":'4x6"',"48":'10x48"',
  "62":'16x20"',"63":'6x36"',"64":'16x24"',"66":'16x16"',
  "70":'7x10.25"',"77":'7x7"',"80":'8x10"',"82":'8x12"',
  "84":'18x24"',"88":'8x8"',"93":'13x19"',"94":'9x14"',
  "96":'9x36"',"T0":'20x20"',"2F":'24x24"',"0F":'20x24"',
  "20":'20x30"',"34":'30x40"',"4A":'20x40"',"4G":'16x40"',
  "8R":'18x28"',"1T":'20x10"',"2A":'14x28"',"2H":'8x20"',
  "2U":'24x32"',"2M":'8x24"',"3R":'12x36"',"9A":'9x24"',
  "TV":'12x30"',"TF":'12x15"',"SF":'16x14"',"6X":'6x6"',
  "5K":'5x11"',"02":'10x24"',"07":'10x27"',"10":'10x10"',
  "12":'10x12"',"15":'15x30"',"16":'16x18"',"38":'26x38"',
  "40":'40x40"',"50":'20x50"',"60":'48x60"',"61":'20x60"',
  "T3":'36x72"',"T4":'4x10"',"T5":'15x15"',"V4":'4x20"',
  "Z1":'10x48"',"Z8":'16x28"',"4F":'4.5x4.5"',
  "M2":'Multipack 20x28"',"M3":'Multipack 30x20"',"M4":'Multipack 14x20"',
  "1C":'10" Height',"1J":'11" Height',"3J":'13" Height',"5E":'54x80"',
  "C1":'8x51"',"C2":'22x14"',"E5":'5x15"',"G4":'18x48"',
  "J7":'20x27"',"J8":'18" Height',"J9":'8x29"',"58":'5x8"',
  "78":'7x8.5"',"87":'8x27"',"4V":'41x50"',
};

const SIZE_TABLETOP: Record<string,string> = {
  "03":'3x3"',"04":'5x5"',"06":'6" High',"08":'8x3"',
  "09":'9x9"',"10":'10" High',"12":'12x12"',"16":'16x16"',
  "20":'20x20"',"48":'10x48"',"6T":'4x6"',"B6":'6x6"',
  "E5":'12x5"',"H2":'12" Height',"H6":'16" Height',"H8":'8" Height',
  "P1":'10x10"',
};

const SIZE_STORAGE: Record<string,string> = {
  "08":'8x4"',"09":'14x9"',"10":'10x10"',"11":'19x14"',
  "12":'10x12"',"13":'13x13"',"14":'11x14"',"15":'15x13"',
  "16":'16x11"',"17":'17x12"',"18":'18x13"',"19":'19x7"',
  "20":'20x24"',"22":'25x25"',"24":'18x24"',"26":'16x26"',
  "28":'28x18"',"30":'12x30"',"50":'12x50"',"64":'19x64"',
  "68":'6x8"',"73":'17x17"',"82":'8x12"',"92":'9x12"',
  "1T":'20x10"',"2Y":'21x21"',"4T":'4x4"',"6T":'16x6"',
  "7T":'7x7"',"8A":'18x32"',"A1":'11x9"',"A4":'14x14"',
  "A5":'5x4"',"C3":'10x15"',"C4":'16x20"',"C8":'18x8"',
  "H6":'16x16"',"J1":'7x10"',"J2":'20x14"',"J4":'24x14"',
};

const SIZE_WORKSPACE: Record<string,string> = {
  "00":"Standard","03":'3x3"',"05":'5x11"',"07":'3x7"',
  "08":'8x4"',"09":'9x8"',"10":'10x12"',"12":'12x6"',
  "14":'14x10"',"18":'6x18"',"21":'21x13"',"24":'24x10"',
  "25":'7x25"',"26":'26x6"',"30":'6x30"',"3A":'3x4"',
  "6X":'6x6"',"A8":'10x8"',"H1":'10"',"H3":'13" Height',
  "H7":'7" Height',"H9":'9" Height',
};

const SIZE_CLOCK: Record<string,string> = {
  "03":'3x3"',"06":'4x6"',"14":'8x14"',
  "D1":'10" Diameter',"D2":'12" Diameter',
  "D4":'14" Diameter',"D6":'16" Diameter',
};

const SIZE_FLOOR: Record<string,string> = {
  "12":'30x12"',"26":'24x26"',"30":'34x30"',"36":'24x36"',
  "54":'40x54"',"8R":'18x28"',"S2":'16x32"',"SE":'16x40"',
};

const SIZE_GARDEN: Record<string,string> = {
  "12":'12x18"',"48":'10x48"',
};

export interface ParsedSku {
  sku: string;
  mg01_code: string; mg01_name: string;
  mg02_code: string; mg02_name: string;
  mg03_code: string; mg03_name: string;
  size_code: string; size_name: string;
  licensor_code: string; licensor_name: string | null;
  property_code: string; property_name: string | null;
  sku_sequence: string;
  product_category: string;
  division_code: string; division_name: string;
  is_licensed: boolean;
}

export async function parseSku(filename: string): Promise<ParsedSku | null> {
  const base = filename.replace(/\.[^.]+$/, "")
    .split(/[\s_]/)[0].toUpperCase();

  if (base.length < 6) return null;

  const mg01_code = base[0];
  const mg02_code = base[1];
  const mg03_code = base[2];
  const remainder = base.slice(3);

  const m = remainder.match(/^(\d+[A-Z]?)([A-Z]{2})([A-Z]{2,4})(\d{2}\w?)$/);
  if (!m) return null;

  const [, size_code, licensor_code, property_code, sku_sequence] = m;

  // Resolve MG names
  const mg01_name = MG01[mg01_code] ?? mg01_code;
  const mg02_name = MG02[mg02_code] ?? mg02_code;
  const mg03_name = MG03[mg03_code] ?? mg03_code;

  // Resolve size
  let size_name = size_code;
  if (WALL_MG01.has(mg01_code)) size_name = SIZE_WALL[size_code] ?? size_code;
  else if (TABLETOP_MG01.has(mg01_code)) size_name = SIZE_TABLETOP[size_code] ?? size_code;
  else if (CLOCK_MG01.has(mg01_code)) size_name = SIZE_CLOCK[size_code] ?? size_code;
  else if (STORAGE_MG01.has(mg01_code)) size_name = SIZE_STORAGE[size_code] ?? size_code;
  else if (WORKSPACE_MG01.has(mg01_code)) size_name = SIZE_WORKSPACE[size_code] ?? size_code;
  else if (FLOOR_MG01.has(mg01_code)) size_name = SIZE_FLOOR[size_code] ?? size_code;
  else if (GARDEN_MG01.has(mg01_code)) size_name = SIZE_GARDEN[size_code] ?? size_code;

  // Fetch licensor/theme lookup from ColdLion
  const { licensors, themes } = await getLicensorLookup();
  const is_licensed = licensor_code in licensors;
  // Return null (not code) when ColdLion has no mapping — path-derived names are preferred
  const licensor_name = licensors[licensor_code]
    ?? themes[licensor_code]
    ?? null;

  // Fetch property name from ColdLion MG06
  const division_for_lookup = is_licensed ? "CW001" : "EH001";
  const properties = await getPropertyLookup(division_for_lookup);
  const property_name = properties[property_code] ?? null;

  // Product category
  let product_category = "Other";
  if (WALL_MG01.has(mg01_code)) product_category = "Wall";
  else if (TABLETOP_MG01.has(mg01_code)) product_category = "Tabletop";
  else if (CLOCK_MG01.has(mg01_code)) product_category = "Clock";
  else if (STORAGE_MG01.has(mg01_code)) product_category = "Storage";
  else if (WORKSPACE_MG01.has(mg01_code)) product_category = "Workspace";
  else if (FLOOR_MG01.has(mg01_code)) product_category = "Floor";
  else if (GARDEN_MG01.has(mg01_code)) product_category = "Garden";

  // Division
  let division_code = "EH001";
  let division_name = "Spruce Gen";
  if (is_licensed) {
    const isCW = WALL_MG01.has(mg01_code) ||
                 TABLETOP_MG01.has(mg01_code) ||
                 CLOCK_MG01.has(mg01_code);
    const isSP = STORAGE_MG01.has(mg01_code) ||
                 WORKSPACE_MG01.has(mg01_code) ||
                 FLOOR_MG01.has(mg01_code) ||
                 GARDEN_MG01.has(mg01_code);
    if (isCW) { division_code = "CW001"; division_name = "POP"; }
    else if (isSP) { division_code = "SP001"; division_name = "Spruce Lic"; }
  }

  return {
    sku: base,
    mg01_code, mg01_name,
    mg02_code, mg02_name,
    mg03_code, mg03_name,
    size_code, size_name,
    licensor_code, licensor_name,
    property_code, property_name,
    sku_sequence,
    product_category,
    division_code, division_name,
    is_licensed,
  };
}
