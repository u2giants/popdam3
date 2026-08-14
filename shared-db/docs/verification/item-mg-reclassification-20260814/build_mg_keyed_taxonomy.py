"""Build the post-change description dictionary with MG01|MG02|MG03 as the hard key."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd


PRIVATE = Path(__file__).resolve().parents[3] / ".private" / "item-mg-reclassification-20260814"
CUTOFF = pd.Timestamp("2025-05-14")
REWORK = Path(r"T:\shared\_11 designflow\MerchGroup_Rework.xlsx")


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFKD", "" if pd.isna(value) else str(value)).encode("ascii", "ignore").decode().lower()
    text = text.replace("shadow box", "shadowbox").replace("die-cut", "diecut")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def canonical_for_row(description: str, semantic: str, chunk: str) -> str:
    value = normalized(description)
    if "canvas" in value and ("diy" in value or "paint by numbers" in value or re.search(r"\bpbn\b", value)):
        return "Paint-Your-Own Canvas Set"
    return semantic or chunk


def join_unique(values, limit: int = 60) -> str:
    seen = []
    for value in values:
        value = str(value).strip()
        if value and value not in seen:
            seen.append(value)
    return " | ".join(seen[:limit])


def main() -> None:
    semantic = pd.read_csv(PRIVATE / "semantic_product_type_rows.csv", dtype=str).fillna("")
    chunks = pd.read_csv(PRIVATE / "item_description_chunks.csv", dtype=str).fillna("")
    chunk_by_row = chunks.set_index("Source CSV Row")["Item Type"].to_dict()
    semantic["Date"] = pd.to_datetime(semantic["Created Date"], errors="coerce")
    post = semantic[semantic["Date"].ge(CUTOFF)].copy()
    for column in ("MG01", "MG02", "MG03"):
        post[column] = post[column].astype(str).str.strip().str.upper()
    post["MG Key"] = post[["MG01", "MG02", "MG03"]].astype(str).agg("|".join, axis=1)
    post["Complete MG Key"] = post[["MG01", "MG02", "MG03"]].ne("").all(axis=1)
    post["Chunk Item Type"] = post["Source CSV Row"].map(chunk_by_row).fillna("")
    post["Canonical Product Wording"] = post.apply(
        lambda row: canonical_for_row(row["Original Item Desc"], row["Canonical Product Type"], row["Chunk Item Type"]), axis=1
    )
    post["Observed Product Wording"] = post.apply(
        lambda row: row["Matched Wording"] or row["Chunk Item Type"] or row["Canonical Product Wording"], axis=1
    )

    complete = post[post["Complete MG Key"]].copy()
    definitions = pd.read_excel(REWORK, sheet_name="Final Version", header=2, dtype=str).fillna("")
    definition_map = defaultdict(list)
    for _, row in definitions.iterrows():
        codes = tuple(str(row[column]).strip().upper() for column in ("MG01 code", "MG02 code", "MG03 code"))
        if not all(codes):
            continue
        definition_map[codes].append({
            "MG01 Meaning": str(row["MG01 - Product Type"]).strip(),
            "MG02 Meaning": str(row["MG02 - Product Sub-Type"]).strip(),
            "MG03 Meaning": str(row["MG03 - Prod Sub-Sub-Type"]).strip() or "No additional description",
        })
    groups = []
    for key, part in complete.groupby("MG Key", sort=True):
        types = sorted(set(value for value in part["Canonical Product Wording"] if value))
        base_codes = tuple(str(part.iloc[0][column]).strip().upper()[:1] for column in ("MG01", "MG02", "MG03"))
        options = definition_map.get(base_codes, [])
        evidence = normalized(" ".join(types) + " " + " ".join(part["Observed Product Wording"].astype(str).unique()))
        def score(option):
            terms = normalized(f"{option['MG02 Meaning']} {option['MG03 Meaning']}").split()
            meaningful = [term for term in terms if len(term) > 2 and term not in {"with", "other", "additional", "description"}]
            return (sum(re.search(rf"\b{re.escape(term)}\b", evidence) is not None for term in meaningful), -len(meaningful))
        definition = max(options, key=score) if options else {}
        option_text = " | ".join(
            f"{option['MG01 Meaning']} > {option['MG02 Meaning']} > {option['MG03 Meaning']}" for option in options
        ) or "Unmapped"
        combined_meaning = " > ".join(value for value in (
            definition.get("MG01 Meaning", ""), definition.get("MG02 Meaning", ""), definition.get("MG03 Meaning", "")
        ) if value)
        unresolved = int(part["Canonical Product Wording"].eq("").sum())
        examples = part["Original Item Desc"].drop_duplicates().head(5).tolist()
        groups.append({
            "MG Primary Key": key,
            "MG01": part.iloc[0]["MG01"], "MG02": part.iloc[0]["MG02"], "MG03": part.iloc[0]["MG03"],
            "MG01 Meaning": definition.get("MG01 Meaning", "Unmapped"),
            "MG02 Meaning": definition.get("MG02 Meaning", "Unmapped"),
            "MG03 Meaning": definition.get("MG03 Meaning", "Unmapped"),
            "Combined Product Meaning": combined_meaning or "Unmapped",
            "Rework Definition Options": option_text,
            "Definition Status": "Unmapped" if not options else ("Multiple definitions; interpreted from descriptions" if len(options) > 1 else "Unique definition"),
            "Item Count": len(part), "Resolved Item Count": len(part) - unresolved, "Unresolved Item Count": unresolved,
            "Distinct Product Wording Count": len(types),
            "Associated Product Wordings": " | ".join(types),
            "Observed Wording Variants": join_unique(part["Observed Product Wording"]),
            "Example Item Description 1": examples[0] if examples else "",
            "Example Item Description 2": examples[1] if len(examples) > 1 else "",
            "Example Item Description 3": examples[2] if len(examples) > 2 else "",
            "Example Item Description 4": examples[3] if len(examples) > 3 else "",
            "Example Item Description 5": examples[4] if len(examples) > 4 else "",
            "Reviewer Decision": "", "Reviewer Notes": "",
        })

    detail = post.drop(columns=["Date", "Complete MG Key", "Chunk Item Type"]).rename(columns={
        "Canonical Product Type": "Previous Extracted Product Type",
    })
    detail["Review Status"] = detail.apply(
        lambda row: "Incomplete MG Key" if not all([row["MG01"], row["MG02"], row["MG03"]]) else ("Resolved" if row["Canonical Product Wording"] else "Unresolved Product Wording"), axis=1
    )
    detail_records = detail.to_dict(orient="records")
    pre = semantic[semantic["Date"].lt(CUTOFF)].copy()
    pre["Chunk Item Type"] = pre["Source CSV Row"].map(chunk_by_row).fillna("")
    pre["Extracted Product Wording"] = pre.apply(
        lambda row: canonical_for_row(row["Original Item Desc"], row["Canonical Product Type"], row["Chunk Item Type"]), axis=1
    )
    pre["Proposed MG01"] = ""
    pre["Proposed MG02"] = ""
    pre["Proposed MG03"] = ""
    pre["MG Assignment Status"] = pre["Extracted Product Wording"].map(
        lambda value: "Product wording extracted; MG not yet assigned" if value else "Product wording unresolved"
    )
    pre_records = pre.drop(columns=["Date", "Chunk Item Type"]).to_dict(orient="records")
    summary = {
        "cutoff": "2025-05-14", "post_change_items": len(post),
        "complete_key_items": len(complete), "incomplete_key_items": len(post) - len(complete),
        "mg_primary_keys": len(groups),
        "mapped_rework_keys": sum(group["Combined Product Meaning"] != "Unmapped" for group in groups),
        "unmapped_rework_keys": sum(group["Combined Product Meaning"] == "Unmapped" for group in groups),
        "resolved_product_wording_items": int(complete["Canonical Product Wording"].ne("").sum()),
        "unresolved_product_wording_items": int(complete["Canonical Product Wording"].eq("").sum()),
        "pre_change_items": len(pre),
        "pre_change_product_wording_resolved": int(pre["Extracted Product Wording"].ne("").sum()),
        "pre_change_product_wording_unresolved": int(pre["Extracted Product Wording"].eq("").sum()),
    }
    for name, value in {
        "mg_key_groups.json": groups, "mg_post_change_rows.json": detail_records,
        "mg_pre_change_rows.json": pre_records, "mg_keyed_summary.json": summary,
    }.items():
        (PRIVATE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
