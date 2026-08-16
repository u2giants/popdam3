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
REWORK = Path(__file__).resolve().parent / "data" / "MerchGroup_Rework.xlsx"


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFKD", "" if pd.isna(value) else str(value)).encode("ascii", "ignore").decode().lower()
    text = text.replace("shadow box", "shadowbox").replace("die-cut", "diecut")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def dimension_signature(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower().replace("×", "x")
    match = re.search(
        r"(?<![a-z0-9])(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*[\"']?\s*x\s*(\d+(?:\.\d+)?))?",
        text,
    )
    if not match:
        return ""
    face = sorted(float(value) for value in match.groups()[:2])
    result = f"{face[0]:g}x{face[1]:g}"
    if match.group(3):
        result += f"x{float(match.group(3)):g}"
    return result


def treatment_profile(value: object) -> str:
    text = normalized(value).replace("holo foil", "holofoil")
    treatments = []
    patterns = (
        ("foil", r"\b(?:holofoil|foil)\b"),
        ("high-gloss", r"\b(?:hi gloss|high gloss|gloss)\b"),
        ("embroidery", r"\b(?:embroidery|embroidered|chenille)\b"),
        ("diy", r"\b(?:diy|pbn|paint by numbers?|paint your own|paint pots?|blank artist canvas)\b"),
        ("led", r"\b(?:led|light up|lighted)\b"),
        ("glitter", r"\b(?:glitter|sequins?|rhinestones?|diamond dust|crystal gravel)\b"),
        ("handpaint", r"\b(?:handpaint|hand painted)\b"),
        ("attachment", r"\b(?:attachment|physical attachment)\b"),
        ("gel", r"\b(?:gel coat|gel coated|gel paint)\b"),
        ("staggered", r"\bstaggered\b"),
        ("spot-varnish", r"\bspot varnish\b"),
        ("metallic-paint", r"\b(?:dripping metallic paint|metallic puffpaint)\b"),
        ("distressed", r"\bdistressed\b"),
        ("varnish", r"\bvarnish\b"),
        ("gravel", r"\bgravel\b"),
        ("shaped", r"\b(?:shaped|diecut|round)\b"),
    )
    for name, pattern in patterns:
        if re.search(pattern, text):
            treatments.append(name)
    return "+".join(treatments)


def classification_product(product_wording: object, description: object) -> str:
    """Return the physical product family without treatment, artwork, or size."""
    wording = normalized(product_wording)
    desc = normalized(description)
    if re.search(r"\b(?:storage bin|eva bin)\b", desc):
        return "storage bin"
    if "canvas tapestry" in desc or ("tapestry" in desc and "canvas" in desc):
        return "canvas tapestry"
    if "hamper" in desc and wording in {"canvas", "printed canvas", ""}:
        return "hamper"
    if "canvas" in wording or "canvas" in desc:
        return "canvas"
    wording = re.sub(
        r"\b(?:printed|print|diy|pbn|gloss|high gloss|hi gloss|foil|holofoil|led|lighted|"
        r"glitter|sequins?|rhinestones?|handpainted?|gel coated?|embroidery|embroidered)\b",
        " ",
        wording,
    )
    return " ".join(wording.split())


def construction_profile(value: object) -> str:
    """Keep physical construction distinctions while excluding artwork wording."""
    text = normalized(value)
    features = []
    for name, pattern in (
        ("floater-frame", r"\b(?:floater|floating|float) frame\b"),
        ("setback-frame", r"\bsetback frame(?:d)?\b"),
        ("framed", r"\bframed\b"),
        ("metallic", r"\bmetallic canvas\b"),
        ("two-sided", r"\b(?:2 sided|two sided)\b"),
        ("hanging", r"\bhanging\b"),
    ):
        if re.search(pattern, text):
            features.append(name)
    return "+".join(features) or "standard"


def assign_from_semantic_evidence(row: pd.Series, candidates: list[dict], meaning_by_key: dict[str, str]) -> dict:
    """Classify from physical semantics and later-key counts, never artwork similarity."""
    if not row["Classification Product"] or row["Classification Product"] in {"test", "fees", "mdpd fees"} or not candidates:
        return {}

    counts = Counter(candidate["key"] for candidate in candidates)
    ranked = counts.most_common()
    top_key, top_count = ranked[0]
    runner_count = ranked[1][1] if len(ranked) > 1 else 0
    total = sum(counts.values())
    share = top_count / total
    lead = top_count / max(runner_count, 1)
    explicit_treatment = bool(row["Treatment Profile"])
    specific_product = len(row["Classification Product"].split()) >= 2
    specific_construction = row["Construction Profile"] != "standard"

    full = False
    if len(counts) == 1:
        full = total >= 2 or explicit_treatment or specific_product or specific_construction
    elif explicit_treatment:
        full = top_count >= 3 and share >= 0.70 and lead >= 2
    else:
        full = top_count >= 5 and share >= 0.85 and lead >= 3

    pair_counts = Counter("|".join(key.split("|")[:2]) for key in counts.elements())
    pair_ranked = pair_counts.most_common()
    top_pair, pair_count = pair_ranked[0]
    pair_runner = pair_ranked[1][1] if len(pair_ranked) > 1 else 0
    pair_share = pair_count / total
    partial = not full and pair_count >= 3 and pair_share >= 0.80 and pair_count >= 2 * max(pair_runner, 1)
    if not full and not partial:
        return {
            "confidence": "Unresolved",
            "distribution": "; ".join(f"{key}: {count}" for key, count in ranked),
            "consensus": round(share * 100, 1),
            "reason": "Semantic peers do not identify one complete MG key with enough consistency",
        }

    chosen_key = top_key if full else ""
    chosen_pair = "|".join(top_key.split("|")[:2]) if full else top_pair
    eligible = [
        candidate for candidate in candidates
        if candidate["key"] == top_key or (partial and "|".join(candidate["key"].split("|")[:2]) == chosen_pair)
    ]
    old_size = dimension_signature(row["Original Item Desc"])
    # Size and recency choose only the displayed evidence row. Artwork wording is never scored.
    def display_score(candidate: dict) -> tuple[float, float]:
        size_bonus = 1.0 if old_size and old_size == candidate["size"] else 0.0
        return (size_bonus, candidate["date_order"])
    best = max(eligible, key=display_score)
    distribution = "; ".join(f"{key}: {count}" for key, count in ranked)
    semantic_signature = f"{row['Classification Product']} | {row['Construction Profile']} | {row['Treatment Profile'] or 'treatment not stated'}"
    if full:
        reason = (
            f"Semantic signature {semantic_signature}. Later-key evidence: {distribution}. "
            f"Selected meaning: {meaning_by_key.get(top_key, 'definition unavailable')}."
        )
    else:
        reason = (
            f"Semantic signature {semantic_signature}. Later evidence supports {chosen_pair}, "
            f"but MG03 remains unresolved. Full-key evidence: {distribution}."
        )
    return {
        **best, "evidence_key": best["key"], "key": chosen_key, "pair": chosen_pair, "confidence": "High" if full else "Partial",
        "distribution": distribution, "consensus": round((share if full else pair_share) * 100, 1), "reason": reason,
    }


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
    meaning_by_key = {group["MG Primary Key"]: group["Combined Product Meaning"] for group in groups}
    post["Classification Product"] = post.apply(
        lambda row: classification_product(row["Canonical Product Wording"], row["Original Item Desc"]), axis=1
    )
    post["Construction Profile"] = post["Original Item Desc"].map(construction_profile)
    post["Treatment Profile"] = post["Original Item Desc"].map(treatment_profile)
    exact_peers = defaultdict(list)
    product_peers = defaultdict(list)
    for _, later in post[post["Complete MG Key"]].iterrows():
        candidate = {
            "key": later["MG Key"], "item": later["Item #"], "description": later["Original Item Desc"],
            "date": later["Created Date"], "source_row": later["Source CSV Row"],
            "date_order": int(later["Date"].value) if not pd.isna(later["Date"]) else 0,
            "size": dimension_signature(later["Original Item Desc"]),
        }
        exact_peers[(later["Classification Product"], later["Construction Profile"], later["Treatment Profile"])].append(candidate)
        product_peers[(later["Classification Product"], later["Construction Profile"])].append(candidate)
    pre["Classification Product"] = pre.apply(
        lambda row: classification_product(row["Extracted Product Wording"], row["Original Item Desc"]), axis=1
    )
    pre["Construction Profile"] = pre["Original Item Desc"].map(construction_profile)
    pre["Treatment Profile"] = pre["Original Item Desc"].map(treatment_profile)
    assignments = []
    for _, old in pre.iterrows():
        exact_key = (old["Classification Product"], old["Construction Profile"], old["Treatment Profile"])
        broad_key = (old["Classification Product"], old["Construction Profile"])
        candidates = exact_peers.get(exact_key, []) if old["Treatment Profile"] else product_peers.get(broad_key, [])
        assignments.append(assign_from_semantic_evidence(old, candidates, meaning_by_key))
    proposed_parts = [
        (match.get("key") or match.get("pair") or "").split("|") if match else [] for match in assignments
    ]
    pre["Proposed MG01"] = [parts[0] if len(parts) > 0 else "" for parts in proposed_parts]
    pre["Proposed MG02"] = [parts[1] if len(parts) > 1 else "" for parts in proposed_parts]
    pre["Proposed MG03"] = [parts[2] if len(parts) > 2 else "" for parts in proposed_parts]
    pre["Matched Later Item #"] = [match.get("item", "") for match in assignments]
    pre["Matched Later Item Desc"] = [match.get("description", "") for match in assignments]
    pre["Matched Later Date"] = [match.get("date", "") for match in assignments]
    pre["Matched Later MG Key"] = [match.get("evidence_key", "") for match in assignments]
    pre["Later MG Key Distribution"] = [match.get("distribution", "") for match in assignments]
    pre["Evidence Consensus %"] = [match.get("consensus", "") for match in assignments]
    pre["MG Evidence"] = [match.get("reason", "") for match in assignments]
    statuses = []
    for (_, old), match in zip(pre.iterrows(), assignments):
        if match.get("confidence") == "High":
            current = "|".join(str(old[column]).strip() for column in ("MG01", "MG02", "MG03"))
            statuses.append("High-confidence later analog; current MG differs" if current != match["key"] else "High-confidence later analog; current MG agrees")
        elif match.get("confidence") == "Partial":
            statuses.append("MG01 and MG02 supported; MG03 unresolved")
        elif old["Extracted Product Wording"]:
            statuses.append("Product wording extracted; MG unresolved")
        else:
            statuses.append("Product wording unresolved")
    pre["MG Assignment Status"] = statuses
    pre_records = pre.drop(columns=["Date", "Chunk Item Type"]).to_dict(orient="records")
    evidence_groups_by_signature = defaultdict(list)
    for (_, old), match in zip(pre.iterrows(), assignments):
        signature = (old["Classification Product"], old["Construction Profile"], old["Treatment Profile"])
        evidence_groups_by_signature[signature].append((old, match))
    evidence_groups = []
    rank = {"High": 3, "Partial": 2, "Unresolved": 1, "": 0}
    for signature, entries in sorted(evidence_groups_by_signature.items()):
        representative_old, representative_match = max(entries, key=lambda entry: rank.get(entry[1].get("confidence", ""), 0))
        confidence = representative_match.get("confidence", "Unresolved")
        proposed = representative_match.get("key") or representative_match.get("pair") or ""
        evidence_groups.append({
            "Physical Product": signature[0],
            "Construction / Shape": signature[1],
            "Treatment": signature[2] or "Not stated",
            "Historical Item Count": len(entries),
            "Decision Level": "Complete MG key" if confidence == "High" else ("MG01+MG02 only" if confidence == "Partial" else "Unresolved"),
            "Proposed MG Key": proposed,
            "Later Full-Key Distribution": representative_match.get("distribution", "No comparable later items"),
            "Evidence Consensus %": representative_match.get("consensus", ""),
            "Selected Rework Meaning": meaning_by_key.get(proposed, "") if confidence == "High" else "",
            "Decision Trace": representative_match.get("reason", "No comparable later semantic signature"),
            "Artwork Used in Decision": "No",
            "Example Historical Description": representative_old["Original Item Desc"],
            "Example Supporting Later Item": representative_match.get("description", ""),
            "Reviewer Decision": "",
            "Reviewer Notes": "",
        })
    decision_order = {"Complete MG key": 0, "MG01+MG02 only": 1, "Unresolved": 2}
    evidence_groups.sort(key=lambda row: (
        decision_order[row["Decision Level"]],
        row["Physical Product"] == "",
        row["Physical Product"], row["Construction / Shape"], row["Treatment"],
    ))
    assigned_count = sum(match.get("confidence") == "High" for match in assignments)
    partial_count = sum(match.get("confidence") == "Partial" for match in assignments)
    changed_count = sum(
        match.get("confidence") == "High" and "|".join(str(old[column]).strip() for column in ("MG01", "MG02", "MG03")) != match["key"]
        for (_, old), match in zip(pre.iterrows(), assignments)
    )
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
        "pre_change_high_confidence_mg_assignments": assigned_count,
        "pre_change_partial_mg_assignments": partial_count,
        "pre_change_high_confidence_mg_changes": changed_count,
        "historical_semantic_signatures": len(evidence_groups),
    }
    for name, value in {
        "mg_key_groups.json": groups, "mg_post_change_rows.json": detail_records,
        "mg_pre_change_rows.json": pre_records, "mg_semantic_evidence_groups.json": evidence_groups,
        "mg_keyed_summary.json": summary,
    }.items():
        (PRIVATE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
