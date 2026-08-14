"""Audit old MG01-MG04 using product-construction and size, not whole descriptions."""

from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl
import pandas as pd


CUTOFF = pd.Timestamp("2025-05-14")
MG = ["MerchGroup01", "MerchGroup02", "MerchGroup03", "MerchGroup04"]
PUBLIC = Path(__file__).resolve().parent
PRIVATE = PUBLIC.parents[2] / ".private" / "item-mg-reclassification-20260814"
STOP = {
    "a", "an", "and", "at", "by", "for", "from", "in", "into", "of", "on", "the", "to", "with",
    "w", "x", "design", "art", "artwork", "says", "message", "scene", "portrait", "pattern",
    "black", "blue", "brown", "gold", "green", "grey", "gray", "navy", "orange", "pink", "purple",
    "red", "silver", "teal", "white", "yellow", "multi", "color", "colour", "background",
}
MANUAL_PRODUCT_WORDS = {
    "acrylic", "attachment", "bank", "basket", "block", "board", "box", "canvas", "ceramic", "clock",
    "collage", "countdown", "decal", "deskmat", "diamond", "diecut", "dimensional", "dust", "easel",
    "embroidery", "fabric", "felt", "foil", "frame", "framed", "gel", "glass", "glitter", "globe",
    "greyboard", "hanger", "hanging", "holder", "hook", "led", "lenticular", "light", "lightup", "linen",
    "mat", "matting", "mdf", "memo", "metal", "metallic", "mirror", "molded", "mounted", "ottoman",
    "paper", "photo", "plaque", "plastic", "polyresin", "print", "printed", "pu", "relief", "rug",
    "screenprint", "set", "shadowbox", "shaped", "shelf", "sign", "snow", "stretched", "string", "tapestry",
    "tray", "wall", "wood", "woven",
}
CANONICAL_PRODUCTS = [
    r"printed glass shadowbox", r"glass shadowbox", r"printed canvas", r"stretched canvas",
    r"framed mounted art", r"mounted art", r"photo frame", r"mdf block", r"wood block",
    r"wall plaque", r"mdf plaque", r"memo board", r"letter board", r"wall clock",
    r"desk mat", r"lap desk", r"storage bin", r"storage box", r"jewelry box",
    r"snow globe", r"shadowbox", r"canvas", r"wall art",
]
ENHANCEMENTS = [
    "diamond dust", "glitter", "foil", "attachment", "deckle edge", "metallic paper",
    "gel paint", "gel coat", "led", "lightup", "diecut", "shaped", "holofoil",
]


def clean(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip()


def normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", clean(value)).encode("ascii", "ignore").decode().lower()
    text = text.replace("shadow box", "shadowbox").replace("die-cut", "diecut").replace("screen print", "screenprint")
    text = re.sub(r"\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def dimensions(value: object) -> str:
    text = clean(value).lower().replace("×", "x")
    match = re.search(r"(?<![a-z0-9])(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)", text)
    if not match:
        return ""
    nums = sorted([float(match.group(1)), float(match.group(2))])
    return f"{nums[0]:g}x{nums[1]:g}"


def tokens(value: object) -> list[str]:
    return [t for t in normalize(value).split() if t not in STOP and not t.isdigit()]


def canonical_product(value: object) -> str:
    text = normalize(value)
    for pattern in CANONICAL_PRODUCTS:
        if re.search(rf"\b{pattern}\b", text):
            return pattern
    return ""


def enhancement_profile(value: object) -> str:
    text = normalize(value)
    found = [term for term in ENHANCEMENTS if term in text]
    return "+".join(found) if found else "plain"


def taxonomy_words(workbook_path: str) -> set[str]:
    wb = openpyxl.load_workbook(workbook_path, data_only=True, read_only=True)
    ws = wb["Final Version"]
    words = set(MANUAL_PRODUCT_WORDS)
    for row in ws.iter_rows(min_row=4, values_only=True):
        for idx in (2, 4, 6):
            words.update(tokens(row[idx]))
    return words


def ngrams(ts: list[str], vocab: set[str]) -> set[str]:
    found = set()
    for size in (2, 3, 4, 5):
        for i in range(len(ts) - size + 1):
            gram = ts[i:i + size]
            product_count = sum(t in vocab for t in gram)
            if product_count >= 2 or (product_count == 1 and size >= 3):
                found.add(" ".join(gram))
    return found


def class3(row: pd.Series) -> str:
    return "|".join(clean(row[c]) for c in MG[:3])


def build_rules(new: pd.DataFrame, vocab: set[str]) -> dict[str, dict]:
    counts: dict[str, Counter] = defaultdict(Counter)
    for _, row in new.iterrows():
        label = row["Class3"]
        if not label or "||" in label:
            continue
        for gram in ngrams(row["Tokens"], vocab):
            counts[gram][label] += 1
    rules = {}
    for gram, by_class in counts.items():
        total = sum(by_class.values())
        label, top = by_class.most_common(1)[0]
        purity = top / total
        if total >= 3 and purity >= 0.90:
            rules[gram] = {"label": label, "support": total, "top": top, "purity": purity}
    return rules


def predict(row: pd.Series, rules: dict[str, dict], vocab: set[str]) -> tuple[str, str, float, int]:
    matches = []
    for gram in ngrams(row["Tokens"], vocab):
        rule = rules.get(gram)
        if rule:
            weight = (len(gram.split()) ** 2) * math.log1p(rule["top"]) * (rule["purity"] ** 3)
            matches.append((gram, rule, weight))
    if not matches:
        return "", "", 0.0, 0
    votes = Counter()
    for _, rule, weight in matches:
        votes[rule["label"]] += weight
    ranked = votes.most_common()
    best, best_score = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    share = best_score / sum(votes.values())
    lead = best_score / max(second, 0.0001)
    best_rules = [(g, r, w) for g, r, w in matches if r["label"] == best]
    best_rules.sort(key=lambda x: (len(x[0].split()), x[1]["purity"], x[1]["top"]), reverse=True)
    evidence = best_rules[0]
    strong = share >= 0.90 and lead >= 4 and evidence[1]["purity"] >= 0.95 and evidence[1]["top"] >= 3
    return (best if strong else ""), evidence[0], round(share * 100, 1), evidence[1]["top"]


def main(source_csv: str, taxonomy_xlsx: str) -> None:
    PRIVATE.mkdir(parents=True, exist_ok=True)
    data = pd.read_csv(source_csv, dtype=str, encoding_errors="replace").fillna("")
    data["CreatedDate"] = pd.to_datetime(data["CreatedTime"], errors="raise")
    data["Tokens"] = data["Item Desc"].map(tokens)
    data["Dimensions"] = data["Item Desc"].map(dimensions)
    data["Class3"] = data.apply(class3, axis=1)
    data["CanonicalProduct"] = data["Item Desc"].map(canonical_product)
    data["EnhancementProfile"] = data["Item Desc"].map(enhancement_profile)
    data["SourceRow"] = data.index + 2
    old = data[data["CreatedDate"] < CUTOFF].copy()
    new = data[data["CreatedDate"] >= CUTOFF].copy()
    vocab = taxonomy_words(taxonomy_xlsx)
    rules = build_rules(new, vocab)

    canonical_classes: dict[tuple[str, str], Counter] = defaultdict(Counter)
    for _, row in new.iterrows():
        key = (row["CanonicalProduct"], row["EnhancementProfile"])
        if key[0]:
            canonical_classes[key][row["Class3"]] += 1

    size_codes: dict[tuple[str, str], Counter] = defaultdict(Counter)
    new_by_key: dict[tuple[str, str], list[int]] = defaultdict(list)
    for idx, row in new.iterrows():
        key = (row["Class3"], row["Dimensions"])
        if all(key):
            size_codes[key][clean(row["MerchGroup04"])] += 1
            new_by_key[key].append(idx)

    output = []
    for _, row in old.iterrows():
        predicted3, signature, class_score, rule_support = predict(row, rules, vocab)
        canonical_key = (row["CanonicalProduct"], row["EnhancementProfile"])
        canonical_counter = canonical_classes.get(canonical_key, Counter())
        if canonical_counter:
            canonical_label, canonical_top = canonical_counter.most_common(1)[0]
            canonical_total = sum(canonical_counter.values())
            canonical_share = canonical_top / canonical_total
            if canonical_top >= 3 and canonical_share >= 0.95:
                predicted3 = canonical_label
                signature = f"{canonical_key[0]} [{canonical_key[1]}]"
                class_score = round(canonical_share * 100, 1)
                rule_support = canonical_top
        suggested = predicted3.split("|") if predicted3 else ["", "", ""]
        size_counter = size_codes.get((predicted3, row["Dimensions"]), Counter()) if predicted3 else Counter()
        size_code = ""
        size_consensus = 0.0
        if size_counter:
            size_code, n = size_counter.most_common(1)[0]
            size_consensus = n / sum(size_counter.values())
            if size_consensus < 0.80 or not size_code:
                size_code = ""

        confidence = "High" if predicted3 and size_code else "Unresolved"
        expected = suggested + [size_code]
        current = [clean(row[c]) for c in MG]
        result = "Unresolved"
        if confidence == "High":
            result = "Correct" if current == expected else "Change needed"

        evidence_rows = new_by_key.get((predicted3, row["Dimensions"]), [])
        best_idx = evidence_rows[0] if evidence_rows else None
        if evidence_rows and signature:
            sig_tokens = set(signature.split())
            best_idx = max(evidence_rows, key=lambda i: len(sig_tokens & set(new.loc[i, "Tokens"])))
        best = new.loc[best_idx] if best_idx is not None else None
        output.append({
            "Source CSV Row": int(row["SourceRow"]), "Old Item #": clean(row["Item #"]),
            "Old Item Desc": clean(row["Item Desc"]), "Created Date": row["CreatedDate"].strftime("%Y-%m-%d"),
            "Division": clean(row["Division"]), "Product Signature": signature,
            "Extracted Size": row["Dimensions"],
            "Current MG01": current[0], "Current MG02": current[1], "Current MG03": current[2], "Current MG04": current[3],
            "Audit Result": result,
            "Suggested MG01": expected[0], "Suggested MG02": expected[1], "Suggested MG03": expected[2], "Suggested MG04": expected[3],
            "Confidence": confidence, "Product-Class Score": class_score, "Rule Support": rule_support,
            "Size Consensus": round(size_consensus * 100, 1), "Newer Same Product-Size": len(evidence_rows),
            "Matched New Item #": clean(best["Item #"]) if best is not None else "",
            "Matched New Item Desc": clean(best["Item Desc"]) if best is not None else "",
            "Matched New Date": best["CreatedDate"].strftime("%Y-%m-%d") if best is not None else "",
            "Matched New Source Row": int(best["SourceRow"]) if best is not None else "",
        })

    results = pd.DataFrame(output)
    changes = results[results["Audit Result"] == "Change needed"]
    results.to_csv(PRIVATE / "pre_cutoff_item_mg_audit_v2.csv", index=False, encoding="utf-8-sig")
    results.to_json(PRIVATE / "pre_cutoff_item_mg_audit_v2.json", orient="records", force_ascii=False)
    changes.to_csv(PRIVATE / "high_confidence_changes_v2.csv", index=False, encoding="utf-8-sig")
    changes.to_json(PRIVATE / "high_confidence_changes_v2.json", orient="records", force_ascii=False)

    summary = {
        "method_version": 2,
        "cutoff_rule": "Old: through 2025-05-13; new: starting 2025-05-14",
        "total_items": len(data), "old_items": len(old), "new_items": len(new),
        "high_confidence_total": int((results["Confidence"] == "High").sum()),
        "correct": int((results["Audit Result"] == "Correct").sum()),
        "change_needed": int((results["Audit Result"] == "Change needed").sum()),
        "unresolved": int((results["Audit Result"] == "Unresolved").sum()),
        "learned_product_rules": len(rules),
        "generated_utc": pd.Timestamp.now("UTC").isoformat(),
    }
    (PRIVATE / "summary_v2.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    public = {k: v for k, v in summary.items() if k != "required_example"}
    (PUBLIC / "summary_v2.json").write_text(json.dumps(public, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: analyze_product_signature_v2.py <full_item_master.csv> <MerchGroup_Rework.xlsx>")
    main(sys.argv[1], sys.argv[2])
