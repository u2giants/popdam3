"""Source-stated finishes from bounded physical-product wording.

The caller identifies the physical noun.  This module never searches a complete
description for a treatment: artwork and property wording after that noun may
contain the same words.  A short modifier adjoining the noun, a contiguous
physical suffix, or a whole underscore-delimited finish clause is evidence.
"""

from __future__ import annotations

import re
import unicodedata


_LEXICON: tuple[tuple[str, str], ...] = (
    ("Button Embellishment", r"button embellish(?:ment|ed)|buttons? art"),
    ("Chenille Patch", r"chenille patch"),
    ("Crystal Gravel", r"crystal gravel"),
    ("Diamond Dust", r"diamond dust"),
    ("Dust", r"dust"),
    ("Dried Flowers", r"dried flowers?"),
    ("Pressed Leaves", r"pressed leaves"),
    ("Beaded Garland", r"beaded garland"),
    ("Galvanized", r"galvanized"),
    ("Veneer", r"(?:wood )?veneer"),
    ("Invisible Ink", r"invisible ink"),
    ("UV Light", r"uv lights?"),
    ("UV Lacquer", r"uv lacquer"),
    ("Holographic", r"holographic"),
    ("Painted", r"painted glass"),
    ("Gloss", r"gloss"),
    ("Decoupage", r"decoupag(?:e|ed)"),
    ("Decal", r"decals?"),
    ("Beading", r"beading"),
    ("Faux Leather Patch", r"faux leather patch"),
    ("Faux Grass", r"faux grass"),
    ("Glue Embellishment", r"glue embellish(?:ment|ed)|glue coat(?: texture)?"),
    ("Glow in the Dark", r"glow in (?:the )?dark"),
    ("Gold Leaf", r"gold leafs?"),
    ("High Gloss", r"(?:high|hi) gloss"),
    ("Metallic Leaf", r"metallic leafs?"),
    ("Puff Paint", r"puff(?:y)? paint"),
    ("Silver Leaf", r"silver leafs?"),
    ("Paint Effect", r"paint effect"),
    ("Plaster Word", r"plaster words?"),
    ("Beaded", r"beaded accents?"),
    ("Spot Gloss", r"spot gloss"),
    ("Spot Varnish", r"spot varnish"),
    ("Stained Glass", r"stained glass"),
    ("Stained", r"stained (?:wood|wooden)"),
    ("Applique", r"applique"),
    ("Attachment", r"(?:with|w) (?:fabric|felt) bows?|bows? attachments?|attached bows?|attachments?|metal grommets(?: and shoelace)?|floating foam(?: silhouette)?|(?:metal plate|wire) emb(?:ellished)?|metal logo|layered fabric|(?:with|w) (?:sherpa fabric|faux fur)"),
    ("Debossed", r"deboss(?:ed|ing)?"),
    # Source-reviewed "distressed canvas" and "distressed wooden frame"
    # describe physical goods; a distressed logo or texture remains artwork.
    ("Distressed", r"distress(?:ed|ing)? (?:finish|canvas|wooden frame)"),
    ("Dry-Erase", r"dry erase"),
    ("Embossed", r"emboss(?:ed|ing)?"),
    ("Engraved", r"engrav(?:ed|ing)?"),
    ("Embroidery", r"embroider(?:ed|y)?|cross stitch"),
    ("Etched", r"etch(?:ed|ing)?"),
    ("Flocking", r"flock(?:ed|ing)?"),
    ("Foil", r"(?:holo)?foil"),
    ("Gel Coat", r"(?:all ?over |dripping |clear )gel(?: coat| paint)?|gel (?:coat|paint|handpaint|canvas)|(?:with|w) (?:clear |spot |all ?over )?gel"),
    ("Glitter", r"glitter"),
    ("Gravel", r"gravel"),
    ("Handpaint", r"hand ?paint(?:ed)?"),
    ("LED", r"leds?|backlit"),
    ("Metallic", r"metallic"),
    ("Pearls", r"pearls?"),
    ("Rhinestone", r"rhinestones?"),
    ("Screenprint", r"(?:silk ?screen|screen) ?print(?:ed|ing)?"),
    ("Scratch-Off", r"scratch off"),
    ("Sequins", r"sequins?"),
    ("Soft Touch", r"soft touch"),
    ("Textured", r"textur(?:ed|ing)? (?:finish|frame|background)|textured linen print"),
    ("Varnish", r"varnish"),
    ("Embellished", r"embellish(?:ed|ments?)"),
    ("Adhesive", r"(?:reusable )?adhesive"),
)

_COMPILED = tuple((name, re.compile(r"\b(?:" + pattern + r")\b")) for name, pattern in _LEXICON)
_TERM = "|".join("(?:" + pattern + ")" for _, pattern in _LEXICON)
_QUALIFIER = r"(?:all ?over|black|white|gold|silver|copper|iridescent|static|moving|rough|holo spot|sugar|flat|3d|printed|multiple|clear|heavy)"
_START_MODIFIER = re.compile(r"^(?:(?:" + _QUALIFIER + r")\s+)*(?:" + _TERM + r")\b")
_END_MODIFIER = re.compile(r"\b(?:" + _TERM + r")\s*$")
_WHOLE_CLAUSE = re.compile(
    r"^(?:(?:with|w|and)\s+)?(?:(?:" + _QUALIFIER + r")\s+)*(?:" + _TERM + r")"
    r"(?:\s+(?:(?:and|with|w)\s+)?(?:(?:" + _QUALIFIER + r")\s+)*(?:" + _TERM + r"))*$"
)
_SIZE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:in|inch|inches|cm|mm)?\s*(?:x|by)\s*"
    r"\d+(?:\.\d+)?(?:\s*(?:in|inch|inches|cm|mm))?\b|"
    r"\b\d+(?:\.\d+)?\s*(?:in|inch|inches|cm|mm)\b"
)
_ARTWORK_BOUNDARY = re.compile(r"\b(?:artwork|design|graphic|illustration|image|pattern|scene)\b")
_NEGATION = re.compile(r"\b(?:without|no|non)\s+(?:" + _TERM + r")\b")
_COORDINATED_NEGATION = re.compile(
    r"\b(?:without|no|non)\s+(?:" + _TERM + r")"
    r"(?:\s+(?:and|or)\s+(?:" + _TERM + r"))+\b"
)
_APPEARANCE_ONLY = re.compile(
    r"\b(?:fake|simulated|faux|imitation|mock)\s+"
    r"(?:(?:gold|silver|copper|metallic|holographic|sparkly|sparkling|iridescent|white|black)\s+){0,2}"
    r"(?:" + _TERM + r")\b|"
    r"\b(?:" + _TERM + r")\s+(?:effect|look|appearance|like)\b"
)
_PHYSICAL_BOW = re.compile(r"^(?:with|w) bows?\b")
_CONNECTED_FINISH = re.compile(
    r"\b(?:with|w)\s+mat\s+(?:and\s+)?gold\s+leaf\b|"
    r"\b(?:with|w|and|in|on)\s+(?:[a-z]+\s+){0,2}(?:holo)?foil\b|"
    r"\b(?:with|w|and|in|on)\s+(?:[a-z]+\s+){0,2}glitter\b|"
    r"\b(?:with|w|and|in|on)\s+(?:[a-z]+\s+){0,2}leds?\b|"
    r"\b(?:with|w|and|in|on)\s+(?:[a-z]+\s+){0,2}metallic\b|"
    r"\b(?:with|w|and|in|on)\s+(?:[a-z]+\s+){0,2}(?:gel(?: coat)?|chenille patch|applique|embroidery|embroidered|(?:silk ?screen|screen) ?print(?:ed|ing)?|spot gloss|spot varnish|(?:high|hi) gloss|embellish(?:ed|ments?)|beaded accent|beading|plaster word|dried flowers|pressed leaves|beaded garland|faux leather patch|faux grass|diamond dust|dust|decals?|decoupag(?:e|ed)|textured background|textured linen print|(?:wood )?veneer|sequins?|invisible ink|uv lights?|gloss|gravel|rhinestones?|pearls?|hand ?paint(?:ed)?)\b"
)


def _normalize(value: str) -> str:
    value = re.sub(r"(glitter|foil)(?=[A-Z][a-z])", r"\1 ", value)
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\b(?:glttr|glltr|gltr)\b", "glitter", text)
    text = re.sub(r"\b(?:cnvs|cnv|cvs)\b", "canvas", text)
    text = re.sub(r"\bplque\b", "plaque", text)
    text = re.sub(r"\bdistressedcanvas\b", "distressed canvas", text)
    text = re.sub(r"\bstrge\b", "storage", text)
    text = re.sub(r"\blift[- ]off lid bx\b", "lift off lid box", text)
    text = re.sub(r"\bchst\b", "chest", text)
    text = re.sub(r"\bgrybrd\b", "greyboard", text)
    text = re.sub(r"\bdomd\b", "domed", text)
    text = re.sub(r"\bspt\b", "spot", text)
    text = re.sub(r"\bcrystl\b", "crystal", text)
    text = re.sub(r"\bgrvl\b", "gravel", text)
    text = re.sub(r"\b(?:mtallic|mettalic)\b", "metallic", text)
    text = re.sub(r"\b(?:mtlc|mtllic|mtllc)\b", "metallic", text)
    text = re.sub(r"\bdrppng\b", "dripping", text)
    text = re.sub(r"\bmlti\b", "multi", text)
    text = re.sub(r"\b(?:highgloss|hghglss|hgh glss|hgh glass|high glss|high glass|hg)\b", "high gloss", text)
    text = re.sub(r"\bprntd\b", "printed", text)
    text = re.sub(r"\bglss\b", "glass", text)
    text = re.sub(r"\bfrmd\b", "framed", text)
    text = re.sub(r"\bundr\b", "under", text)
    text = re.sub(r"\bchenile\b", "chenille", text)
    text = re.sub(r"\bembelishment\b", "embellishment", text)
    text = re.sub(r"\bsport varnish\b", "spot varnish", text)
    text = re.sub(r"\bhanpaint\b", "handpaint", text)
    text = re.sub(r"\bhndpnt\b", "handpaint", text)
    text = re.sub(r"\bhanpainted\b", "handpainted", text)
    text = re.sub(r"\bembssd\b", "embossed", text)
    text = re.sub(r"\bpper\b", "paper", text)
    text = re.sub(r"\bprnt\b", "print", text)
    text = re.sub(r"\bdiamnd\b", "diamond", text)
    text = re.sub(r"\bwih gel\b", "with gel", text)
    text = re.sub(r"\bpuffpaint\b", "puff paint", text)
    text = re.sub(r"\brhinestonel\b", "rhinestone", text)
    text = re.sub(r"\bholiofoil\b", "holofoil", text)
    text = re.sub(r"\bhlfoil\b", "holofoil", text)
    text = re.sub(r"\bgoldfoil\b", "gold foil", text)
    text = re.sub(r"\b(foil|glitter|led)(?=\d)", r"\1 ", text)
    text = re.sub(r"\bled(?=lights?\b)", "led ", text)
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def _named_terms(phrase: str) -> set[str]:
    names = {name for name, pattern in _COMPILED if pattern.search(phrase)}
    for color, leaf in (("gold", "Gold Leaf"), ("silver", "Silver Leaf")):
        if re.search(r"\b" + color + r" metallic leaf\b", phrase):
            names.discard("Metallic Leaf")
            names.discard("Metallic")
            names.add(leaf)
    if "Crystal Gravel" in names:
        names.discard("Gravel")
    if "Diamond Dust" in names:
        names.discard("Dust")
    if "Metallic Leaf" in names:
        names.discard("Metallic")
        if "Gold Leaf" in names or "Silver Leaf" in names:
            names.discard("Metallic Leaf")
    if "Spot Gloss" in names:
        names.discard("High Gloss")
    if "Spot Gloss" in names or "High Gloss" in names:
        names.discard("Gloss")
    if "Spot Varnish" in names:
        names.discard("Varnish")
    if "Foil" in names and re.search(r"\bmetallic foil\b", phrase):
        names.discard("Metallic")
    if "Glue Embellishment" in names or "Button Embellishment" in names:
        names.discard("Embellished")
    if names - {"Embellished"}:
        names.discard("Embellished")
    names.difference_update(_denied_terms(phrase))
    return names


def _named_terms_without_negation(phrase: str) -> set[str]:
    return {name for name, pattern in _COMPILED if pattern.search(phrase)}


def _denied_terms(phrase: str) -> set[str]:
    denied: set[str] = set()
    for pattern in (_NEGATION, _COORDINATED_NEGATION, _APPEARANCE_ONLY):
        for match in pattern.finditer(phrase):
            denied.update(_named_terms_without_negation(match.group()))
    return denied


def extract_treatments(
    description: object,
    *,
    normalized_title: str,
    product_span: tuple[int, int],
    physical_evidence: str,
) -> tuple[str, ...]:
    """Return sorted explicit treatments around a caller-selected product noun.

    ``product_span`` indexes ``normalized_title``.  This is deliberately an
    input rather than a noun guess: finding the product belongs to the reader.
    ``physical_evidence`` is the reader's already bounded modifier phrase.
    """
    if not isinstance(description, str) or not normalized_title:
        return ()
    start, end = product_span
    if not (0 <= start < end <= len(normalized_title)):
        raise ValueError("product_span must identify a noun in normalized_title")

    # The reader has already bounded this wording to the physical product.
    # Callers must not pass the full description or an artwork substring here.
    names = _named_terms(_normalize(physical_evidence))
    before = normalized_title[:start].strip()
    after = normalized_title[end:].strip()
    # A dimension ends a physical-modifier clause.  It cannot contribute a
    # finish, nor may artwork after it teach a finish to the product.
    if _SIZE.search(before):
        before = before[_SIZE.search(before).end():].strip()
    if _SIZE.search(after):
        after = after[:_SIZE.search(after).start()].strip()
    before = _normalize(before)
    after = _normalize(after)

    # The nearest whole modifier at either edge is product evidence.  Unknown
    # words between a term and the noun stop inference from remote artwork.
    if before:
        tail = " ".join(before.split()[-4:])
        if _END_MODIFIER.search(tail):
            names.update(_named_terms(tail))
        if re.search(r"\bmetallic print on(?: mdf)?$", before):
            names.add("Metallic")
        if re.search(r"\b(?:with|w) decoupaged paper$", before):
            names.add("Decoupage")
        if re.search(r"\bgalvanized (?:steel|metal)$", before):
            names.add("Galvanized")
        if re.search(r"\bembossed paper$", before) and normalized_title[start:end].strip() == "print":
            names.add("Embossed")
        if re.search(r"\b(?:w|with) screen$", before) and normalized_title[start:end].strip() == "print":
            names.add("Screenprint")
        if (re.search(r"\bmdf box\b", normalized_title[start:end])
                and (re.search(r"\bled wire art on$", before)
                     or re.search(r"\bled lit(?:\s+\w+){0,4}$", before))):
            names.add("LED")
        leaf_on = re.search(r"\b(gold|silver|metallic) (?:metallic )?leaf on$", before)
        if leaf_on:
            names.add({"gold": "Gold Leaf", "silver": "Silver Leaf", "metallic": "Metallic Leaf"}[leaf_on.group(1)])
        if re.search(r"\bhand ?paint(?:ed)?\b(?:\s+\w+){0,2}$", before):
            names.add("Handpaint")
        if (normalized_title[start:end].strip().endswith("canvas")
                and re.search(r"\bhigh gloss(?:\s+\w+){0,2}$", before)):
            names.add("High Gloss")
    title_clause_names: set[str] = set()
    if after:
        if _WHOLE_CLAUSE.fullmatch(after):
            title_clause_names = _named_terms(after)
            names.update(title_clause_names)
        lead = re.sub(r"^(?:with|w|and)\s+", "", after)
        modifier = _START_MODIFIER.match(lead)
        if modifier:
            remainder = lead[modifier.end():].strip()
            if not remainder or re.match(r"(?:with|w|and)\s+(?:" + _TERM + r")\b", remainder):
                names.update(_named_terms(modifier.group()))

        # Catalog finish clauses often say "with copper foil" or "and
        # glitter" before turning to identity or artwork.  Stay within nine
        # words of the noun and two words of the connector.  An explicit
        # "artwork" label cancels a nearby treatment-looking word.
        adjacent = " ".join(after.split()[:9])
        for connected in _CONNECTED_FINISH.finditer(adjacent):
            following = adjacent[connected.end():].split()[:3]
            if "artwork" not in following:
                names.update(_named_terms(connected.group()))
        if re.search(r"^(?:\w+\s+){0,3}hand ?paint(?:ed)?\b", after):
            names.add("Handpaint")
        if re.search(r"\b(?:with|w) 3d flower beading\b", after):
            names.add("Beading")
        if re.match(r"^scratch off\b", after):
            names.add("Scratch-Off")
        if re.match(r"^engraved\b", after):
            names.add("Engraved")
        if re.match(r"^(?:with|w) metallic puff paint\b", after):
            names.add("Puff Paint")
        if re.search(r"\b(?:with|w) invisible ink (?:and )?uv light\b", after):
            names.update(("Invisible Ink", "UV Light"))
        if re.match(r"^high gloss\b", after) and "canvas" in normalized_title[start:end]:
            names.add("High Gloss")
        if re.fullmatch(r"one word embroidery", after):
            names.add("Embroidery")
        if re.match(r"^s\s*2\s+glitter\s+embellishment\b", after):
            names.add("Glitter")

    # "LED <property> canvas" still explicitly states LED even though the
    # identity words are irrelevant.  The LED token must precede the noun in
    # its local clause; generic "lights" alone never implies LED technology.
    if before:
        leading = before.split()
        if len(leading) <= 5 and re.search(r"\bleds?\b", before) and len(leading) - 1 - next(
            i for i, word in enumerate(leading) if re.fullmatch(r"leds?", word)
        ) <= 3:
            names.add("LED")

    # A whole underscore clause may explicitly describe a finish.  A clause
    # like "Foil hero artwork" is not physical evidence and is ignored.
    whole_clause_names: set[str] = set()
    for part in description.split("_")[1:]:
        clause = _normalize(part)
        if _WHOLE_CLAUSE.fullmatch(clause):
            whole_clause_names.update(_named_terms(clause))
        # Artwork captions may explicitly name an applied foil medium.  Require
        # the physical foil phrase at the end; "foil effect" and depicted
        # foil artwork are not finish evidence.
        if re.search(r"\b(?:in foil|and foil|(?:gold|silver|copper) foil)$", clause) \
                and not re.search(r"\b(?:w|with) (?:gold|silver|copper) foil$", clause):
            whole_clause_names.add("Foil")
        if re.search(r"\bwith glitter and foil$", clause):
            whole_clause_names.update(("Glitter", "Foil"))
        if re.fullmatch(r"(?:[a-z]+ )?glitter insert", clause):
            whole_clause_names.add("Glitter")
        if clause == "led and mdf":
            whole_clause_names.add("LED")
    names.update(whole_clause_names)

    # Foil and glitter are especially common in artwork captions.  If they
    # occur only after multiple intervening words, the product phrase has
    # ended.  A separate whole physical-finish clause remains positive proof.
    for ambiguous in ("Foil", "Glitter"):
        if ambiguous not in names or ambiguous in whole_clause_names or ambiguous in title_clause_names:
            continue
        term_pattern = dict(_COMPILED)[ambiguous]
        positions = [m.start() for m in term_pattern.finditer(normalized_title)]
        if positions and all(position >= end and len(normalized_title[end:position].split()) > 2
                             for position in positions):
            if not any(ambiguous in _named_terms(match.group()) for match in _CONNECTED_FINISH.finditer(
                " ".join(after.split()[:9])
            )):
                names.discard(ambiguous)

    # Several catalog titles list the same form twice with different finishes.
    # A treatment can describe the item only if each explicitly named variant
    # has it.  Split the original title so commas do not disappear in the
    # reader's normalized text; unresolved segmentation abstains.
    noun = _normalize(normalized_title[start:end].strip())
    if noun:
        raw_title = description.split("_")[0]
        normalized_raw = _normalize(raw_title)
        # Some accepted reader patterns cover an entire coordinated phrase.
        # The repeated physical noun, rather than that long pattern match, is
        # the unit whose treatment has to agree across variants.
        if len(re.findall(r"\bcanvas\b", normalized_raw)) >= 2:
            noun = "canvas"
        elif len(re.findall(r"\bprinted glass\b", normalized_raw)) >= 2:
            noun = "printed glass"
        elif len(re.findall(r"\blift off lid box\b", normalized_raw)) >= 2:
            noun = "lift off lid box"
        elif len(re.findall(r"\btall mdf sign\b", normalized_raw)) >= 2:
            noun = "tall mdf sign"
        noun_pattern = re.compile(r"\b" + re.escape(noun) + r"\b")
        raw_noun = noun_pattern.search(normalized_raw)
        if raw_noun:
            raw_before = " ".join(normalized_raw[:raw_noun.start()].split()[-4:])
            if _END_MODIFIER.search(raw_before):
                names.update(_named_terms(raw_before))
            if re.search(r"\bmetallic print on(?: mdf)?$", raw_before):
                names.add("Metallic")
            raw_after = " ".join(normalized_raw[raw_noun.end():].split()[:9])
            for connected in _CONNECTED_FINISH.finditer(raw_after):
                if "artwork" not in raw_after[connected.end():].split()[:3]:
                    names.update(_named_terms(_normalize(connected.group())))
        if len(noun_pattern.findall(normalized_raw)) >= 2:
            clauses = [part for part in re.split(r"\s*,\s*|\s*;\s*|\s+and\s+|\s*&\s*", raw_title, flags=re.I)
                       if noun_pattern.search(_normalize(part))]
            if len(clauses) < 2:
                return ()
            common: set[str] | None = None
            for clause in clauses:
                clause_text = _normalize(clause)
                clause_match = noun_pattern.search(clause_text)
                if clause_match is None:
                    continue
                clause_terms = set(extract_treatments(
                    clause, normalized_title=clause_text,
                    product_span=clause_match.span(), physical_evidence="",
                ))
                common = clause_terms if common is None else common & clause_terms
            names.intersection_update(common or set())

        # The caller's normalized title may have had dimensions deleted.  Use
        # the unstripped source to restore that boundary before accepting any
        # treatment, including one supplied in physical_evidence.  An explicit
        # artwork heading has the same effect.  A dimension before the noun is
        # allowed: modifiers between that size and the noun remain physical.
        if raw_noun:
            barriers = [*list(_SIZE.finditer(normalized_raw)),
                        *list(_ARTWORK_BOUNDARY.finditer(normalized_raw))]
            physical_start = max((m.end() for m in barriers if m.end() <= raw_noun.start()), default=0)
            physical_end = min((m.start() for m in barriers if m.start() >= raw_noun.end()),
                               default=len(normalized_raw))
            source_terms = _named_terms(normalized_raw[physical_start:physical_end])
            # "Canvas with bows" is a physical attachment clause even when
            # identity words follow.  Artwork and bow-frame wording do not
            # describe an attachment; mixed variants must agree separately.
            bow_suffix = normalized_raw[raw_noun.end():].strip()
            if (len(noun_pattern.findall(normalized_raw)) == 1
                    and "shelf" not in noun
                    and _PHYSICAL_BOW.match(bow_suffix)
                    and not re.search(r"\b(?:frame|artwork|graphic|design|image|pattern|scene)\b", bow_suffix)):
                source_terms.add("Attachment")
                names.add("Attachment")
            if re.search(r"\bdistressed (?:canvas|wooden frame)\b$",
                         normalized_raw[physical_start:raw_noun.end()]):
                names.add("Distressed")
            # A directly size-qualified canvas can still have a stated
            # modifier immediately before that size: "embellished 12x12
            # canvas".  Do not reach farther back into artwork wording.
            size_before = [m for m in _SIZE.finditer(normalized_raw) if m.end() <= raw_noun.start()]
            if size_before:
                nearest_size = size_before[-1]
                if not normalized_raw[nearest_size.end():raw_noun.start()].strip():
                    preceding = normalized_raw[:nearest_size.start()].strip().split()
                    if preceding:
                        direct_modifier = _named_terms(preceding[-1])
                        source_terms.update(direct_modifier)
                        names.update(direct_modifier)
            names.intersection_update(source_terms | whole_clause_names)
            for artwork in _ARTWORK_BOUNDARY.finditer(normalized_raw):
                if artwork.start() < raw_noun.end():
                    continue
                caption_prefix = normalized_raw[physical_start:artwork.start()].rstrip()
                for name, term_pattern in _COMPILED:
                    if name in whole_clause_names:
                        continue
                    if any(term.end() == len(caption_prefix) for term in term_pattern.finditer(caption_prefix)):
                        names.discard(name)
            if re.search(r"\bbow frame\b", normalized_raw):
                names.discard("Attachment")
        # Explicitly contrasted finishes name multiple variants of the same
        # physical item.  The varying finish is not common to the item.
        contrast = re.search(r"\bplain\s+(?:and|or)\s+(foil|glitter|metallic|leds?)\b|"
                             r"\b(foil|glitter|metallic|leds?)\s+(?:and|or)\s+plain\b",
                             normalized_raw)
        if contrast:
            names.difference_update(_named_terms(contrast.group()))
        if re.search(r"\bmdf plaque (?:and|or) mdf (?:holo)?foil plaque\b|"
                     r"\bmdf (?:holo)?foil plaque (?:and|or) mdf plaque\b", normalized_raw):
            names.discard("Foil")
        if noun.endswith("kit") and re.search(r"\bembroidery\s+kit\b", normalized_raw):
            names.discard("Embroidery")
        # A catalog assortment explicitly includes untreated versions when it
        # says "with and without" (often abbreviated "w and w/o").  A finish
        # present in only some pieces cannot describe the whole item.
        with_without = re.search(
            r"\b(?:with|w)\s+(?:and|or)\s+(?:without|w\s*/\s*o)\s+"
            r"(?:(?:[a-z]+\s+){0,2})(?:" + _TERM + r")\b",
            raw_title,
            flags=re.I,
        )
        if with_without:
            names.difference_update(_named_terms(_normalize(with_without.group())))
        # A multi-piece title can state one finish per comma-separated item
        # without repeating the noun.  Retain only finishes shared by each
        # explicit variant; an unresolved split stays blank.
        if (re.search(r"\b(?:\d+\s*pc|multi\s*p(?:ac|c)?k|assorted|asst)\b", normalized_raw)
                and not re.search(r"\basst licenses\b", normalized_raw)):
            variants = [part for part in re.split(r"\s*,\s*|\s*;\s*", raw_title) if part.strip()]
            finish_sets = [_named_terms(_normalize(part)) for part in variants]
            nonempty = [group for group in finish_sets if group]
            if len(nonempty) >= 2 and len({tuple(sorted(group)) for group in nonempty}) >= 2:
                names.intersection_update(set.intersection(*nonempty))
        # A printed glass panel can depict stained glass without being made
        # by the stained-glass process.  The explicit printed substrate wins.
        if re.search(r"\bstained glass printed glass\b", normalized_raw):
            names.discard("Stained Glass")
    # A connector such as "and foil" must not resurrect a term scoped by
    # "without glitter and foil".  Appearance-only artwork wording likewise
    # cannot become physical treatment evidence through a shorter submatch.
    names.difference_update(_denied_terms(_normalize(description.split("_")[0])))
    return tuple(sorted(names))
