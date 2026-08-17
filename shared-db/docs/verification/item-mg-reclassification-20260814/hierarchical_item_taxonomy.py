"""Parse item descriptions and classify historical product types through the new MG hierarchy.

The stored MG values are evidence only for rows created on or after 2025-05-14.
Historical stored MG values are copied to the audit output for comparison but are never
used to choose a proposed value.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

import pandas as pd

from product_type_dictionary import candidate_wording, classify_semantic_signature, normalize as semantic_normalize, unusable_reason


CUTOFF = pd.Timestamp("2025-05-14")
MG01_FAMILY_CODES = {
    "Stretched or Box": "A", "Framed": "B", "Plaque": "C", "Functional Wall": "D",
    "Other Wall": "E", "Block": "F", "Box": "G", "Photo Frames": "H", "Object": "J",
    "Other Tabletop": "K", "Clocks": "M", "Soft Storage": "N", "Hard Storage": "P",
    "Other Storage": "R", "Stationery Organization": "S", "Desk Accessories": "T",
    "Other Workspace": "U", "Floor Coverings": "V", "Garden": "W",
}
DIMENSION = re.compile(
    r"(?<![A-Za-z0-9])\d+(?:\.\d+)?\s*(?:in(?:ches?)?|[\"”″])?\s*[x×]\s*"
    r"\d+(?:\.\d+)?(?:\s*(?:in(?:ches?)?|[\"”″]))?"
    r"(?:\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|cm|in(?:ches?)?|[\"”″])?\s*[dDhH]?)?",
    re.I,
)

# Longest and most specific phrases come first. These are physical products, not artwork.
# Variants on the same line deliberately resolve to one merchant-facing product type.
PRODUCT_RULES: tuple[tuple[str, str], ...] = (
    ("Paint-Your-Own Canvas Set", r"\b(?:diy|pbn|paint by numbers?|paint your own)\b.{0,35}\bcanvas\b|\bcanvas\b.{0,35}\b(?:diy|pbn|paint pots?|brush)\b"),
    ("Printed Glass Shadowbox", r"\b(?:printed )?glass shadow ?box\b"),
    ("Glass Shadowbox", r"\bglass shadow ?box\b"),
    ("Die-Cut MDF Photo Frame", r"\b(?:die[ -]?cut|shaped)\b.{0,20}\bmdf\b.{0,20}\b(?:photo|picture|grad) frame\b|\bmdf\b.{0,20}\b(?:photo|picture) frame\b"),
    ("Floater-Frame Canvas", r"\b(?:floater|floating|float) frame(?:d)?\b.{0,20}\bcanvas\b|\bcanvas\b.{0,20}\b(?:floater|floating) frame\b"),
    ("Framed MDF Print", r"\bframed\b.{0,12}\bmdf\b.{0,12}\b(?:print|art)\b"),
    ("Framed Art Under Glass", r"\bframed art under glass\b"),
    ("Stained Glass Art", r"\bstained glass\b"),
    ("LED Infinity Art", r"\bled infinity (?:art|mirror)\b"),
    ("Printed Glass Art", r"\bprinted glass(?: under (?:die[ -]?cut )?tin)?\b"),
    ("Molded Shadowbox", r"\bmolded shadow ?box\b"),
    ("Molded Foam Art", r"\bmolded foam(?: wall)? art\b|\bmolded foam\b"),
    ("Floating-Frame Paper Print", r"\b(?:floating|floater) frame(?:d)?\b.{0,25}\b(?:paper|ppr) pr(?:i)?nt\b"),
    ("3D Lenticular Art", r"\b(?:framed )?3d lenticular\b|\blenticular (?:art|print)\b"),
    ("Canvas Tapestry", r"\bcanvas tapestry\b|\btapestry\b.{0,15}\bcanvas\b"),
    ("Foil Canvas", r"\bcanvas\b.{0,25}\b(?:holo ?foil|foil|gold leaf)\b|\b(?:holo ?foil|foil)\b.{0,25}\bcanvas\b"),
    ("High-Gloss Canvas", r"\b(?:high|hi)[ -]?gloss\b.{0,25}\bcanvas\b|\bcanvas\b.{0,25}\b(?:high|hi)[ -]?gloss\b"),
    ("LED Canvas", r"\bled\b.{0,20}\bcanvas\b|\bcanvas\b.{0,20}\bled\b"),
    ("Glitter Canvas", r"\bcanvas\b.{0,25}\b(?:glitter|sequin|rhinestone|diamond dust)\b|\b(?:glitter|sequin|rhinestone)\b.{0,25}\bcanvas\b"),
    ("Hand-Painted Canvas", r"\bcanvas\b.{0,25}\bhand[ -]?paint\b|\bhand[ -]?paint\b.{0,25}\bcanvas\b"),
    ("Gel-Coated Canvas", r"\bcanvas\b.{0,25}\b(?:gel|coat(?:ed|ing)?)\b|\bgel coat(?:ed)?\b.{0,25}\bcanvas\b"),
    ("Embroidered Canvas", r"\bcanvas\b.{0,25}\b(?:embroidery|embroidered|chenille|applique)\b"),
    ("Distressed Canvas", r"\bdistressed canvas\b"),
    ("Printed Canvas", r"\b(?:printed |plain |distressed |metallic |high gloss |led )?canvas\b"),
    ("Fabric Pin Board", r"\bfabric pin ?board\b"),
    ("Fabric Bow Wall Art", r"\bfabric bow wall art\b"),
    ("Plush Wall Art", r"\bplush wall art\b"),
    ("Yarn Wall Art", r"\byarn (?:wall )?art\b"),
    ("Embroidered Fabric Wall Art", r"\b(?:wool |fabric )?.{0,15}\bembroidered hanging wall art\b"),
    ("Magnet Board", r"\bmagnet(?:ic)? board\b"),
    ("Memo Board", r"\bmemo board\b"),
    ("Letter Board", r"\bletter board\b"),
    ("Dry-Erase Board", r"\bdry[ -]?erase (?:easel|board)\b"),
    ("Cork Board", r"\b(?:die[ -]?cut |framed )?cork board\b"),
    ("Metal Sign", r"\bmetal sign\b"),
    ("Tin Sign", r"\btin sign\b"),
    ("Wall Stickers", r"\bwall (?:stickers?|decals?)\b"),
    ("MDF Wall Plaque", r"\b(?:die[ -]?cut )?mdf (?:wall )?plaque\b|\bprinted diecut mdf wall\b"),
    ("Wood Wall Plaque", r"\b(?:polygon )?.{0,15}\bwood plaque\b"),
    ("MDF Box Art", r"\bmdf (?:comic cover )?box(?:ed)?(?: art)?\b|\bboxed mdf\b"),
    ("Wood Letter", r"\b(?:wood|mdf) letter\b"),
    ("Hanging Poster", r"\bhanging poster\b"),
    ("Molded Wall Clock", r"\b(?:pp|polypropylene)?\s*molded wall clock\b|\bpp wall clock\b"),
    ("Wall Clock", r"\bwall clock\b"),
    ("Lap Desk", r"\b(?:tech )?lap ?desk\b"),
    ("Desk Mat", r"\bdesk mat\b"),
    ("Desk Organizer", r"\bdesk organi[sz]er\b"),
    ("Writing Desk", r"\b(?:mdf )?writing desk\b"),
    ("Tablet Stand", r"\b(?:desktop )?tablet stand\b"),
    ("Desktop Cube", r"\b(?:fabric )?desktop cube\b"),
    ("Stationery Organizer", r"\b(?:plastic )?station(?:e|a)ry organi[sz]ers?\b"),
    ("Nonwoven Toy Chest with Playmat", r"\b(?:nonwoven|non woven).{0,30}\btoy chest\b.{0,20}\bplaymat\b"),
    ("Storage Ottoman", r"\bstorage ottoman\b"),
    ("Storage Cube", r"\bstorage cube\b"),
    ("Storage Closet Organizer", r"\bstorage .{0,15}(?:hanging )?closet organi[sz]er\b"),
    ("Storage Toy Chest", r"\b(?:storage )?toy chest\b"),
    ("Storage Box", r"\bstorage box\b|\bfaux book storage\b"),
    ("Storage Bin", r"\b(?:storage|eva|rope) bin\b"),
    ("Storage Basket", r"\b(?:storage|plush) basket\b"),
    ("Mesh Pop-Up Hamper", r"\bmesh pop[ -]?up hamper\b"),
    ("Felt Hamper", r"\bfelt (?:oval )?hamper\b"),
    ("Hamper", r"\bhamper\b"),
    ("Crumb Rubber Outdoor Mat", r"\bcrumb rubber outdoor mat\b"),
    ("Crumb Rubber Door Mat", r"\bcrumb rubber door ?mat\b"),
    ("Anti-Fatigue PVC Kitchen Mat", r"\banti[ -]?fati(?:gue|que).{0,20}(?:pvc )?(?:kitchen )?mat\b|\bkitchen pvc mat\b"),
    ("Shaped Coir Mat", r"\bshaped coir mat\b"),
    ("Coir Mat", r"\bcoir (?:door )?mat\b"),
    ("Poly Doormat", r"\bpoly (?:door ?mat|doormat)\b"),
    ("Custom-Shaped Velvet Mat", r"\b(?:custom )?shaped velvet mat\b"),
    ("Floor Mat", r"\b(?:door ?mat|doormat|floor mat)\b"),
    ("Rug", r"\brug\b"),
    ("Die-Cut MDF Block", r"\b(?:die[ -]?cut|shaped).{0,12}\bmdf\b.{0,12}\bblock\b|\bmdf led block\b"),
    ("Glass Block", r"\bglass block\b"),
    ("Wood Block", r"\b(?:printed )?wood block\b"),
    ("Acrylic Block", r"\bacrylic block\b"),
    ("Ceramic Trinket Tray", r"\bceramic trinket tray\b"),
    ("Trinket Tray", r"\btrinket tray\b"),
    ("Jewelry Box", r"\bjewelry box\b"),
    ("Music Box", r"\bmusic box\b"),
    ("Snow Globe", r"\bsnow globe\b"),
    ("Bookend", r"\bbook ?ends?\b"),
    ("Mini Planter", r"\b(?:diy )?(?:ceramic )?mini planter\b"),
    ("Planter", r"\bplanter\b"),
    ("Bird Feeder", r"\bbird feeder\b"),
    ("Watering Can", r"\bwatering can\b"),
    ("Garden Stake", r"\bgarden stake\b"),
    ("Wall Shelf", r"\bwall shelf\b"),
    ("Wall Hook", r"\bwall hooks?\b"),
    ("Door Hanger", r"\bdoor hanger\b"),
    ("Phone Stand", r"\bphone stand\b"),
    ("Headphone Stand", r"\bheadphone stand\b"),
    ("Pencil Cup", r"\bpencil cup\b"),
    ("Calendar", r"\bcalendar\b"),
    ("Embroidery Kit", r"\b(?:diy )?embroidery kit\b"),
    ("Paper Shade", r"\bpaper shade\b"),
    ("Candle Holder", r"\bcandle holder\b"),
    ("Froomies Foam Wall Decor", r"\bfroomies foam wall (?:decor|dcor)\b"),
)

PRODUCT_RULES = tuple((name, re.compile(pattern, re.I)) for name, pattern in PRODUCT_RULES)


def normalize(value: object) -> str:
    return semantic_normalize(value)


def extract_size(description: str) -> tuple[str, str]:
    matches = list(DIMENSION.finditer(description))
    return ("; ".join(match.group(0).strip() for match in matches), matches[-1].group(0) if matches else "")


def _index_names(names: set[str]) -> dict[str, list[tuple[str, str]]]:
    index: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for display in names:
        normalized = normalize(display)
        if normalized:
            # Index on the longest word. Indexing on "the" or "a" made the
            # complete catalog scan every property name for almost every item.
            anchor = max(normalized.split(), key=lambda word: (len(word), word))
            index[anchor].append((display, normalized))
    for values in index.values():
        values.sort(key=lambda value: (-len(value[1].split()), -len(value[1])))
    return dict(index)


def load_name_lexicons(reference: Path | None) -> tuple[dict[str, list[tuple[str, str]]], dict[str, list[tuple[str, str]]]]:
    if not reference or not reference.exists():
        return {}, {}
    rows = json.loads(reference.read_text(encoding="utf-8"))
    licensors = {str(row.get("licensor_name", "")).strip() for row in rows}
    properties = {str(row.get("property_name", "")).strip() for row in rows}
    return _index_names(set(filter(None, licensors))), _index_names(set(filter(None, properties)))


def find_name(description: str, names: dict[str, list[tuple[str, str]]]) -> str:
    if isinstance(names, list):
        names = _index_names(set(names))
    haystack = normalize(description)
    words = set(haystack.split())
    candidates = [candidate for word in words for candidate in names.get(word, [])]
    candidates.sort(key=lambda value: (-len(value[1].split()), -len(value[1])))
    for display, needle in candidates:
        if re.search(rf"\b{re.escape(needle)}\b", haystack):
            return display
    return ""


def extract_product_type(description: str) -> tuple[str, str]:
    normalized = normalize(description)
    for canonical, pattern in PRODUCT_RULES:
        if pattern.search(normalized):
            return canonical, "Curated physical-product phrase"
    # Every row receives a proposed type. This review fallback is intentionally not
    # treated as equal to a curated phrase during high-confidence matching.
    prefix = DIMENSION.split(description, maxsplit=1)[0].split("_")[0]
    prefix = re.sub(r"[�\"”″']", " ", prefix)
    prefix = " ".join(prefix.split()).strip(" -_,;:/")
    return prefix[:120], "Provisional wording; semantic review required"


def remove_phrase(text: str, phrase: str) -> str:
    if not phrase:
        return text
    words = [re.escape(word) for word in normalize(phrase).split()]
    return re.sub(r"\b" + r"[\W_]+".join(words) + r"\b", " ", text, count=1, flags=re.I)


@dataclass
class ParsedDescription:
    product_type: str
    construction_shape: str
    treatment: str
    size: str
    licensor: str
    property: str
    artwork_description: str
    parse_basis: str
    dictionary_status: str
    family_id: str
    matched_product_wording: str


def parse_description(description: str, licensors, properties, dictionary: dict[str, dict] | None = None) -> ParsedDescription:
    if dictionary is None:
        semantic = classify_semantic_signature(description)
        product_type = semantic.physical_product
        construction = semantic.construction_shape
        treatment = semantic.treatment
        basis = "Reviewed semantic rule" if semantic.status == "accepted" else semantic.decision
        status = semantic.status
        family_id = ""
        matched_wording = semantic.matched_wording
    else:
        record = dictionary.get(normalize(candidate_wording(description)), {})
        product_type = record.get("canonical_physical_product", "")
        construction = record.get("construction_shape", "")
        treatment = record.get("treatment", "")
        status = record.get("status", "needs_review")
        family_id = record.get("family_id", "")
        matched_wording = record.get("matched_product_wording", "")
        basis = "Exact reviewed dictionary wording" if status in {"accepted", "alias"} else record.get("semantic_decision", "Dictionary review required")
    size, _ = extract_size(description)
    licensor = find_name(description, licensors)
    prop = find_name(description, properties)
    artwork = description
    for value in (matched_wording, product_type, construction, treatment, size, licensor, prop):
        artwork = remove_phrase(artwork, value)
    artwork = DIMENSION.sub(" ", artwork)
    artwork = re.sub(r"[_|]+", " ", artwork)
    artwork = " ".join(artwork.split()).strip(" -_,;:/")
    return ParsedDescription(product_type, construction, treatment, size, licensor, prop, artwork, basis, status, family_id, matched_wording)


def product_key(value: str) -> str:
    return normalize(value)


def hierarchy_key(row: pd.Series, depth: int) -> str:
    return "|".join(str(row[f"MG0{i}"]).strip().upper() for i in range(1, depth + 1))


def mg01_product_family(product: str) -> str:
    """Broad physical format used only for the MG01 fallback."""
    if product in {"Canvas", "Framed Canvas", "Canvas Tapestry", "Paint-Your-Own Canvas Set"}:
        return "Stretched or Box"
    if product.startswith("Framed "):
        return "Framed"
    if product in {"Wall Plaque", "Wall Sign", "Tall Wall Sign", "Door Hanger"}:
        return "Plaque"
    if product in {"Wall Shelf", "Wall Hook", "Memo Board", "Functional Board"}:
        return "Functional Wall"
    if product in {"Hanging Wall Art", "Wall Decal", "Foam Wall Decor", "Wall Light", "Wall Decor", "Paper Shade"}:
        return "Other Wall"
    if product in {"Tabletop Block", "Tabletop Monogram", "Perpetual Calendar"}:
        return "Block"
    if product in {"Tabletop Box"}:
        return "Box"
    if product == "Photo Frame":
        return "Photo Frames"
    if product in {"Mug", "Bookend", "Candle Holder", "Snow Globe", "Tabletop Planter", "Bank"}:
        return "Object"
    if product in {"Tabletop LED Art", "Tabletop Easel"}:
        return "Other Tabletop"
    if "Clock" in product:
        return "Clocks"
    if product in {"Storage Hamper", "Storage Toy Chest", "Storage Chest", "Storage Bin", "Storage Basket", "Storage Cube", "Storage Ottoman"}:
        return "Soft Storage"
    if product == "Hard Storage Box":
        return "Hard Storage"
    if product in {"Storage Organizer", "Storage Tower"}:
        return "Other Storage"
    if product in {"Stationery Organizer", "Pencil Cup", "Memo Holder", "Book"}:
        return "Stationery Organization"
    if product in {"Tablet Stand", "Desktop Cube", "Desk Organizer", "Lap Desk"}:
        return "Desk Accessories"
    if product in {"Writing Desk", "Desk Mat", "Embroidery Kit", "Display Rack"}:
        return "Other Workspace"
    if product in {"Door Mat", "Kitchen Mat", "Bath Mat", "Rug"}:
        return "Floor Coverings"
    if product in {"Garden Stake", "Garden Flag", "Outdoor Planter"}:
        return "Garden"
    return ""


def semantic_key(row: pd.Series, depth: int) -> str:
    product = row.get("Product Type", "")
    if depth == 1:
        values = [mg01_product_family(product)]
    elif depth == 2:
        values = [product, row.get("Construction Shape", "")]
    else:
        values = [product, row.get("Construction Shape", ""), row.get("Treatment", "")]
    return "|".join(normalize(value) for value in values)


def build_associations(post: pd.DataFrame) -> tuple[dict[int, list[dict]], dict[int, dict[str, Counter]]]:
    groups: dict[int, list[dict]] = {}
    reverse: dict[int, dict[str, Counter]] = {}
    for depth in (1, 2, 3):
        usable = (
            post[[f"MG0{i}" for i in range(1, depth + 1)]].ne("").all(axis=1)
            & post["Dictionary Status"].isin(["accepted", "alias"])
            & post["Description Usable for Product Matching"].eq("Yes")
            & post["Product Type"].ne("")
        )
        source = post[usable].copy()
        if source.empty:
            groups[depth] = []
            reverse[depth] = {}
            continue
        source["Hierarchy Key"] = source.apply(lambda row: hierarchy_key(row, depth), axis=1)
        source["Semantic Key"] = source.apply(lambda row: semantic_key(row, depth), axis=1)
        records = []
        by_product: dict[str, Counter] = defaultdict(Counter)
        for key, part in source.groupby("Hierarchy Key", sort=True):
            types = Counter(value for value in part["Semantic Key"] if value)
            records.append({
                "level": depth, "key": key, "item_count": len(part),
                "product_types": [{"semantic_key": name, "item_count": count} for name, count in types.most_common()],
                "examples": part["Item Desc"].drop_duplicates().head(5).tolist(),
            })
            for name, count in types.items():
                by_product[name][key] += count
        groups[depth] = records
        reverse[depth] = by_product
    return groups, reverse


def choose_at_level(signature_key: str, depth: int, associations: dict[str, Counter]) -> dict | None:
    key = signature_key
    evidence = Counter(associations.get(key, {}))
    if not evidence:
        return None
    ranked = evidence.most_common()
    chosen, count = ranked[0]
    total = sum(evidence.values())
    share = count / total
    runner = ranked[1][1] if len(ranked) > 1 else 0
    minimum_share = {3: 0.80, 2: 0.75, 1: 0.60}[depth]
    if share < minimum_share or (runner and count < runner * 1.5) or total < 2:
        return None
    return {
        "depth": depth, "key": chosen, "support": count, "total": total,
        "share": round(share, 4), "basis": "Exact reviewed semantic signature",
        "distribution": "; ".join(f"{value}: {n}" for value, n in ranked),
    }


def classify_product_type(product_type: str, reverse: dict[int, dict[str, Counter]], construction: str = "", treatment: str = "") -> dict:
    for depth in (3, 2, 1):
        if depth == 3:
            values = [product_type, construction, treatment]
        elif depth == 2:
            values = [product_type, construction]
        else:
            values = [mg01_product_family(product_type)]
        if not values[0]:
            continue
        decision = choose_at_level("|".join(normalize(value) for value in values), depth, reverse[depth])
        if decision:
            return decision
        if depth == 1 and values[0] in MG01_FAMILY_CODES:
            return {
                "depth": 1, "key": MG01_FAMILY_CODES[values[0]], "support": 0, "total": 0,
                "share": 1, "basis": "Exact physical format in the approved MG01 taxonomy",
                "distribution": f"{values[0]}: {MG01_FAMILY_CODES[values[0]]}",
            }
    return {"depth": 0, "key": "", "support": 0, "total": 0, "share": 0, "basis": "No reliable post-change product-type association", "distribution": ""}


def usable_description(value: str) -> bool:
    return not unusable_reason(value)


def load_product_dictionary(path: Path) -> dict[str, dict]:
    rows = pd.read_csv(path, dtype=str).fillna("")
    required = {
        "observed_normalized_wording", "canonical_physical_product", "construction_shape",
        "treatment", "status", "family_id", "matched_product_wording", "semantic_decision",
    }
    missing = required - set(rows.columns)
    if missing:
        raise ValueError(f"Dictionary is missing columns: {sorted(missing)}")
    return {str(row["observed_normalized_wording"]): row.to_dict() for _, row in rows.iterrows()}


def run(source: Path, output: Path, reference: Path | None, dictionary_path: Path | None = None) -> dict:
    data = pd.read_csv(source, dtype=str, encoding="cp1252").fillna("")
    data["Created Date"] = pd.to_datetime(data["CreatedTime"], errors="coerce")
    if data["Created Date"].isna().any():
        raise ValueError(f"{int(data['Created Date'].isna().sum())} CreatedTime values could not be read")
    dictionary_path = dictionary_path or Path(__file__).with_name("product_type_dictionary.csv")
    dictionary = load_product_dictionary(dictionary_path)
    licensors, properties = load_name_lexicons(reference)
    parsed = [parse_description(value, licensors, properties, dictionary) for value in data["Item Desc"]]
    for field in ParsedDescription.__dataclass_fields__:
        data[field.replace("_", " ").title()] = [asdict(value)[field] for value in parsed]
    data = data.rename(columns={"MerchGroup01": "MG01", "MerchGroup02": "MG02", "MerchGroup03": "MG03", "MerchGroup04": "MG04"})
    data["Description Usable for Product Matching"] = data["Item Desc"].map(lambda value: "Yes" if usable_description(value) else "No")
    post = data[data["Created Date"].ge(CUTOFF)].copy()
    pre = data[data["Created Date"].lt(CUTOFF)].copy()
    if len(post) + len(pre) != len(data):
        raise AssertionError("The date split did not account for every source row")
    groups, reverse = build_associations(post)
    signatures = list(zip(pre["Product Type"], pre["Construction Shape"], pre["Treatment"], pre["Dictionary Status"]))
    decision_by_signature = {}
    for product, construction, treatment, status in set(signatures):
        if status in {"accepted", "alias"} and product:
            decision_by_signature[(product, construction, treatment, status)] = classify_product_type(product, reverse, construction, treatment)
        else:
            decision_by_signature[(product, construction, treatment, status)] = {
                "depth": 0, "key": "", "support": 0, "total": 0, "share": 0,
                "basis": "No accepted physical-product dictionary entry", "distribution": "",
            }
    decisions = [decision_by_signature[value] for value in signatures]
    proposed = [decision["key"].split("|") if decision["key"] else [] for decision in decisions]
    for index, name in enumerate(("Proposed MG01", "Proposed MG02", "Proposed MG03")):
        pre[name] = [parts[index] if len(parts) > index else "" for parts in proposed]
    pre["Matched Level"] = [decision["depth"] for decision in decisions]
    pre["Match Basis"] = [decision["basis"] for decision in decisions]
    pre["Post-Change Evidence"] = [decision["distribution"] for decision in decisions]
    pre["Evidence Support"] = [decision["support"] for decision in decisions]
    pre["Evidence Total"] = [decision["total"] for decision in decisions]
    pre["Evidence Share"] = [decision["share"] for decision in decisions]
    pre["Artwork Used for MG Decision"] = "No"
    def outcome(row: pd.Series) -> str:
        if row["Matched Level"] == 3:
            return "Matched to MG01+MG02+MG03"
        if row["Matched Level"] == 2:
            return "Matched to MG01+MG02"
        if row["Matched Level"] == 1:
            return "Matched to MG01"
        if row["Description Usable for Product Matching"] == "Yes" and row["Dictionary Status"] in {"accepted", "alias"}:
            return "Readable accepted product, no reliable MG01"
        return "No usable accepted product type"
    pre["Outcome Bucket"] = pre.apply(outcome, axis=1)
    output.mkdir(parents=True, exist_ok=True)
    data.drop(columns=["Created Date"]).to_csv(output / "all_item_description_chunks.csv", index=False, encoding="utf-8-sig")
    pre.drop(columns=["Created Date"]).to_csv(output / "historical_hierarchical_mg_matches.csv", index=False, encoding="utf-8-sig")
    for depth, label in ((1, "mg01"), (2, "mg01_mg02"), (3, "mg01_mg02_mg03")):
        (output / f"post_change_{label}_product_types.json").write_text(json.dumps(groups[depth], indent=2, ensure_ascii=False), encoding="utf-8")
    counts = Counter(decision["depth"] for decision in decisions)
    no_mg01 = pre[pre["Matched Level"].eq(0)]
    summary = {
        "source_rows": len(data), "post_change_rows": len(post), "historical_rows": len(pre),
        "post_change_mg01_groups": len(groups[1]), "post_change_mg01_mg02_groups": len(groups[2]),
        "post_change_mg01_mg02_mg03_groups": len(groups[3]),
        "historical_matched_to_mg01_mg02_mg03": counts[3],
        "historical_matched_to_mg01_mg02": counts[2], "historical_matched_to_mg01": counts[1],
        "historical_unmatched_to_mg01": counts[0],
        "historical_without_usable_description": int(pre["Description Usable for Product Matching"].eq("No").sum()),
        "historical_usable_accepted_product_but_unmatched_to_mg01": int((
            no_mg01["Description Usable for Product Matching"].eq("Yes")
            & no_mg01["Dictionary Status"].isin(["accepted", "alias"])
        ).sum()),
        "historical_no_usable_accepted_product_type": int(pre["Outcome Bucket"].eq("No usable accepted product type").sum()),
    }
    (output / "hierarchical_match_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--dictionary", type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.output, args.reference, args.dictionary), indent=2))


if __name__ == "__main__":
    main()
