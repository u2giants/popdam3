"""Mine proposed item-type phrases from the complete description history."""

from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd


PRIVATE = Path(__file__).resolve().parents[3] / ".private" / "item-mg-reclassification-20260814"
REFERENCE = Path(__file__).resolve().parents[1] / "coldlion-licensor-property-phase3-20260725" / "designflow-fresh-edges.json"
STOP = {"a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with", "w", "x"}


def norm(value: object) -> str:
    text = unicodedata.normalize("NFKD", "" if pd.isna(value) else str(value)).encode("ascii", "ignore").decode().lower()
    text = text.replace("shadow box", "shadowbox").replace("die-cut", "diecut").replace("screen print", "screenprint")
    text = re.sub(r"\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:mm|in)?", " ", text)
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def name_tokens() -> dict[tuple[int, str, str], set[str]]:
    result = {}
    for row in json.loads(REFERENCE.read_text(encoding="utf-8")):
        words = norm(f"{row['licensor_name']} {row['property_name']}").split()
        result[(int(row["division"]), str(row["licensor_code"]), str(row["property_code"]))] = {
            word for word in words if len(word) >= 3 and word not in STOP
        }
    return result


def main(source_csv: str) -> None:
    PRIVATE.mkdir(parents=True, exist_ok=True)
    data = pd.read_csv(source_csv, dtype=str, encoding_errors="replace").fillna("")
    known_names = name_tokens()
    division_number = {"CW001": 1, "SP001": 8}
    gram_rows: dict[str, set[int]] = defaultdict(set)
    gram_classes: dict[str, Counter] = defaultdict(Counter)
    gram_mg05: dict[str, set[str]] = defaultdict(set)
    cleaned_rows = []

    for idx, row in data.iterrows():
        text_tokens = norm(row["Item Desc"]).split()
        key = (division_number.get(row["Division"], -1), row["MerchGroup05"], row["MerchGroup06"])
        names = known_names.get(key, set())
        filtered = [token for token in text_tokens if token not in names and token not in STOP and not token.isdigit()]
        cleaned_rows.append(filtered)
        label = "|".join(str(row[col]) for col in ("MerchGroup01", "MerchGroup02", "MerchGroup03"))
        for size in range(2, 8):
            for start in range(len(filtered) - size + 1):
                gram = " ".join(filtered[start:start + size])
                gram_rows[gram].add(idx)
                gram_classes[gram][label] += 1
                gram_mg05[gram].add(str(row["MerchGroup05"]))

    candidates = []
    for phrase, indexes in gram_rows.items():
        count = len(indexes)
        if count < 2:
            continue
        classes = gram_classes[phrase]
        dominant, dominant_count = classes.most_common(1)[0]
        purity = dominant_count / sum(classes.values())
        token_count = len(phrase.split())
        diversity = len({x for x in gram_mg05[phrase] if x})
        if purity < 0.80 or (count < 4 and token_count < 3):
            continue
        if diversity < 2 and count < 8:
            continue
        examples = [str(data.loc[i, "Item Desc"]) for i in sorted(indexes)[:3]]
        score = token_count * token_count * math.log1p(count) * purity * (1 + min(diversity, 5) / 10)
        candidates.append({
            "Proposed Phrase": phrase.title(), "Word Count": token_count, "Item Count": count,
            "Dominant MG01-MG03": dominant, "MG Agreement": round(purity * 100, 1),
            "Distinct MG05 Codes": diversity, "Score": round(score, 2),
            "Example 1": examples[0] if examples else "", "Example 2": examples[1] if len(examples) > 1 else "",
            "Example 3": examples[2] if len(examples) > 2 else "",
        })

    raw = pd.DataFrame(candidates).sort_values(["Score", "Item Count"], ascending=False)
    # Keep the strongest phrase in each nested wording family, but retain meaningful
    # variants whose usage differs by at least 20%.
    selected = []
    for row in raw.to_dict(orient="records"):
        phrase = row["Proposed Phrase"].lower()
        redundant = False
        for kept in selected:
            other = kept["Proposed Phrase"].lower()
            if row["Dominant MG01-MG03"] != kept["Dominant MG01-MG03"]:
                continue
            if phrase in other or other in phrase:
                ratio = min(row["Item Count"], kept["Item Count"]) / max(row["Item Count"], kept["Item Count"])
                if ratio >= 0.80:
                    redundant = True
                    break
        if not redundant:
            selected.append(row)
        if len(selected) >= 750:
            break

    result = pd.DataFrame(selected)
    result.insert(0, "Review Decision", "")
    result.insert(1, "Preferred Item-Type Phrase", result["Proposed Phrase"])
    result.to_csv(PRIVATE / "proposed_item_type_phrase_list.csv", index=False, encoding="utf-8-sig")
    result.to_json(PRIVATE / "proposed_item_type_phrase_list.json", orient="records", force_ascii=False)
    raw.head(3000).to_csv(PRIVATE / "raw_item_type_phrase_candidates.csv", index=False, encoding="utf-8-sig")
    raw.head(3000).to_json(PRIVATE / "raw_item_type_phrase_candidates.json", orient="records", force_ascii=False)
    summary = {"descriptions": len(data), "raw_candidates": len(raw), "proposed_phrases": len(result)}
    (PRIVATE / "proposed_item_type_phrase_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    crumb = result[result["Proposed Phrase"].str.contains("Crumb Rubber", case=False, na=False)]
    print(json.dumps({"summary": summary, "crumb_rubber_candidates": crumb.head(20).to_dict(orient="records")}, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: mine_item_type_phrases.py <full_item_master.csv>")
    main(sys.argv[1])
