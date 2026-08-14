"""Reproducible description-based audit of pre-2025-05-14 item MG01-MG04 codes."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd
CUTOFF = pd.Timestamp("2025-05-14")
MG = ["MerchGroup01", "MerchGroup02", "MerchGroup03", "MerchGroup04"]
PUBLIC_OUTPUT = Path(__file__).resolve().parent
OUTPUT = PUBLIC_OUTPUT.parents[2] / ".private" / "item-mg-reclassification-20260814"


def clean(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip()


def normalize_description(value: object) -> str:
    text = unicodedata.normalize("NFKD", clean(value)).encode("ascii", "ignore").decode()
    text = text.lower().replace("&", " and ")
    text = re.sub(r"\b(inches|inch|in)\b", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def tuple_text(row: pd.Series) -> str:
    return "|".join(clean(row[col]) for col in MG)


def primary_dimensions(value: object) -> str:
    text = clean(value).lower().replace("×", "x")
    match = re.search(r"(?<![a-z0-9])(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)", text)
    if not match:
        return ""
    return f"{float(match.group(1)):g}x{float(match.group(2)):g}"


def main(source_csv: str) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    data = pd.read_csv(source_csv, dtype=str, encoding_errors="replace").fillna("")
    data["CreatedDate"] = pd.to_datetime(data["CreatedTime"], errors="raise")
    data["NormalizedDesc"] = data["Item Desc"].map(normalize_description)
    data["MG_Tuple"] = data.apply(tuple_text, axis=1)
    data["PrimaryDimensions"] = data["Item Desc"].map(primary_dimensions)
    data["SourceRow"] = data.index + 2

    old = data[data["CreatedDate"] < CUTOFF].copy()
    new = data[data["CreatedDate"] >= CUTOFF].copy()

    # New-method descriptions teach the expected MG tuple. Conflicting tuples for the
    # same normalized description are retained but cannot create a high-confidence result.
    exact_groups: dict[str, list[int]] = defaultdict(list)
    for idx, desc in new["NormalizedDesc"].items():
        if desc:
            exact_groups[desc].append(idx)

    # Fuzzy search uses one representative per normalized description. The best result
    # must be extremely close, clearly better than runner-up, and unanimously coded.
    new_descs = list(exact_groups)
    desc_dimensions = {
        desc: clean(new.loc[indexes[0], "PrimaryDimensions"])
        for desc, indexes in exact_groups.items()
    }
    token_index: dict[str, set[str]] = defaultdict(set)
    for desc in new_descs:
        for token in set(desc.split()):
            if len(token) >= 3:
                token_index[token].add(desc)
    result_rows = []
    for _, row in old.iterrows():
        norm = row["NormalizedDesc"]
        meaningful = len(norm) >= 20 and len(norm.split()) >= 4 and norm not in {"test", "testing"}
        candidates: list[int] = []
        method = "No reliable match"
        score = 0.0
        runner_up = 0.0
        if meaningful and norm in exact_groups:
            candidates = exact_groups[norm]
            method = "Exact normalized description"
            score = 100.0
        elif meaningful and new_descs:
            pool: set[str] = set()
            tokens = set(norm.split())
            for token in tokens:
                pool.update(token_index.get(token, ()))
            # Token overlap makes the search tractable and blocks accidental matches
            # based only on generic punctuation or dimensions.
            ranked = []
            for candidate in pool:
                candidate_dims = desc_dimensions[candidate]
                old_dims = clean(row["PrimaryDimensions"])
                if old_dims and candidate_dims and old_dims != candidate_dims:
                    continue
                ctokens = set(candidate.split())
                overlap = len(tokens & ctokens) / max(1, len(tokens | ctokens))
                if overlap >= 0.55:
                    ranked.append((SequenceMatcher(None, norm, candidate).ratio() * 100, candidate))
            ranked.sort(reverse=True)
            if ranked:
                score = float(ranked[0][0])
                runner_up = float(ranked[1][0]) if len(ranked) > 1 else 0.0
                best_desc = ranked[0][1]
                # Require 95+ and a visible lead. A uniquely excellent 99+ match may
                # pass with a smaller lead because duplicated wording is common.
                if score >= 95 and (score - runner_up >= 3 or score >= 99):
                    candidates = exact_groups[best_desc]
                    method = "Near-exact description"

        tuple_counts = Counter(new.loc[candidates, "MG_Tuple"]) if candidates else Counter()
        expected = tuple_counts.most_common(1)[0][0] if tuple_counts else ""
        unanimous = bool(tuple_counts) and len(tuple_counts) == 1
        confidence = "High" if candidates and unanimous and score >= 95 else "Unresolved"
        if candidates and not unanimous:
            method = "Conflicting newer classifications"

        expected_parts = expected.split("|") if expected else [""] * 4
        current_parts = [clean(row[c]) for c in MG]
        comparison = "Unresolved"
        if confidence == "High":
            comparison = "Correct" if current_parts == expected_parts else "Change needed"

        best_idx = candidates[0] if candidates else None
        best = new.loc[best_idx] if best_idx is not None else None
        result_rows.append({
            "Source CSV Row": int(row["SourceRow"]),
            "Old Item #": clean(row["Item #"]),
            "Old Item Desc": clean(row["Item Desc"]),
            "Created Date": row["CreatedDate"].strftime("%Y-%m-%d"),
            "Division": clean(row["Division"]),
            "Current MG01": current_parts[0], "Current MG02": current_parts[1],
            "Current MG03": current_parts[2], "Current MG04": current_parts[3],
            "Audit Result": comparison,
            "Suggested MG01": expected_parts[0], "Suggested MG02": expected_parts[1],
            "Suggested MG03": expected_parts[2], "Suggested MG04": expected_parts[3],
            "Confidence": confidence,
            "Match Method": method,
            "Description Score": round(score, 1),
            "Runner-up Score": round(runner_up, 1),
            "Newer Matches": len(candidates),
            "Matched New Item #": clean(best["Item #"]) if best is not None else "",
            "Matched New Item Desc": clean(best["Item Desc"]) if best is not None else "",
            "Matched New Date": best["CreatedDate"].strftime("%Y-%m-%d") if best is not None else "",
            "Matched New Source Row": int(best["SourceRow"]) if best is not None else "",
        })

    results = pd.DataFrame(result_rows)
    results.to_csv(OUTPUT / "pre_cutoff_item_mg_audit.csv", index=False, encoding="utf-8-sig")
    results.to_json(OUTPUT / "pre_cutoff_item_mg_audit.json", orient="records", force_ascii=False)
    results[results["Audit Result"] == "Change needed"].to_csv(
        OUTPUT / "high_confidence_changes.csv", index=False, encoding="utf-8-sig"
    )
    results[results["Audit Result"] == "Change needed"].to_json(
        OUTPUT / "high_confidence_changes.json", orient="records", force_ascii=False
    )

    summary = {
        "source_csv": str(Path(source_csv).resolve()),
        "cutoff_rule": "Old: through 2025-05-13; new: starting 2025-05-14",
        "total_items": len(data), "old_items": len(old), "new_items": len(new),
        "old_missing_description": int((old["NormalizedDesc"] == "").sum()),
        "high_confidence_total": int((results["Confidence"] == "High").sum()),
        "correct": int((results["Audit Result"] == "Correct").sum()),
        "change_needed": int((results["Audit Result"] == "Change needed").sum()),
        "unresolved": int((results["Audit Result"] == "Unresolved").sum()),
        "exact_high_confidence": int(((results["Confidence"] == "High") & (results["Match Method"] == "Exact normalized description")).sum()),
        "near_exact_high_confidence": int(((results["Confidence"] == "High") & (results["Match Method"] == "Near-exact description")).sum()),
        "generated_utc": pd.Timestamp.now("UTC").isoformat(),
    }
    (OUTPUT / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    public_summary = dict(summary)
    public_summary["source_csv"] = "full_item_master.csv (local confidential source)"
    (PUBLIC_OUTPUT / "summary.json").write_text(json.dumps(public_summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: analyze_item_history.py <full_item_master.csv>")
    main(sys.argv[1])
