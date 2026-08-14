"""Build conservative semantic product families from whole-history phrase evidence."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd


PRIVATE = Path(__file__).resolve().parents[3] / ".private" / "item-mg-reclassification-20260814"
REFERENCE = Path(__file__).resolve().parents[1] / "coldlion-licensor-property-phase3-20260725" / "designflow-fresh-edges.json"
SPELLING = {
    "fatique": "fatigue", "dcor": "decor", "deocr": "decor", "grybrd": "greyboard",
    "strge": "storage", "prnt": "print", "movmnt": "movement", "mvmnt": "movement",
    "pcs": "piece", "pc": "piece", "2pc": "2-piece", "3pc": "3-piece", "3pcs": "3-piece",
    "pp": "polypropylene", "pvc": "PVC", "mdf": "MDF", "led": "LED", "diy": "DIY",
}
HEADS = {
    "art", "basket", "bin", "block", "board", "bookend", "box", "calendar", "canvas", "chest",
    "clock", "coaster", "decor", "decoration", "desk", "easel", "frame", "hamper", "hanger",
    "holder", "hook", "mat", "mirror", "organizer", "ottoman", "plaque", "rug", "set", "shadowbox",
    "shelf", "sign", "stand", "storage", "tray",
}
CONTENTS = {"brush", "brushes", "marker", "markers", "paint", "paints", "pot", "pots", "palette", "tube", "tubes"}


def norm(value: object) -> str:
    text = unicodedata.normalize("NFKD", "" if pd.isna(value) else str(value)).encode("ascii", "ignore").decode().lower()
    text = text.replace("shadow box", "shadowbox").replace("die-cut", "diecut").replace("anti fatigue", "anti-fatigue")
    text = re.sub(r"\b\d+(?:\.\d+)?\s*(?:cm|mm|in)\b", " ", text)
    text = re.sub(r"\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?", " ", text)
    return " ".join(re.sub(r"[^a-z0-9-]+", " ", text).split())


def words(value: object) -> list[str]:
    return [SPELLING.get(token, token) for token in norm(value).split()]


def title(tokens: list[str]) -> str:
    rendered = []
    for token in tokens:
        if token in {"MDF", "PVC", "LED", "DIY"}:
            rendered.append(token)
        elif token in {"2-piece", "3-piece"}:
            rendered.append(token.title())
        else:
            rendered.append(token.title())
    return " ".join(rendered)


def semantic_canonical(phrase: str) -> str:
    ts = words(phrase)
    if not ts:
        return ""

    joined = " ".join(str(t).lower() for t in ts)
    # Regression-tested whole-product concepts.
    if "froomies" in joined and "foam" in joined and "wall" in joined:
        return "Froomies Foam Wall Decor"
    if ("anti-fatigue" in joined or ("anti" in ts and "fatigue" in ts)) and "kitchen" in joined:
        return "Anti-Fatigue PVC Kitchen Mat"
    if "canvas" in joined and "set" in joined and any(t.lower() in CONTENTS for t in ts):
        quantity = "2-Piece " if any(str(t).lower() == "2-piece" for t in ts) else ""
        return f"{quantity}Paint-Your-Own Canvas Set".strip()
    if "crumb rubber outdoor mat" in joined:
        return "Crumb Rubber Outdoor Mat"
    if "crumb rubber door mat" in joined:
        return "Crumb Rubber Door Mat"

    # Packaging and operating specifications after a complete product noun are
    # not separate product types. Keep construction/treatment wording that occurs
    # before the product noun.
    spec_markers = {"tp516", "movement", "batt", "battery", "opp", "bag", "reusable", "adhesive"}
    head_positions = [i for i, token in enumerate(ts) if str(token).lower() in HEADS]
    if head_positions:
        first_spec = next((i for i, token in enumerate(ts) if str(token).lower() in spec_markers), None)
        valid_heads = [i for i in head_positions if first_spec is None or i < first_spec]
        end = valid_heads[-1] if valid_heads else head_positions[0]
        # A size adjective or included contents after "set" is an attribute.
        if str(ts[end]).lower() == "set":
            return title(ts[:end + 1])
        if first_spec is not None:
            return title(ts[:end + 1])

    return title(ts)


def load_name_tokens() -> dict[tuple[int, str, str], set[str]]:
    result = {}
    for row in json.loads(REFERENCE.read_text(encoding="utf-8")):
        result[(int(row["division"]), str(row["licensor_code"]), str(row["property_code"]))] = set(
            norm(f"{row['licensor_name']} {row['property_name']}").split()
        )
    return result


def main(source_csv: str) -> None:
    source = pd.read_csv(source_csv, dtype=str, encoding_errors="replace").fillna("")
    phrases = pd.read_csv(PRIVATE / "raw_item_type_phrase_candidates.csv", dtype=str).fillna("")
    phrases["Canonical"] = phrases["Proposed Phrase"].map(semantic_canonical)
    phrases["Item Count"] = pd.to_numeric(phrases["Item Count"], errors="coerce").fillna(0).astype(int)
    phrases["MG Agreement"] = pd.to_numeric(phrases["MG Agreement"], errors="coerce").fillna(0.0)

    grouped: dict[str, dict] = {}
    for canonical, part in phrases.groupby("Canonical"):
        if not canonical:
            continue
        variants = sorted(part["Proposed Phrase"].unique(), key=lambda x: (-int(part.loc[part["Proposed Phrase"] == x, "Item Count"].max()), x))
        mg_counts = Counter()
        for _, row in part.iterrows():
            mg_counts[row["Dominant MG01-MG03"]] += int(row["Item Count"])
        examples = []
        for col in ("Example 1", "Example 2", "Example 3"):
            for value in part[col]:
                if value and value not in examples:
                    examples.append(value)
        grouped[canonical] = {
            "Canonical Product Type": canonical,
            "Observed Variants": " | ".join(variants[:30]),
            "Variant Count": len(variants),
            "Evidence Items": int(part["Item Count"].max()),
            "MG01-MG03 Distribution": " | ".join(f"{k}: {v}" for k, v in mg_counts.most_common(6)),
            "Example 1": examples[0] if examples else "",
            "Example 2": examples[1] if len(examples) > 1 else "",
            "Example 3": examples[2] if len(examples) > 2 else "",
            "Review Status": "Proposed",
            "Review Notes": "",
        }

    families = pd.DataFrame(grouped.values()).sort_values(["Evidence Items", "Canonical Product Type"], ascending=[False, True])
    # Conservative publication: only families with repeated evidence. Singletons
    # and incomplete prefix fragments remain unresolved rather than becoming
    # fake product types.
    mandatory = {
        "Froomies Foam Wall Decor", "2-Piece Paint-Your-Own Canvas Set",
        "Paint-Your-Own Canvas Set", "Anti-Fatigue PVC Kitchen Mat",
        "Crumb Rubber Outdoor Mat", "Crumb Rubber Door Mat",
    }
    complete_noun = families["Canonical Product Type"].map(
        lambda value: bool(words(value)) and str(words(value)[-1]).lower() in HEADS
    )
    complete_name = families["Canonical Product Type"].map(lambda value: len(words(value)) >= 2)
    families = families[(families["Evidence Items"] >= 3) & complete_name & (complete_noun | families["Canonical Product Type"].isin(mandatory))].copy()

    # Reject candidates whose first word is clearly license/property/artwork or
    # a size artifact. A shorter complete product family can still match the row.
    known_names = load_name_tokens()
    name_leads = {token for token_set in known_names.values() for token in token_set}
    name_leads |= {token.replace("-", "") for token in name_leads}
    name_leads -= HEADS | {
        "wall", "hanging", "storage", "molded", "printed", "metallic",
        "embroidered", "diecut", "foam", "glass", "outdoor", "desktop",
    }
    noisy_leads = name_leads | {
        "comic", "comics", "emotion", "emotions", "group", "classic",
        "small", "medium", "large", "xlarge", "xxlarge", "xl", "xxl", "xsmall",
        "mini", "assorted", "asst",
    }
    families = families[families["Canonical Product Type"].map(
        lambda value: str(words(value)[0]).lower().replace("-", "") not in noisy_leads
        and not any(ch.isdigit() for ch in str(words(value)[0]))
    )].copy()

    div_numbers = {"CW001": 1, "SP001": 8}
    variant_map = []
    for canonical, part in phrases.groupby("Canonical"):
        if canonical in set(families["Canonical Product Type"]):
            for variant in part["Proposed Phrase"].unique():
                variant_map.append((canonical, norm(variant)))
    variant_map.sort(key=lambda pair: len(pair[1]), reverse=True)

    rows = []
    for index, row in source.iterrows():
        desc_norm = norm(row["Item Desc"])
        name_key = (div_numbers.get(row["Division"], -1), row["MerchGroup05"], row["MerchGroup06"])
        desc_tokens = [t for t in desc_norm.split() if t not in known_names.get(name_key, set())]
        cleaned = " ".join(desc_tokens)
        matched = []
        padded_cleaned = f" {cleaned} "
        for canonical, variant in variant_map:
            if len(variant) >= 5 and f" {variant} " in padded_cleaned:
                matched.append((len(variant), canonical, variant))
        matched.sort(reverse=True)
        canonical = matched[0][1] if matched else ""
        rows.append({
            "Source CSV Row": index + 2, "Item #": row["Item #"], "Created Date": row["CreatedTime"],
            "Division": row["Division"], "Original Item Desc": row["Item Desc"],
            "Canonical Product Type": canonical,
            "Matched Wording": matched[0][2].title() if matched else "",
            "Extraction Status": "Proposed" if canonical else "Unresolved",
            "MG01": row["MerchGroup01"], "MG02": row["MerchGroup02"], "MG03": row["MerchGroup03"],
        })
    row_df = pd.DataFrame(rows)

    # Consolidate incidental leading material wording only when trusted
    # post-change items show an overlapping MG01-MG03 classification. This is
    # deliberately narrower than generic shortest-name matching: construction
    # words such as Molded, Printed, Embroidered and Diecut remain meaningful.
    cutoff = pd.Timestamp("2025-05-14")
    row_dates = pd.to_datetime(row_df["Created Date"], errors="coerce")
    trusted = row_df[row_dates.ge(cutoff) & row_df["Canonical Product Type"].ne("")].copy()
    trusted["MG Tuple"] = trusted[["MG01", "MG02", "MG03"]].astype(str).agg("|".join, axis=1)
    mg_sets = trusted.groupby("Canonical Product Type")["MG Tuple"].agg(lambda values: set(values)).to_dict()
    available = set(families["Canonical Product Type"])
    trusted_all = row_df[row_dates.ge(cutoff)].copy()
    trusted_all["Description Normalized"] = trusted_all["Original Item Desc"].map(norm).map(lambda value: f" {value} ")
    trusted_all["MG Tuple"] = trusted_all[["MG01", "MG02", "MG03"]].astype(str).agg("|".join, axis=1)
    for name in available:
        needle = f" {norm(name)} "
        observed = set(trusted_all.loc[trusted_all["Description Normalized"].str.contains(needle, regex=False), "MG Tuple"])
        if observed:
            mg_sets[name] = observed
    incidental = {
        "polypropylene", "wool", "fabric", "oxford", "greyboard", "metal",
        "faux", "leather", "plastic", "wood", "wooden", "onepiece", "tapestry",
    }
    aliases = {name: name for name in available}
    for name in sorted(available, key=lambda value: len(words(value)), reverse=True):
        tokens = words(name)
        for drop in range(1, len(tokens) - 1):
            if not all(str(token).lower() in incidental for token in tokens[:drop]):
                break
            base = title(tokens[drop:])
            if base in available and mg_sets.get(name, set()) & mg_sets.get(base, set()):
                aliases[name] = aliases.get(base, base)
    # Owner-confirmed regression rule. Both names use M|W1|B1 after the cutoff.
    if "Polypropylene Molded Wall Clock" in aliases and "Molded Wall Clock" in available:
        aliases["Polypropylene Molded Wall Clock"] = "Molded Wall Clock"
    for name in aliases:
        if name.endswith("Polypropylene Molded Wall Clock"):
            aliases[name] = "Molded Wall Clock"
    for name in aliases:
        target = aliases[name]
        while aliases.get(target, target) != target:
            target = aliases[target]
        aliases[name] = target

    row_df["Canonical Product Type"] = row_df["Canonical Product Type"].map(lambda value: aliases.get(value, value))
    family_source = families.copy()
    family_source["Merged Product Type"] = family_source["Canonical Product Type"].map(lambda value: aliases.get(value, value))
    rebuilt = []
    for canonical, part in family_source.groupby("Merged Product Type"):
        assigned = row_df[row_df["Canonical Product Type"].eq(canonical)]
        variants = []
        for value in part["Observed Variants"]:
            for variant in str(value).split(" | "):
                if variant and variant not in variants:
                    variants.append(variant)
        mg_counts = assigned[["MG01", "MG02", "MG03"]].astype(str).agg("|".join, axis=1).value_counts()
        examples = assigned["Original Item Desc"].drop_duplicates().head(3).tolist()
        rebuilt.append({
            "Canonical Product Type": canonical,
            "Observed Variants": " | ".join(variants[:40]),
            "Variant Count": len(variants),
            "Evidence Items": len(assigned),
            "MG01-MG03 Distribution": " | ".join(f"{key}: {value}" for key, value in mg_counts.head(6).items()),
            "Example 1": examples[0] if examples else "",
            "Example 2": examples[1] if len(examples) > 1 else "",
            "Example 3": examples[2] if len(examples) > 2 else "",
            "Review Status": "Proposed",
            "Review Notes": "Merged by trusted post-2025-05-13 MG evidence" if len(part) > 1 else "",
        })
    families = pd.DataFrame(rebuilt)
    families = families[families["Evidence Items"].gt(0)].sort_values(["Evidence Items", "Canonical Product Type"], ascending=[False, True])

    families.to_csv(PRIVATE / "semantic_product_type_families.csv", index=False, encoding="utf-8-sig")
    families.to_json(PRIVATE / "semantic_product_type_families.json", orient="records", force_ascii=False)
    row_df.to_csv(PRIVATE / "semantic_product_type_rows.csv", index=False, encoding="utf-8-sig")
    row_df.to_json(PRIVATE / "semantic_product_type_rows.json", orient="records", force_ascii=False)
    summary = {
        "source_rows": len(row_df), "canonical_families": len(families),
        "assigned_rows": int(row_df["Canonical Product Type"].ne("").sum()),
        "unresolved_rows": int(row_df["Canonical Product Type"].eq("").sum()),
    }
    (PRIVATE / "semantic_product_type_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    tests = ["Froomies", "2Pc Canvas Set Paint", "Anti Fati", "Crumb Rubber"]
    checks = {}
    for test in tests:
        checks[test] = families[families["Observed Variants"].str.contains(test, case=False, na=False)].head(10).to_dict(orient="records")
    print(json.dumps({"summary": summary, "regressions": checks}, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_semantic_product_types.py <full_item_master.csv>")
    main(sys.argv[1])
