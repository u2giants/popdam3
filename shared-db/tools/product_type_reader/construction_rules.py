"""Source-stated construction modifiers for the product-type reader.

The reader supplies its independently chosen product type.  These rules never
choose or change that type, and they do not infer a construction from it.
Artwork and licensing clauses commonly follow an underscore, so ordinary
modifiers are read only from the product title before that boundary.  The one
exception is an explicit, complete ``floating framed`` phrase, which may be
in an underscore-separated physical specification.
"""

from __future__ import annotations

import re
import unicodedata


_DIMENSION = re.compile(
    r'(?<![A-Za-z0-9])\d+(?:\.\d+)?\s*(?:in(?:ches?)?|["”″])?\s*[x×]\s*'
    r'\d+(?:\.\d+)?(?:\s*(?:in(?:ches?)?|["”″]))?'
    r'(?:\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|cm|in(?:ches?)?|["”″])?(?:\s*[dDhH]\b)?)?', re.I)


def _words(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\bdie[- ]?cut\b", "die cut", text)
    text = re.sub(r"\blift[- ]off\b", "lift off", text)
    return re.sub(r"\s+", " ", text).strip()


def _literal_woven(title: str) -> bool:
    """A woven construction is not a nonwoven or woven-look appearance."""
    if not re.search(r"\bwoven\b", title):
        return False
    # The separator may be a hyphen, slash, space, or a Unicode dash erased
    # during ASCII folding.  If both claims occur, leave construction blank.
    if re.search(r"\b(?:non|not|un|faux|fake|imitation)[\s\-/]*woven\b", title):
        return False
    if re.search(r"\bwoven[\s\-/]+(?:look|effect|print|pattern|texture)\b", title):
        return False
    return True


def _shadowbox_frame(clause: str, *, before_size: bool = False) -> bool:
    """Accept a frame named as part of the physical shadowbox clause."""
    shadowbox = r"shadow\s?box"
    if re.search(r"\b" + shadowbox + r" frame\b", clause):
        return True
    if re.search(r"\b" + shadowbox +
                 r" (?:with|w/?) (?:(?!artwork\b)\w+ ){0,2}frame\b", clause):
        return True
    if re.search(r"\b" + shadowbox + r"\b(?:(?!\bartwork\b).){0,70}\bin oval frame\b", clause):
        return True
    if before_size and not re.search(r"\bartwork\b", clause):
        frame = re.search(r"\b" + shadowbox + r"\b.{0,100}?\bframe\b", clause)
        if frame and len(re.findall(r"\b\w+\b", clause[frame.end():])) <= 3:
            return True
    return False


_VISUAL_CONTENT = re.compile(
    r"\b(?:with|w|featuring)\s+(?!(?:pendulums?|cushion(?:ed|s)?|frames?|stands?|lids?|hooks?|drawers?|mirrors?|lights?|leds?|weighted|bottoms?|bases?)\b)(?:[^\s,_]+\s+){0,5}?"
    r"(?:artwork|illustrations?|graphics?|images?|scenes?|designs?|patterns?|motifs?)\b"
    r"|\b(?:artwork|illustrations?|depicting)\b",
    re.I)


def _before_visual(text: str) -> str:
    visual = _VISUAL_CONTENT.search(text)
    return text[:visual.start()].strip() if visual else text


def refine_construction(description: object, product_type: str, current: str = "") -> str:
    """Add only explicit, family-bound physical construction evidence.

    ``description`` is source wording, not a reader prediction.  The return
    value uses the reader's canonical sorted, semicolon-separated convention.
    Existing values are preserved; the caller must separately decide whether
    those existing values are supported.
    """
    parts = set(filter(None, (part.strip() for part in current.split(";"))))
    if not isinstance(description, str) or not product_type:
        return "; ".join(sorted(parts))

    title_source = description.split("_", 1)[0]
    dimension = _DIMENSION.search(title_source)
    after_size = _words(title_source[dimension.end():]) if dimension else ""
    # Dimensions divide the product phrase from frequently artistic wording.
    # A physical adjective after a size is not enough to modify the product.
    if dimension:
        title_source = title_source[:dimension.start()]
    # Visual-content wording names what is pictured, never how the product is
    # built ("with tea set graphic" is not a set).  Stop at the first marker.
    visual = _VISUAL_CONTENT.search(title_source)
    physical_title = _words(title_source[:visual.start()] if visual else title_source)
    # Every rule reads only text before the first depicted-content marker, so
    # no construction can be inferred from what a caption pictures.
    # whole_title is read only by whole_stated (removals), by _shadowbox_frame,
    # which requires the frame to close the clause (a trailing caption noun
    # defeats it), and by the exact "nested mdf box shelf set" phrase, which
    # names the assembly itself and cannot be pictured content.
    whole_title = _words(title_source)
    title = physical_title
    whole_after_size = after_size
    after_size = _before_visual(after_size)
    # A whole underscore clause may independently name this one assembly.
    # Searching the complete description would also read artwork clauses.
    clauses = [_words(clause) for clause in description.split("_")[1:]
               if not _VISUAL_CONTENT.search(clause)]

    def stated(pattern: str) -> bool:
        return re.search(pattern, title) is not None

    def whole_stated(pattern: str) -> bool:
        # Only removals read past a caption marker: removing an extra value
        # can never invent a construction from what is pictured.
        return re.search(pattern, whole_title) is not None

    def physically_stated(pattern: str) -> bool:
        # Family-wide or count-like words must precede any depicted content.
        return re.search(pattern, physical_title) is not None

    # A quantity set or a noun already carried by the product type is not a
    # physical construction.  These narrow cases correct upstream extras.
    if product_type == "Paint-Your-Own Canvas Set" and whole_stated(r"\bcanvas panel\b"):
        parts.discard("Panel")
    # A faux book is one object; a stated set or piece count is its construction.
    if product_type == "Faux Book" and physically_stated(r"\bset\b|\b(?:two|three|\d+)[- ]?(?:piece|pc)s?\b"):
        parts.add("Set")
    if product_type == "Box Shelf" and re.search(r"\bnested mdf box shelf set\b", whole_title + " " + whole_after_size):
        parts.discard("Set")
    if product_type == "Storage Cube":
        parts.discard("Set")
    if product_type in {"Porch Leaner", "Leaner Sign"}:
        parts.discard("Leaner")
    if product_type == "Framed Canvas" and whole_stated(r"\b(?:floater framed|matted framed floated) canvas\b"):
        parts.discard("Framed")
    if product_type == "Framed Canvas" and whole_stated(r"\bfloater framed high gloss canvas\b"):
        parts.discard("Framed")
    if product_type == "Plaque" and whole_stated(r"\bmolded mdf plaque\b"):
        parts.discard("Molded")
    if product_type == "Lap Desk" and whole_stated(r"\brectangle\b.{0,35}\blap\b"):
        parts.discard("Rectangular")
    if product_type in {"Storage Trunk", "Storage Toy Chest", "Hard Storage Box"} \
            and whole_stated(r"\b7\s*pc\b.{0,30}\bset\b"):
        parts.discard("Set")
    if product_type == "Storage Bin" and whole_stated(r"\b(?:2|two)\s*(?:piece|pc) set\b"):
        parts.discard("Set")
    if product_type == "Framed Art" and any(re.search(r"\b(?:2|two)\s*piece set\b", clause) for clause in clauses):
        parts.discard("Set")
    if product_type == "Door Mat" and whole_stated(r"\braised embossed\b.{0,30}\bpattern\b"):
        parts.discard("Raised")
    if product_type == "Door Mat" and whole_stated(r"\bset coir door mat\b"):
        parts.discard("Set")

    if stated(r"\bframed\b") and product_type in {
        "Framed Art", "Framed Fabric Art", "Framed Glass Art"
    }:
        parts.add("Framed")
    if product_type in {"Framed Shadowbox", "Framed Glass Shadowbox"} \
            and stated(r"\bdie cut paper\b.{0,35}\bin shadowbox frame\b"):
        parts.add("Framed")
    if product_type in {"Framed Shadowbox", "Framed Glass Shadowbox"} \
            and (_shadowbox_frame(whole_title, before_size=True) or _shadowbox_frame(after_size)):
        parts.add("Framed")
    if product_type == "Framed Shadowbox" and re.search(r"\bframe width\b", after_size):
        parts.add("Framed")
    if stated(r"\bdeep frame\b") and product_type == "Framed Art":
        parts.add("Deep Frame")
    if stated(r"\bdeep frame\b") and product_type == "Framed Print":
        parts.add("Deep Frame")
    if physically_stated(r"\b(?:floating|floater|float) framed\b") or any(
            re.fullmatch(r"(?:floating|floater|float) framed", clause) for clause in clauses):
        parts.add("Floating Frame")
    if product_type != "Tablet Stand" and physically_stated(r"\bdie cut\b") \
            and not stated(r"\bdie cut (?:icon|attachment|magnets?)\b"):
        parts.add("Die-Cut")
    if stated(r"\brevers(?:e|ible)\b") and product_type in {
        "Tall Sign", "Door Hanger", "Door Sign"
    }:
        parts.add("Reversible")
    if _literal_woven(title) and product_type in {
        "File Organizer", "Tapestry", "Storage Bin", "Wall Art",
        "Decorative Object", "Hanging Organizer"
    }:
        parts.add("Woven")
    if stated(r"\bplush\b") and product_type in {
        "Plush Cube Art", "Storage Basket", "Wall Art"
    }:
        parts.add("Plush")
    if stated(r"\bfigural\b") and product_type in {"Pencil Cup", "Planter"}:
        parts.add("Figural")
    if stated(r"\bstraight\b") and product_type == "Storage Cube":
        parts.add("Straight")
    if stated(r"\bchain\b") and product_type in {"Glass Art", "Framed Glass Art"}:
        parts.add("Chain")
    if product_type == "Clock" and physically_stated(r"\bpendulum\b"):
        parts.add("Pendulum")
    if product_type == "Framed Art" and stated(r"\bdeckled? edge\b"):
        parts.add("Deckled Edge")
    if product_type == "Framed Print" and stated(r"\bframed\s+deckled?\s+print\b"):
        parts.add("Deckled Edge")
    if product_type == "Plaque" and stated(r"\blayered\s+mdf\b"):
        parts.add("Layered")
    if product_type == "Plaque" and physically_stated(r"\b(?:2|two)[- ]layer\s+mdf\b"):
        parts.discard("Double-Layer")
        parts.add("Layered")
    if product_type == "Plaque" and stated(r"\bplaque\s+(?:with|w/)\s*\d*\s*hooks?\b"):
        parts.add("With Hooks")
    if product_type == "MDF Box" and stated(r"\bmdf box\b.{0,20}\b(?:slits|slots)\b"):
        parts.add("Slotted")
    if product_type == "Framed Art" and stated(r"\b(?:white|black) mat\b"):
        parts.add("Matted")
    if product_type in {"Framed Art", "Framed Canvas"} and stated(
            r"\b(?:art|canvas)\s+(?:with|w/?)\s*(?:(?:glass|handpaint|glitter|fillet|red foil)\s*(?:and|&|,)\s*)*mat\b"):
        parts.add("Matted")
    if product_type == "Block" and stated(r"\b(?:wood|mdf) block rounded edge\b"):
        parts.add("Rounded")
    if product_type == "Storage Chest" and stated(
            r"\b(?:domed\s+(?:grey[- ]?board\s+)?storage chest|dmd\s+(?:grybrd|grey[- ]?board)\s+strg chst)\b") \
            and not stated(r"\bflat[- ]domed\b"):
        parts.add("Domed")
    if product_type == "Tabletop Block" and physically_stated(r"\bdome block tabletop\b"):
        parts.discard("Dome")
        parts.add("Domed")
    if product_type == "Lap Desk" and stated(r"\blap\s+(?:(?:writing|dry erase)\s+)?desk\b.{0,25}\b(?:with|w/?)\s+cushion\b"):
        parts.add("Cushioned")
    if product_type == "Foam Wall Decor" and stated(r"\bhand cut foam wall decor\b"):
        parts.add("Hand-Cut")
    if product_type == "MDF Box" and stated(r"\b(?:floating mdf box|floating character in mdf box)\b"):
        parts.add("Floating")
    if product_type == "Storage Hamper" and stated(r"\bround poly[- ]cotton greyboard laundry\b"):
        parts.add("Round")
    if product_type == "Block" and stated(r"\bwood rounded block\b"):
        parts.add("Rounded")
    if product_type == "Hard Storage Box" and stated(r"\bflip[- ]top box\b"):
        parts.add("Flip-Top")
    if product_type == "Door Hanger" and stated(r"\blenticular reversible door hanger\b"):
        parts.add("Lenticular")
    if product_type == "Framed Art" and stated(r"\bwrapped linen in floating frame\b"):
        parts.add("Wrapped")
        parts.add("Floating Frame")
    if product_type == "Magazine Holder" and stated(r"\bmagazine holder with drawer\b"):
        parts.add("Drawer")
    if product_type == "Storage Chest" and stated(r"\bflat[- ]domed\b.{0,30}\b(?:storage chest|chest)\b"):
        parts.add("Flat-Domed")
    if product_type == "Decorative Letter" and stated(r"\bweighted bottom\b"):
        parts.add("Weighted")
    if product_type == "Framed Art" and stated(r"\b(?:art w/?\s*glitter mat|paper w/?\s*mat\b)"):
        parts.add("Matted")
    if product_type == "Framed Art" and stated(r"\bflush mount framed art\b"):
        parts.add("Flush Mount")
    if product_type == "Framed Art" and stated(r"\barch framed wall art\b"):
        parts.add("Arch")
    if product_type == "Rug" and stated(r"\brunner rug\b"):
        parts.add("Runner")
    if product_type == "Desktop Organizer" and stated(r"\bspinning desktop organizer\b"):
        parts.add("Spinning")
    if product_type == "Desktop Organizer" and stated(r"\b(?:4|four)[- ]compartment desktop org(?:anizer)?\b"):
        parts.add("Four-Compartment")
    if product_type == "Storage Container" and stated(r"\brounded corner lift off greyboard storage\b"):
        parts.add("Rounded Corner")
    if product_type == "Pencil Cup" and stated(r"\bpencil cup with clock\b"):
        parts.add("With Clock")
    if product_type == "Canvas" and stated(r"\brope wrapped round canvas\b"):
        parts.add("Rope-Wrapped")
    if product_type == "Storage Box" and stated(r"\bshaped small box\b"):
        parts.add("Shaped")
    if product_type == "Photo Frame" and physically_stated(r"\bdiy p(?:i)?cture frm die cut attachment\b"):
        parts.discard("Die-Cut")
        parts.add("Die-Cut Attachment")
        parts.add("DIY")
    if product_type == "Photo Frame" and stated(r"\bdie cut mdf phto frme hrt shpe\b"):
        parts.add("Shaped")
    if product_type == "Clock" and stated(r"\b(?:with|w/?) step movement\b"):
        parts.add("Step Movement")
    if product_type == "Shelf" and stated(r"\bfolding\b"):
        parts.add("Folding")
    if product_type == "Storage Ottoman" and physically_stated(r"\b(?:non[- ]?|not )collapsible\b"):
        parts.discard("Collapsible")
        parts.add("Non-Collapsible")
    if product_type in {"Framed Glass Shadowbox", "Framed Fabric Art"} and stated(r"\bfrayed\b"):
        parts.add("Frayed")
    if product_type == "Writing Desk" and stated(r"\b(?:with|w\.?)\s+legs\b"):
        parts.add("With Legs")
    if product_type == "Storage Suitcase" and stated(r"\bsuitcs grybrd strg\b"):
        parts.add("Suitcase")
    diy_noun = {"Planter": "planter", "Trinket Tray": "trinket tray", "Stepping Stone": "stepping stone"}.get(product_type)
    if diy_noun and stated(r"\bdiy\b(?:\s+\w+){0,5}\s+" + diy_noun + r"\b"):
        parts.add("DIY")
    if product_type in {"Wall Clock", "Clock", "Photo Frame", "Framed Shadowbox", "Art"} \
            and physically_stated(r"\bmolded\b"):
        parts.add("Molded")
    molded_noun = {
        "Foam Art": r"foam art",
        "Wall Art": r"(?:felt )?wall art",
        "Wall Figure": r"wall figures?",
        "Phone Stand": r"phone stand",
        "Canvas": r"canvas",
        "Frame": r"(?:mdf )?frame",
        "Framed Art": r"frame art",
        "Framed Glass Shadowbox": r"(?:glass )?shadowbox",
        "Mask": r"(?:polyresin )?mask",
        "Wall Mask": r"(?:3d )?wall mask",
    }.get(product_type)
    if molded_noun and stated(r"\bmolded\s+" + molded_noun + r"\b"):
        parts.add("Molded")
    if product_type in {"Clock", "Wall Clock"} and stated(r"\bmldd wll clck\b"):
        parts.add("Molded")
    if product_type == "Framed Shadowbox" and stated(r"\b(?:mldd|mold)\s+(?:shdwbx|shadowbox)\b"):
        parts.add("Molded")
    if product_type in {"Framed Canvas", "Frame", "Framed Print"} \
            and stated(r"\b(?:float|floating|floater) framed?\b"):
        parts.add("Floating Frame")
    if product_type == "Framed Canvas" and stated(r"\bframed floated canvas\b"):
        parts.add("Floating Frame")
    if product_type == "Frame" and stated(r"\b(?:float|floate) frames?\b"):
        parts.add("Floating Frame")
    if product_type == "Framed Canvas" and stated(r"\bfloatr frm cnvs\b"):
        parts.add("Floating Frame")
    if product_type == "Framed Print" and stated(r"\bfloat frm embossd ppr prnt\b"):
        parts.add("Floating Frame")
    if product_type in {"Canvas", "Framed Canvas"} and stated(
            r"\b(?:canvas floating frame|floating\b.{0,20}\bframe canvas)\b"):
        parts.add("Floating Frame")
    if product_type == "Frame" and stated(r"\bsetback frame (?:w|with) linen paper\b"):
        parts.add("Framed")
    if product_type in {"Photo Frame", "Block"} and stated(
            r"\bdie cut\b.{0,35}\b(?:egg|heart)[- ]+shap(?:e|ed)\b"):
        parts.add("Shaped")
    if product_type == "Storage Bin" and stated(r"\b(?:cotton|paper) rope storage bin\b"):
        parts.add("Rope")
    if product_type == "Storage Basket" and stated(r"\bcotton rope basket\b"):
        parts.add("Rope")
    if stated(r"\blift off\b") and product_type in {"Hard Storage Box", "Storage Box"}:
        parts.add("Lift-Off")
    if stated(r"\bsetback\b") and product_type == "Framed Art":
        parts.add("Setback")
    if stated(r"\bfaux book\b") and product_type in {"Desktop Organizer", "Storage Box"}:
        parts.add("Faux Book")
    if product_type == "MDF Box":
        parts.discard("Hooks")
        if stated(r"\bmdf box(?: art)? with (?:elastics and )?hooks\b"):
            parts.add("With Hooks")
        else:
            parts.discard("With Hooks")
    # Only a complete physical product phrase can re-open the evidence after
    # a dimension.  A bare adjective there may describe the depicted artwork.
    if product_type == "Framed Art" and re.search(r"\bframed art\b", after_size):
        parts.add("Framed")
    if product_type == "Wall Art" and re.search(r"\bplush wall art\b", after_size):
        parts.add("Plush")
    if product_type == "Sign" and re.search(r"\bmdf die cut\b", after_size):
        parts.add("Die-Cut")
    if product_type == "Art" and re.search(r"\bdie cut\b.{0,25}\bmdf\b.{0,15}\bart\b", after_size):
        parts.add("Die-Cut")
    if product_type in {"Framed Canvas", "Canvas"} and re.search(
            r"\b(?:canvas in floating frame|floating frame canvas|flt frame\b.{0,25}\bcnv)\b", after_size):
        parts.add("Floating Frame")
    if product_type == "Framed Shadowbox" and re.search(r"\bmolded shadowbox\b", after_size):
        parts.add("Molded")
    if product_type == "Box Shelf" and re.search(r"\bnested mdf box shelf\b", after_size):
        parts.add("Nested")
    if product_type == "File Organizer" and re.search(r"\b(?:\d+[- ]tier\s+)?mesh file organizer\b", after_size):
        parts.add("Mesh")
    if product_type == "File Organizer" and re.search(r"\bvertical file organizer\b", after_size):
        parts.add("Vertical")
    if product_type == "Storage Chest" and re.search(r"\bflat[- ]domed\b.{0,30}\b(?:storage chest|chest)\b", after_size):
        parts.add("Flat-Domed")
    if product_type == "Canvas" and re.search(r"\bstretch canvas\b", after_size):
        parts.add("Stretched")
    if product_type == "Plaque" and re.search(r"\bmdf plaque\s+(?:with|w/)\s*\d*\s*hooks?\b", after_size):
        parts.add("With Hooks")
    if product_type == "Canvas" and stated(r"\bblank artist canvas\b") and any(
            not re.search(r"\b(?:artwork|graphic|pattern|print)\b", clause)
            and re.search(r"\b(?:canvas frame|frame black canvas)\b", clause)
            for clause in clauses):
        parts.add("Frame")
    # Both reviewed word orders identify the calendar's physical block form.
    # A bundled pencil cup is a different, compound product and needs its own
    # classification instead of inheriting the plain-calendar construction.
    if product_type == "Perpetual Calendar" \
            and stated(r"\b(?:block mdf|mdf block) perpetual calendar\b") \
            and not stated(r"\bpencil\s+cup\b"):
        parts.add("Block")
    if product_type == "Framed Canvas" and whole_stated(r"\bfloater framed printed canvas\b"):
        parts.discard("Framed")
    if product_type == "Plaque" and stated(r"\bdouble[- ]sided[- ]print\b.{0,20}\bmdf plaque\b"):
        parts.add("Reversible")
    if product_type == "Storage Bin" and stated(r"\bsquare woven bin\b"):
        parts.add("Square")
    if product_type == "Storage Chest" and stated(r"\bflat[- ]domd\s+grybrd\s+strge chst\b"):
        parts.add("Flat-Domed")
    if product_type == "Art" and stated(r"\bdouble layer die cut\b.{0,30}\bart\b"):
        parts.add("Layered")
    if product_type == "Framed Glass Shadowbox" and stated(r"\bshadowbox w/?\s*canvas backer raised\b"):
        parts.add("Raised")
    if product_type == "Mat" and stated(r"\banti[- ]fatique\b.{0,22}\bmat\b"):
        parts.add("Anti-Fatigue")
    if product_type == "Print" and stated(r"\bboxed mdf\b.{0,30}\bprint\b"):
        parts.add("Boxed")
    if product_type == "Storage Bin" and stated(r"\btapared storage bin\b"):
        parts.add("Tapered")
    if product_type == "Photo Frame" and stated(r"\bdie cut mdf shpd phto frme\b"):
        parts.add("Shaped")
    if product_type == "Storage Bin" and stated(r"\bpaper rope shaped\b.{0,20}\bbin\b"):
        parts.add("Rope")
    if product_type == "Block" and stated(r"\bshaped 2[- ]sided mdf block\b"):
        parts.update({"Shaped", "Two-Sided"})
    if product_type == "Framed Glass Shadowbox" and stated(r"\b3[- ]layer glass shadowbox\b"):
        parts.add("Layered")
    if product_type == "Trinket Tray" and stated(r"\bpyo ceramic trinket tray\b"):
        parts.add("DIY")
    if product_type == "Canvas" and stated(r"\bstagger canvas\b"):
        parts.add("Staggered")
    if product_type == "Photo Frame" and any(re.fullmatch(r"routed edge", clause) for clause in clauses):
        parts.add("Routed Edge")
    if product_type == "Wall Art" and stated(
            r"\bframed\b(?:(?!\bartwork\b).){0,80}\bwall art\b"):
        parts.add("Framed")
    if product_type == "Wall Art" and re.search(
            r"\bmdf framed\b(?:(?!\bartwork\b).){0,80}\bwall art\b", after_size):
        parts.add("Framed")
    if product_type == "Framed Shadowbox" and stated(r"\bdual color frame shadowbox\b"):
        parts.add("Framed")
    if product_type == "Frame" and stated(
            r"\bmdf framed\b(?:(?!\bartwork\b).){0,85}\bw\s+\w+\s+frame\b"):
        parts.add("Framed")
    if product_type == "Lap Desk" and stated(r"\blap desk\b.{0,75}\bwith\s+\w+\s+cushion\b"):
        parts.add("Cushioned")
    if product_type == "Framed Canvas" and whole_stated(r"\bcanvas floater framed\b"):
        parts.discard("Framed")
    if product_type == "Clock" and stated(r"\bmld wall colcks\b"):
        parts.add("Molded")
    if product_type == "Framed Print" and stated(r"\bscalloped paper under glass\b"):
        parts.add("Scalloped")
    if product_type == "Block" and stated(r"\bfreeform ceramic block\b"):
        parts.add("Freeform")
    if product_type == "Storage Hamper" and stated(r"\bmesh pop[- ]up\b.{0,35}\bhamper\b"):
        parts.add("Pop-Up")
    if product_type == "MDF Box" and stated(r"\bmdf box with photo insert\b"):
        parts.add("Photo Insert")
    if product_type == "MDF Box" and re.search(r"\bfloating character in mdf box\b", after_size):
        parts.add("Floating")
    if product_type == "Storage Chest" and physically_stated(r"\bdome chests\b"):
        parts.discard("Dome")
        parts.add("Domed")
    if product_type in {"Plaque", "Sign", "Storage Bin"} and stated(
            r"\b\d+[- ]?(?:piece|pc)\s+(?:die cut\s+)?(?:mdf\s+)?(?:sign|plaque|set)\b"):
        parts.discard("Set")
    if product_type == "Canvas" and whole_stated(r"\bcanvas panel\b"):
        parts.discard("Panel")
    if product_type == "Pencil Cup" and whole_stated(r"\bshaped mdf pencil cup\b"):
        parts.discard("Shaped")
    if product_type == "Frame" and stated(r"\bsetback frame with raised lasercut icon\b"):
        parts.add("Laser-Cut")
    if product_type == "Lap Desk" and stated(r"\blap desk with cusion\b"):
        parts.add("Cushioned")
    if product_type == "Lap Desk" and whole_stated(r"\boval\b.{0,35}\blap\b"):
        parts.discard("Oval")
    if product_type == "Wall Shelf" and stated(r"\b2 tier wall shelf\b"):
        parts.add("Two-Tier")
    if product_type == "Memo Holder" and stated(r"\bsculpted memo\b.{0,25}\bholder\b"):
        parts.add("Sculpted")
    if product_type == "Lap Desk" and stated(r"\blapdesk with usb ports\b"):
        parts.add("USB Ports")
    if product_type == "Wall Monogram" and stated(r"\bwall monogram\b.{0,35}\bweighted bottom\b"):
        parts.add("Weighted Bottom")
    if product_type == "Perpetual Calendar" and physically_stated(r"\bperpetual calendar w dome\b"):
        parts.discard("Dome")
        parts.add("Domed")
    if product_type == "Block" and stated(r"\bdie cut mdf block w moving needle\b"):
        parts.add("Moving Needle")
    if product_type == "Storage Box" and physically_stated(r"\bfaux vhs box storage set\b"):
        parts.discard("Set")
        parts.add("Faux VHS")
    if product_type == "Framed Canvas" and physically_stated(r"\bfltr frm cnvs\b"):
        parts.discard("Framed")
        parts.add("Floating Frame")
    if product_type == "Framed Canvas" and whole_stated(r"\bfloatr frm cnvs\b"):
        parts.discard("Framed")
    if product_type == "Framed Canvas" and whole_stated(r"\bframed floated canvas w mat\b"):
        parts.discard("Framed")
    if product_type == "Framed Glass Shadowbox" and stated(r"\bframed glass fringed paper shadowbox\b"):
        parts.add("Framed")
        parts.add("Fringed")
    if product_type == "Door Sign" and stated(r"\bdouble[- ]sided door sign\b"):
        parts.add("Reversible")
    if product_type == "Print" and stated(r"\bstretched pu w[./]?\s*screen[- ]print\b"):
        parts.add("Stretched")
    if product_type == "Canvas" and stated(r"\bhexagon\b.{0,35}\bcanvas art\b"):
        parts.add("Hexagonal")
    if product_type == "Framed Art" and stated(r"\bframed art w deckle foil edge paper\b"):
        parts.add("Deckled Edge")
    if product_type == "Frame" and stated(r"\blasercut mdf layered frame\b"):
        parts.add("Laser-Cut")
    if product_type == "MDF Box" and stated(r"\bmdf box\b.{0,35}\bfloating character\b"):
        parts.add("Floating")
    if product_type == "Photo Frame" and (
            stated(r"\bdie cut attachment\b")
            or any(re.search(r"\bdie cut\b.{0,20}\battachment\b", clause) for clause in clauses)):
        parts.discard("Die-Cut")
    if product_type == "Photo Frame" and stated(r"\bphoto frame with die cut attachment\b"):
        parts.add("Die-Cut Attachment")
    if product_type == "Framed Art" and whole_stated(r"\b\d+[- ]panel portrait\b"):
        parts.discard("Panel")
    if product_type == "Plaque" and re.search(r"\b\d+\s*piece set\b.{0,35}\bplaque\b", after_size):
        parts.add("Set")
    if product_type == "Plaque" and stated(r"\b(?:2|two)[- ]piece set\b.{0,35}\bplaque\b"):
        parts.add("Set")
    if product_type == "Sign" and stated(r"\bprch lners hngng sign\b"):
        parts.add("Leaner")
    if product_type == "Glass Art" and stated(r"\b(?:printed )?glass\s+\d+\s*layer\b"):
        parts.add("Layered")
    if product_type == "Glass Art" and stated(r"\b(?:printed )?glass floating layer\b"):
        parts.add("Floating")
    if product_type == "Storage Hamper" and stated(r"\brectgl storage hamper\b"):
        parts.add("Rectangular")
    if product_type == "Storage Chest" and stated(r"\bfltdmd greyboard storage chest\b"):
        parts.add("Flat-Domed")
    if product_type == "Storage Chest" and stated(r"\bgrbrd flt tp strge chest\b"):
        parts.add("Flat-Top")
    if product_type == "Storage Chest" and stated(r"\bgrbrd flt tp grbd strage chest\b"):
        parts.add("Flat-Top")
    if product_type == "Tile" and stated(r"\bhex tiles\b"):
        parts.add("Hexagonal")
    if product_type == "Memo Board" and stated(r"\bmagnetic memo board\b"):
        parts.add("Magnetic")
    if product_type == "Corkboard with Dry-Erase Board" and stated(
            r"\bcorkboard with magnetic dry[- ]erase\b"):
        parts.add("Magnetic")
    if product_type == "Framed Glass Art" and stated(r"\bframed round painted glass\b"):
        parts.add("Round")
    if product_type == "Framed Glass Art" and whole_stated(r"\bframe wreath\b"):
        parts.discard("Framed")
    if product_type == "Photo Frame" and stated(r"\bdie cut house shaped\b"):
        parts.add("Shaped")
    if product_type == "Frame" and stated(r"\bdie cut mdf shped frme\b"):
        parts.add("Shaped")
    # The bin noun itself may follow the artwork; the product type already
    # establishes it, so only the physical adjective must precede the caption.
    if product_type == "Storage Bin" and physically_stated(r"\btapered storage\b"):
        parts.add("Tapered")
    if product_type == "Planter" and stated(r"\bpyo ceramic mini planter\b"):
        parts.add("DIY")
    if product_type == "Alarm Clock" and stated(r"\b(?:plastic )?cube alarm clock\b"):
        parts.add("Cube")
    if product_type == "Corkboard" and stated(r"\braised cork layer\b"):
        parts.add("Layered")
    if product_type == "Framed Print" and whole_stated(r"\bfloat frm embossd ppr prnt\b"):
        parts.discard("Framed")
    if product_type == "Block" and stated(r"\bdie cut mdf block w rotating attachment\b"):
        parts.add("Rotating")
    if product_type == "MDF Box" and re.search(r"\blenticular on mdf box\b", after_size):
        parts.add("Lenticular")
    if product_type == "MDF Box" and stated(r"\blenticular on mdf box\b"):
        parts.add("Lenticular")
    if product_type == "Perpetual Calendar" and stated(r"\bmdf blck perpetual clndr\b"):
        parts.add("Block")
    if product_type == "Countdown Calendar" and stated(r"\bmdf blck cntdwn calndr\b"):
        parts.add("Block")
    if product_type == "Decorative Word" and stated(r"\bwrapped words\b"):
        parts.add("Wrapped")
    if product_type == "Plaque" and stated(r"\blaser[- ]cut mdf\b.{0,30}\bplaque\b"):
        parts.add("Laser-Cut")
    if product_type == "Jewelry Box" and stated(r"\bjewelry box with snap closure\b"):
        parts.add("Snap Closure")
    if product_type == "Jewelry Box" and stated(r"\bjewelry box storage with zipper closure\b"):
        parts.add("Zipper")
    if product_type == "Glass Shadowbox" and stated(r"\baccordion paper shadowbox under glass\b"):
        parts.add("Accordion")
    if product_type == "Photo Frame" and stated(r"\bscalloped photo frame\b"):
        parts.add("Scalloped")
    if product_type == "Art" and stated(r"\bround cross[- ]stitch embroidered art\b"):
        parts.add("Round")
    if product_type == "Storage Cube" and stated(r"\bcllpsible nonwvn fbric strge cube\b"):
        parts.add("Collapsible")
    if product_type == "Framed Art" and stated(r"\bframe w mat\b"):
        parts.add("Matted")
    if product_type == "Frame" and stated(r"\bin \d+(?:\.\d+)?\s*[\"']? frame\b"):
        parts.add("Framed")
    if product_type == "Photo Frame" and any(
            re.fullmatch(r"die cut \w+ attachment", clause) for clause in clauses):
        parts.add("Die-Cut Attachment")
    if product_type == "Lawn Sign" and stated(r"\bcorrugated sheet lawn sign\b"):
        parts.add("Corrugated")
    if product_type == "Framed Glass Shadowbox" and stated(r"\bframed glass shadowbox with raised icon inside\b"):
        parts.add("Raised")
    if product_type == "Framed Shadowbox" and stated(r"\bshadow\s?box w/?\s*3[- ]d laser cut\b"):
        parts.add("Laser-Cut")
    if product_type == "Frame" and re.search(r"(?:^|\bin )\d+(?:\.\d+)?\s*[\"'] frame\b(?!\s+width\b)", after_size):
        parts.add("Framed")
    if product_type == "Magnet Board" and whole_stated(r"\bdie cut magnets?\b"):
        parts.discard("Die-Cut")
    if product_type == "Slat Art" and stated(r"\bslit slat art\b"):
        parts.add("Slatted")
    if product_type == "Sequin Art" and stated(r"\bsequin flip art\b"):
        parts.add("Flip")
    if product_type == "Painting Kit" and whole_stated(r"\bdiy set w/?\s*\d+ paint pots? and (?:a )?br(?:u)?sh\b"):
        parts.discard("Set")
    if product_type == "Stepping Stone" and stated(r"\bdiy cncrte stppng stne\b"):
        parts.add("DIY")
    if product_type == "Storage Hamper" and stated(r"\b(?:felt|flt) ovl hmpr\b"):
        parts.add("Oval")
    if product_type == "Wall Scroll" and stated(r"\blinen[- ]weave wall scroll\b"):
        parts.add("Linen-Weave")
    if product_type == "Decorative Object" and stated(r"\bdimensional woven object\b"):
        parts.add("Dimensional")
    if product_type == "Shape" and physically_stated(r"\blasercut mdf shape\b"):
        parts.discard("Shaped")
        parts.add("Laser-Cut")
    if product_type == "Wall Art" and whole_stated(r"\bno frame wall art\b"):
        parts.discard("Framed")
    if product_type == "Framed Canvas" and physically_stated(r"\bfloating\b.{0,30}\bframe canvas\b"):
        parts.discard("Framed")
        parts.add("Floating Frame")
        if whole_stated(r"\bframe canvas squiggle\b"):
            parts.discard("Squiggle")
    if product_type == "Canvas" and stated(r"\bcanvasboard\b"):
        parts.add("Panel")
        if re.search(r"\bpainting set\b", after_size):
            parts.add("Set")
    return "; ".join(sorted(parts))
