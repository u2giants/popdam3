"""Split item descriptions into reviewable business chunks without changing source data."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd


PRIVATE = Path(__file__).resolve().parents[3] / ".private" / "item-mg-reclassification-20260814"
REFERENCE = Path(__file__).resolve().parents[1] / "coldlion-licensor-property-phase3-20260725" / "designflow-fresh-edges.json"

PRODUCT_PATTERNS = [
    "2pc printed glass shadowbox set", "printed glass shadowbox", "glass shadowbox",
    "setback framed mounted art", "framed mounted art", "mounted art",
    "stretched canvas", "printed canvas", "canvas with floating frame", "canvas w floating frame",
    "canvas with dripping gel paint", "canvas w dripping gel paint", "canvas",
    "diecut mdf photo frame", "die cut mdf photo frame", "mdf photo frame", "photo frame",
    "shaped 2 sided mdf block", "shaped mdf block", "diecut mdf block", "die cut mdf block", "mdf led block", "mdf block",
    "printed wood block", "wood block", "acrylic block", "block",
    "framed wall art", "metal wall art", "wood wall art", "wall art",
    "mdf wall plaque", "wood wall plaque", "wall plaque", "mdf plaque", "plaque",
    "memo board", "letter board", "wall clock", "desktop clock", "clock",
    "lap desk", "desk mat", "desk organizer", "pencil cup", "phone stand", "headphone stand",
    "storage basket", "storage bin", "storage box", "storage ottoman", "storage cube",
    "jewelry box", "music box", "snow globe", "bookend", "book end", "calendar",
    "door hanger", "wall hook", "shelf", "tray", "rug", "floor mat", "garden stake",
]

STOP_NAME_WORDS = {"and", "the", "of", "a", "an", "inc", "company", "entertainment", "studios", "studio", "llc"}


def norm(value: object) -> str:
    text = unicodedata.normalize("NFKD", "" if pd.isna(value) else str(value)).encode("ascii", "ignore").decode().lower()
    text = text.replace("shadow box", "shadowbox").replace("die-cut", "diecut").replace("2-sided", "2 sided")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def load_names() -> tuple[dict, dict]:
    rows = json.loads(REFERENCE.read_text(encoding="utf-8"))
    licensors, properties = {}, {}
    for row in rows:
        division = int(row["division"])
        licensors[(division, str(row["licensor_code"]))] = str(row["licensor_name"]).title()
        properties[(division, str(row["property_code"]))] = str(row["property_name"]).title()
    return licensors, properties


def literal_name(desc: str, canonical: str) -> str:
    if not canonical:
        return ""
    exact = re.search(rf"\b{re.escape(canonical)}\b", desc, flags=re.I)
    if exact:
        return exact.group(0)
    if canonical.upper() == "NBC":
        nbc = re.search(r"\bNBCU\b", desc, flags=re.I)
        if nbc:
            return nbc.group(0)
    wanted = [t for t in norm(canonical).split() if t not in STOP_NAME_WORDS and len(t) >= 3]
    matched = []
    for token in wanted:
        hit = re.search(rf"\b{re.escape(token)}\b", desc, flags=re.I)
        if hit:
            matched.append((hit.start(), hit.group(0)))
    matched.sort()
    return " ".join(value for _, value in matched)


def item_type(desc: str) -> str:
    normalized = norm(desc)
    for phrase in PRODUCT_PATTERNS:
        if re.search(rf"\b{re.escape(phrase)}\b", normalized):
            return phrase.title().replace("Mdf", "MDF").replace("Led", "LED").replace("2 Sided", "2-Sided")
    return ""


def item_size(desc: str) -> tuple[str, str]:
    # Capture the face dimensions for classification and remove the complete dimension block from artwork.
    match = re.search(r"(?<![A-Za-z0-9])(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[\"”″]?)", desc, flags=re.I)
    if not match:
        return "", ""
    face = f"{match.group(1)}x{match.group(2)}\""
    full = re.search(rf"{re.escape(match.group(0))}(?:\s*[x×]\s*\d+(?:\.\d+)?\s*[\"”″]?\s*[dD]?)?", desc[match.start():], flags=re.I)
    removal = full.group(0) if full else match.group(0)
    return face, removal


def remove_once(text: str, value: str) -> str:
    if not value:
        return text
    return re.sub(re.escape(value), " ", text, count=1, flags=re.I)


def remove_product(text: str, product: str) -> str:
    if not product:
        return text
    pieces = []
    for token in norm(product).split():
        if token == "diecut":
            pieces.append(r"die[\s_-]*cut")
        elif token == "2":
            pieces.append(r"2")
        elif token == "sided":
            pieces.append(r"[\s_-]*sided")
        else:
            pieces.append(re.escape(token))
    return re.sub(r"\b" + r"[\s_-]+".join(pieces) + r"\b", " ", text, count=1, flags=re.I)


def main(source_csv: str) -> None:
    PRIVATE.mkdir(parents=True, exist_ok=True)
    licensors, properties = load_names()
    data = pd.read_csv(source_csv, dtype=str, encoding_errors="replace").fillna("")
    output = []
    division_number = {"CW001": 1, "SP001": 8}
    for index, row in data.iterrows():
        desc = str(row["Item Desc"]).strip()
        division = str(row["Division"]).strip()
        div_num = division_number.get(division)
        licensor_master = licensors.get((div_num, str(row["MerchGroup05"]).strip()), "") if div_num else ""
        property_master = properties.get((div_num, str(row["MerchGroup06"]).strip()), "") if div_num else ""
        licensor = literal_name(desc, licensor_master)
        prop = literal_name(desc, property_master)
        product = item_type(desc)
        size, size_literal = item_size(desc)

        artwork = remove_product(desc, product)
        for value in (licensor, prop, size_literal):
            artwork = remove_once(artwork, value)
        artwork = re.sub(r"[�\"”″']?\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|in)?", " ", artwork, flags=re.I)
        artwork = re.sub(r"[_|]+", " ", artwork)
        artwork = re.sub(r"\s+", " ", artwork).strip(" -_,;:/")

        notes = []
        if not product:
            notes.append("Item type needs review")
        if not size:
            notes.append("Size not found")
        if div_num and row["MerchGroup05"] and not licensor_master:
            notes.append("Licensor code not in reference")
        if div_num and row["MerchGroup06"] and not property_master:
            notes.append("Property code not in reference")
        if div_num and licensor_master and not licensor:
            notes.append("Licensor label not found in description")
        if div_num and property_master and not prop:
            notes.append("Property label not found in description")
        if not div_num:
            notes.append("Division uses themes rather than licensor/property")
        confidence = "High" if product and size and not any("not found" in n or "needs review" in n for n in notes) else ("Medium" if product or size else "Review")

        output.append({
            "Source CSV Row": index + 2, "Item #": row["Item #"], "Created Date": row["CreatedTime"],
            "Division": division, "Original Item Desc": desc,
            "Item Type": product, "Item Size": size, "Licensor": licensor, "Property": prop,
            "Artwork Description": artwork, "Extraction Confidence": confidence,
            "Review Notes": "; ".join(notes),
            "MG01": row["MerchGroup01"], "MG02": row["MerchGroup02"], "MG03": row["MerchGroup03"],
            "MG04": row["MerchGroup04"], "MG05": row["MerchGroup05"], "MG06": row["MerchGroup06"],
        })

    result = pd.DataFrame(output)
    result.to_csv(PRIVATE / "item_description_chunks.csv", index=False, encoding="utf-8-sig")
    result.to_json(PRIVATE / "item_description_chunks.json", orient="records", force_ascii=False)
    summary = {
        "rows": len(result), "high": int((result["Extraction Confidence"] == "High").sum()),
        "medium": int((result["Extraction Confidence"] == "Medium").sum()),
        "review": int((result["Extraction Confidence"] == "Review").sum()),
        "item_type_found": int(result["Item Type"].ne("").sum()), "size_found": int(result["Item Size"].ne("").sum()),
        "licensor_found": int(result["Licensor"].ne("").sum()), "property_found": int(result["Property"].ne("").sum()),
    }
    (PRIVATE / "item_description_chunks_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"summary": summary}, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: extract_description_chunks.py <full_item_master.csv>")
    main(sys.argv[1])
