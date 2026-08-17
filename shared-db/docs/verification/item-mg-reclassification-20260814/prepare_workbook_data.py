"""Prepare compact JSON consumed by the artifact-tool workbook builder."""

import argparse
import json
from pathlib import Path

import pandas as pd


def records(frame: pd.DataFrame) -> list[dict]:
    return frame.where(pd.notna(frame), "").to_dict("records")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    summary = json.loads((args.run / "hierarchical_match_summary.json").read_text(encoding="utf-8"))
    precision = json.loads((args.run / "precision_review.json").read_text(encoding="utf-8"))
    historical = pd.read_csv(args.run / "historical_hierarchical_mg_matches.csv", dtype=str).fillna("")
    dictionary = pd.read_csv(args.dictionary, dtype=str).fillna("")
    keep = ["Item #", "Item Desc", "CreatedTime", "Product Type", "Construction Shape", "Treatment", "Size", "Licensor", "Property", "Artwork Description", "Dictionary Status", "Current MG01" , "Current MG02", "Current MG03"]
    historical = historical.rename(columns={"MG01": "Current MG01", "MG02": "Current MG02", "MG03": "Current MG03"})
    keep = [c for c in keep if c in historical.columns] + ["Proposed MG01", "Proposed MG02", "Proposed MG03", "Matched Level", "Match Basis", "Evidence Support", "Evidence Total", "Evidence Share", "Outcome Bucket"]
    historical = historical[keep]
    combos = {}
    for depth, name in ((1, "mg01"), (2, "mg01_mg02"), (3, "mg01_mg02_mg03")):
        groups = json.loads((args.run / f"post_change_{name}_product_types.json").read_text(encoding="utf-8"))
        rows = []
        for group in groups:
            codes = group["key"].split("|")
            for product in group["product_types"]:
                rows.append({
                    "MG01": codes[0], "MG02": codes[1] if len(codes) > 1 else "",
                    "MG03": codes[2] if len(codes) > 2 else "", "Semantic Product Signature": product["semantic_key"],
                    "Associated Item Count": product["item_count"], "Combination Item Count": group["item_count"],
                    "Example Descriptions": " | ".join(group["examples"][:3]),
                })
        combos[str(depth)] = rows
    residual = dictionary[dictionary["status"].isin(["needs_review", "placeholder"])].copy()
    residual = residual.sort_values(["all_item_count", "observed_display_wording"], ascending=[False, True])
    dictionary_cols = ["family_id", "status", "canonical_physical_product", "construction_shape", "treatment", "observed_display_wording", "all_item_count", "post_change_item_count", "semantic_decision"]
    payload = {
        "summary": summary, "precision": precision, "combinations": combos,
        "historical": records(historical), "dictionary": records(dictionary[dictionary_cols]),
        "residual": records(residual[dictionary_cols]),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
