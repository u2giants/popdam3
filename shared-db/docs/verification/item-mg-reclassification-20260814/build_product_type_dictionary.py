"""Build the governed phrase dictionary from full Item Descriptions.

MG distributions are post-change evidence columns only. They never determine the
semantic product family, status, construction, or treatment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import pandas as pd

from product_type_dictionary import candidate_wording, classify_semantic_signature, normalize, validate_signature


CUTOFF = pd.Timestamp("2025-05-14")


def post_evidence(post: pd.DataFrame) -> dict[str, dict[int, Counter]]:
    evidence: dict[str, dict[int, Counter]] = {}
    for _, row in post.iterrows():
        wording = row["Normalized Wording"]
        levels = evidence.setdefault(wording, {1: Counter(), 2: Counter(), 3: Counter()})
        for depth in (1, 2, 3):
            values = [str(row[f"MerchGroup0{i}"]).strip().upper() for i in range(1, depth + 1)]
            if all(values):
                levels[depth]["|".join(values)] += 1
    return evidence


def render_distribution(counter: Counter) -> str:
    return "; ".join(f"{key}: {count}" for key, count in counter.most_common())


def build(source: Path, output: Path) -> dict:
    data = pd.read_csv(source, dtype=str, encoding="cp1252").fillna("")
    data["Created Date"] = pd.to_datetime(data["CreatedTime"], errors="coerce")
    if data["Created Date"].isna().any():
        raise ValueError(f"{int(data['Created Date'].isna().sum())} CreatedTime values could not be parsed")
    data["Observed Wording"] = data["Item Desc"].map(candidate_wording)
    data["Normalized Wording"] = data["Observed Wording"].map(normalize)
    post = data[data["Created Date"].ge(CUTOFF)]
    evidence_by_wording = post_evidence(post)
    post_counts = post["Normalized Wording"].value_counts().to_dict()

    records = []
    for wording, part in data.groupby("Normalized Wording", sort=True, dropna=False):
        examples = part["Item Desc"].drop_duplicates().head(3).tolist()
        signatures = [classify_semantic_signature(value) for value in examples]
        accepted = [s for s in signatures if s.status == "accepted"]
        if accepted:
            counts = Counter((s.physical_product, s.construction_shape, s.treatment, s.matched_wording) for s in accepted)
            product, construction, treatment, matched = counts.most_common(1)[0][0]
            signature = next(s for s in accepted if (s.physical_product, s.construction_shape, s.treatment, s.matched_wording) == (product, construction, treatment, matched))
        else:
            signature = signatures[0] if signatures else classify_semantic_signature("")
        errors = validate_signature(signature)
        if errors:
            raise ValueError(f"Invalid dictionary signature for {wording!r}: {errors}")
        later_evidence = evidence_by_wording.get(wording, {1: Counter(), 2: Counter(), 3: Counter()})
        family_material = f"{signature.physical_product}|{signature.construction_shape}|{signature.treatment}"
        family_id = "PT-" + hashlib.sha1(normalize(family_material).encode("utf-8")).hexdigest()[:10].upper() if signature.physical_product else ""
        display = part["Observed Wording"].value_counts().index[0] if len(part) else ""
        status = signature.status
        canonical_phrase = " - ".join(filter(None, (signature.physical_product, signature.construction_shape, signature.treatment)))
        if status == "accepted" and normalize(display) != normalize(canonical_phrase):
            status = "alias"
        records.append({
            "family_id": family_id,
            "observed_normalized_wording": wording,
            "observed_display_wording": display,
            "canonical_physical_product": signature.physical_product,
            "construction_shape": signature.construction_shape,
            "treatment": signature.treatment,
            "status": status,
            "alias_target_family_id": family_id if status == "alias" else "",
            "semantic_decision": signature.decision,
            "matched_product_wording": signature.matched_wording,
            "all_item_count": len(part),
            "post_change_item_count": post_counts.get(wording, 0),
            "post_change_mg01_distribution": render_distribution(later_evidence[1]),
            "post_change_mg01_mg02_distribution": render_distribution(later_evidence[2]),
            "post_change_mg01_mg02_mg03_distribution": render_distribution(later_evidence[3]),
            "reviewer": "Codex semantic rule review",
            "review_date": "2026-08-17",
            "dictionary_version": "2026-08-17-v1",
            "singleton_exception": "",
        })

    frame = pd.DataFrame(records)
    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output, index=False, encoding="utf-8-sig")
    summary = {
        "source_rows": len(data),
        "dictionary_wordings": len(frame),
        "status_counts": frame["status"].value_counts().to_dict(),
        "row_counts_by_status": frame.groupby("status")["all_item_count"].sum().to_dict(),
        "accepted_families": int(frame.loc[frame["status"].isin(["accepted", "alias"]), "family_id"].nunique()),
    }
    output.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.output), indent=2))


if __name__ == "__main__":
    main()
