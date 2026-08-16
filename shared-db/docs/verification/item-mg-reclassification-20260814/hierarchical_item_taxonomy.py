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


CUTOFF = pd.Timestamp("2025-05-14")
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
    text = unicodedata.normalize("NFKD", "" if pd.isna(value) else str(value))
    text = text.encode("ascii", "ignore").decode().lower()
    replacements = {"shadow box": "shadowbox", "die-cut": "die cut", "fatique": "fatigue", "cnvs": "canvas"}
    for old, new in replacements.items():
        text = text.replace(old, new)
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


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
    size: str
    licensor: str
    property: str
    artwork_description: str
    parse_basis: str


def parse_description(description: str, licensors, properties) -> ParsedDescription:
    product_type, basis = extract_product_type(description)
    size, _ = extract_size(description)
    licensor = find_name(description, licensors)
    prop = find_name(description, properties)
    artwork = description
    for value in (product_type, size, licensor, prop):
        artwork = remove_phrase(artwork, value)
    artwork = DIMENSION.sub(" ", artwork)
    artwork = re.sub(r"[_|]+", " ", artwork)
    artwork = " ".join(artwork.split()).strip(" -_,;:/")
    return ParsedDescription(product_type, size, licensor, prop, artwork, basis)


def product_key(value: str) -> str:
    value = normalize(value)
    aliases = {
        "canvas": "printed canvas", "plain canvas": "printed canvas", "stretched canvas": "printed canvas",
        "pp wall clock": "molded wall clock", "polypropylene molded wall clock": "molded wall clock",
        "anti fatigue pvc kitchen": "anti fatigue pvc kitchen mat",
        "anti fatigue kitchen mat": "anti fatigue pvc kitchen mat",
        "27cm froomies foam wall dcor": "froomies foam wall decor",
    }
    return aliases.get(value, value)


def hierarchy_key(row: pd.Series, depth: int) -> str:
    return "|".join(str(row[f"MG0{i}"]).strip().upper() for i in range(1, depth + 1))


def build_associations(post: pd.DataFrame) -> tuple[dict[int, list[dict]], dict[int, dict[str, Counter]]]:
    groups: dict[int, list[dict]] = {}
    reverse: dict[int, dict[str, Counter]] = {}
    for depth in (1, 2, 3):
        usable = post[[f"MG0{i}" for i in range(1, depth + 1)]].ne("").all(axis=1)
        source = post[usable].copy()
        source["Hierarchy Key"] = source.apply(lambda row: hierarchy_key(row, depth), axis=1)
        records = []
        by_product: dict[str, Counter] = defaultdict(Counter)
        for key, part in source.groupby("Hierarchy Key", sort=True):
            types = Counter(product_key(value) for value in part["Product Type"] if product_key(value))
            records.append({
                "level": depth, "key": key, "item_count": len(part),
                "product_types": [{"product_type": name, "item_count": count} for name, count in types.most_common()],
                "examples": part["Item Desc"].drop_duplicates().head(5).tolist(),
            })
            for name, count in types.items():
                by_product[name][key] += count
        groups[depth] = records
        reverse[depth] = by_product
    return groups, reverse


def token_similarity(left: str, right: str) -> float:
    a, b = set(product_key(left).split()), set(product_key(right).split())
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


_ASSOCIATION_TOKEN_INDEX: dict[int, dict[str, set[str]]] = {}


def related_later_types(product_type: str, associations: dict[str, Counter]) -> set[str]:
    identity = id(associations)
    if identity not in _ASSOCIATION_TOKEN_INDEX:
        index: dict[str, set[str]] = defaultdict(set)
        for later_type in associations:
            for token in set(later_type.split()):
                if len(token) >= 3:
                    index[token].add(later_type)
        _ASSOCIATION_TOKEN_INDEX[identity] = dict(index)
    result: set[str] = set()
    for token in set(product_key(product_type).split()):
        if len(token) >= 3:
            result.update(_ASSOCIATION_TOKEN_INDEX[identity].get(token, set()))
    return result


def choose_at_level(product_type: str, depth: int, associations: dict[str, Counter]) -> dict | None:
    key = product_key(product_type)
    evidence = Counter(associations.get(key, {}))
    basis = "Exact canonical product type"
    if not evidence:
        # Variant recovery is deliberately stricter for deep assignments. MG01 is broad,
        # so a shared physical noun is often enough when every close later type agrees.
        threshold = {3: 0.72, 2: 0.55, 1: 0.25}[depth]
        scored = [(token_similarity(key, later_type), later_type) for later_type in related_later_types(key, associations)]
        best = max((score for score, _ in scored), default=0)
        for score, later_type in scored:
            if score >= threshold and score >= best - 0.08:
                evidence.update(associations[later_type])
        basis = f"Semantic product-type variant ({best:.0%} token agreement)"
    if not evidence:
        return None
    ranked = evidence.most_common()
    chosen, count = ranked[0]
    total = sum(evidence.values())
    share = count / total
    runner = ranked[1][1] if len(ranked) > 1 else 0
    minimum_share = {3: 0.80, 2: 0.75, 1: 0.60}[depth]
    if share < minimum_share or (runner and count < runner * 1.5):
        return None
    return {
        "depth": depth, "key": chosen, "support": count, "total": total,
        "share": round(share, 4), "basis": basis,
        "distribution": "; ".join(f"{value}: {n}" for value, n in ranked),
    }


def classify_product_type(product_type: str, reverse: dict[int, dict[str, Counter]]) -> dict:
    for depth in (3, 2, 1):
        decision = choose_at_level(product_type, depth, reverse[depth])
        if decision:
            return decision
    return {"depth": 0, "key": "", "support": 0, "total": 0, "share": 0, "basis": "No reliable post-change product-type association", "distribution": ""}


def usable_description(value: str) -> bool:
    text = normalize(value)
    if not text or text in {"pending", "assortment", "assorted", "desc", "sample", "samples"}:
        return False
    if re.fullmatch(r"(?:annual )?(?:testing|sample|reprint|art|mdpd)? ?fees?", text):
        return False
    if re.fullmatch(r"[a-z]*\d+[a-z0-9]*", text):
        return False
    return True


def run(source: Path, output: Path, reference: Path | None) -> dict:
    data = pd.read_csv(source, dtype=str, encoding="cp1252").fillna("")
    data["Created Date"] = pd.to_datetime(data["CreatedTime"], errors="coerce")
    licensors, properties = load_name_lexicons(reference)
    parsed = [parse_description(value, licensors, properties) for value in data["Item Desc"]]
    for field in ParsedDescription.__dataclass_fields__:
        data[field.replace("_", " ").title()] = [asdict(value)[field] for value in parsed]
    data = data.rename(columns={"MerchGroup01": "MG01", "MerchGroup02": "MG02", "MerchGroup03": "MG03", "MerchGroup04": "MG04"})
    post = data[data["Created Date"].ge(CUTOFF)].copy()
    pre = data[data["Created Date"].lt(CUTOFF)].copy()
    groups, reverse = build_associations(post)
    # A product type is classified once, then reused for every item carrying that type.
    # This also guarantees identical product types receive identical decisions.
    decision_by_type = {
        value: classify_product_type(value, reverse) for value in pre["Product Type"].drop_duplicates()
    }
    decisions = [decision_by_type[value] for value in pre["Product Type"]]
    proposed = [decision["key"].split("|") if decision["key"] else [] for decision in decisions]
    for index, name in enumerate(("Proposed MG01", "Proposed MG02", "Proposed MG03")):
        pre[name] = [parts[index] if len(parts) > index else "" for parts in proposed]
    pre["Matched Level"] = [decision["depth"] for decision in decisions]
    pre["Match Basis"] = [decision["basis"] for decision in decisions]
    pre["Post-Change Evidence"] = [decision["distribution"] for decision in decisions]
    pre["Evidence Share"] = [decision["share"] for decision in decisions]
    pre["Artwork Used for MG Decision"] = "No"
    pre["Description Usable for Product Matching"] = pre["Item Desc"].map(lambda value: "Yes" if usable_description(value) else "No")
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
        "historical_usable_description_but_unmatched_to_mg01": int(no_mg01["Description Usable for Product Matching"].eq("Yes").sum()),
    }
    (output / "hierarchical_match_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.output, args.reference), indent=2))


if __name__ == "__main__":
    main()
