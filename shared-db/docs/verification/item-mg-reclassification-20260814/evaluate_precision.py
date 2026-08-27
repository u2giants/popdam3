"""Deterministic post-change holdout check for the historical matcher."""

import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd

from hierarchical_item_taxonomy import (
    CUTOFF,
    ParsedDescription,
    build_associations,
    classify_axes,
    code_validity,
    load_product_dictionary,
    load_taxonomy_validity,
    parse_description,
    usable_description,
)


def run(source: Path, dictionary_path: Path, output: Path) -> dict:
    data = pd.read_csv(source, dtype=str, encoding="cp1252").fillna("")
    data["Created Date"] = pd.to_datetime(data["CreatedTime"], errors="raise")
    data = data[data["Created Date"].ge(CUTOFF)].copy()
    dictionary = load_product_dictionary(dictionary_path)
    parsed = [parse_description(value, {}, {}, dictionary) for value in data["Item Desc"]]
    for field in ParsedDescription.__dataclass_fields__:
        data[field.replace("_", " ").title()] = [getattr(value, field) for value in parsed]
    data = data.rename(columns={"MerchGroup01": "MG01", "MerchGroup02": "MG02", "MerchGroup03": "MG03"})
    data["Description Usable for Product Matching"] = data["Item Desc"].map(lambda x: "Yes" if usable_description(x) else "No")
    validity = load_taxonomy_validity(source.with_name("MerchGroup_Rework.xlsx"))
    flags = [code_validity(row, validity) for _, row in data.iterrows()]
    for index, name in enumerate(("Valid MG01", "Valid MG01+MG02", "Valid MG01+MG02+MG03")):
        data[name] = ["Yes" if value[index] else "No" for value in flags]
    heldout = data["Item #"].map(lambda value: int(hashlib.sha256(value.encode()).hexdigest()[:8], 16) % 5 == 0)
    _, reverse = build_associations(data[~heldout], validity)
    rows = []
    excluded_invalid_actual = 0
    for _, row in data[heldout].iterrows():
        if row["Dictionary Status"] not in {"accepted", "alias"} or not row["Product Type"]:
            continue
        decision = classify_axes(
            row["Form"], row["Taxonomy Subtype"], row["Embellishment"],
            row["Embellishment State"], reverse, validity,
        )
        validity_column = {1: "Valid MG01", 2: "Valid MG01+MG02", 3: "Valid MG01+MG02+MG03"}.get(decision["depth"])
        if validity_column and row[validity_column] != "Yes":
            excluded_invalid_actual += 1
            continue
        actual = "|".join(row[f"MG0{i}"].strip().upper() for i in range(1, decision["depth"] + 1))
        rows.append({"level": decision["depth"], "product": row["Product Type"], "form": row["Form"], "subtype": row["Taxonomy Subtype"], "embellishment": row["Embellishment"], "proposed": decision["key"], "actual": actual, "correct": decision["depth"] > 0 and decision["key"] == actual})
    detail = pd.DataFrame(rows)
    by_level = []
    for level in (3, 2, 1, 0):
        part = detail[detail["level"].eq(level)]
        by_level.append({"level": level, "tested": len(part), "correct": int(part["correct"].sum()), "precision": round(float(part["correct"].mean()), 4) if len(part) else None})
    result = {"post_change_rows": len(data), "heldout_rows": int(heldout.sum()), "eligible_heldout_rows": len(detail), "excluded_invalid_actual": excluded_invalid_actual, "by_level": by_level}
    result["errors"] = detail[~detail["correct"]].groupby(["level", "product", "form", "subtype", "embellishment", "proposed", "actual"]).size().reset_index(name="count").sort_values("count", ascending=False).head(100).to_dict("records")
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--dictionary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.source, args.dictionary, args.output), indent=2))
