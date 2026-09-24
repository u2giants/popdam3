"""Read stated physical materials from the bounded product phrase.

The caller supplies a normalized title, the selected product-noun span, and the
physical evidence assembled by the reader. This module never uses historical
category codes, defaults for a product family, or artwork after an underscore.
"""

from __future__ import annotations

import re
from collections.abc import Sequence


# Longer, more specific substrates precede their component words. The label
# names intentionally preserve the distinctions in the independently reviewed
# source vocabulary (for example PP versus polypropylene).
_MATERIALS = (
    ("Crumb Rubber", r"crumb rubber"),
    ("Memory Foam", r"memory foam"),
    ("Cotton Rope", r"cotton rope"),
    ("Paper Rope", r"paper rope"),
    ("PE Rattan", r"pe rattan"),
    ("PU Leather", r"pu leather"),
    ("Faux Leather", r"faux leather"),
    ("Faux Suede", r"faux suede"),
    ("Faux Fur", r"faux fur"),
    ("Fur", r"fur"),
    ("EVA Foam", r"eva foam"),
    ("Poly-Linen", r"poly linen"),
    ("Poly-Cotton", r"poly cotton"),
    ("Plush Fabric", r"plush fabric"),
    ("Water Hyacinth", r"water hyacinth"),
    ("MDF", r"mdf"),
    ("Greyboard", r"greyboard|grayboard|grey board|gray board|greybrd|graybrd|grybd"),
    ("Canvas", r"canvas(?:es)?|canvasboard"),
    ("Acrylic", r"acrylic"),
    ("Polyresin", r"polyresin"),
    ("Ceramic", r"ceramic"),
    ("Glass", r"glass"),
    ("Aluminum", r"alumin(?:um|ium)"),
    ("Steel", r"steel"),
    ("Iron", r"iron(?! man\b)"),
    ("Tin", r"tin"),
    ("Metal", r"metal"),
    ("Polypropylene", r"polypropylene"),
    ("PP", r"pp"),
    ("PVC", r"pvc"),
    ("TPE", r"tpe"),
    ("TPR", r"tpr"),
    ("Dolomite", r"dolomite"),
    ("Plywood", r"plywood"),
    ("EVA", r"eva"),
    ("Yarn", r"yarn"),
    ("Plastic", r"plastic"),
    ("Wool", r"wool"),
    ("Linen", r"linen"),
    ("Cotton", r"cotton"),
    ("Cork", r"cork(?:board)?"),
    ("Jute", r"jute"),
    ("Polyester", r"polyester"),
    ("PU", r"pu"),
    ("Velvet", r"velvet"),
    ("Felt", r"felt"),
    ("Nonwoven", r"non[ -]?woven|nonwvn"),
    ("Plush", r"plush"),
    ("Burlap", r"burlap"),
    ("Fabric", r"fabric|fbric|oxford"),
    ("Paper", r"paper(?:board)?|pper|ppr"),
    ("Wood", r"wood(?:en)?"),
    ("Coir", r"coir"),
    ("Foam", r"foam"),
    ("Concrete", r"concrete"),
    ("Rope", r"rope"),
    ("Seagrass", r"seagrass"),
    ("Rattan", r"rattan"),
    ("Rubber", r"rubber"),
    ("Resin", r"resin"),
    ("Silicone", r"silicone"),
    ("Suede", r"suede"),
    ("Satin", r"satin"),
    ("Leather", r"leather"),
    ("Plaster", r"plaster"),
    ("Wire", r"wire"),
    ("Chenille", r"chenille"),
    ("Chiffon", r"chiffon"),
    ("Boucle", r"boucle"),
    ("Denim", r"denim"),
    ("Sponge", r"sponge"),
)

_COMPILED = tuple((name, re.compile(r"\b(?:" + pattern + r")\b")) for name, pattern in _MATERIALS)
_ANY_MATERIAL = "|".join("(?:" + pattern + ")" for _, pattern in _MATERIALS)
_SIMPLE_QUALIFIER = r"(?:printed|framed|framing|stretched|molded|die cut|hanging|wall|tabletop|outdoor|indoor|storage|toy|flat|domed|baking|pocket|shoe|piggy|icon|infant|cast|boxed|set|of|closet|in closet|pop up|bow|laundry|recipe|lift off|lid|photo|large|small|medium|xlarge|rectangle|rectangular|rectgl|bubble|covered|magnetic|memo|desktop|cubby|scalloped)"
_LEADING_PHYSICAL = re.compile(r"^(?:(?:" + _ANY_MATERIAL + r")\b(?:\s+|$))+" )
_SAFE_PREFIX_REMAINDER = re.compile(r"(?:(?:\d+(?:x\d+)*|" + _SIMPLE_QUALIFIER + r")\s*)*")
_PHYSICAL_PREFIX = re.compile(r"(?:(?:" + _ANY_MATERIAL + "|" + _SIMPLE_QUALIFIER +
                              r"|\d+(?:x\d+)*)\b\s*)+")
_DIRECT_SUFFIX = re.compile(
    r"^\s*(?:(?:w|with|on|in|under|of|and)\s+)?(?:(?:" + _ANY_MATERIAL + r")\b\s*(?:and\s+)?)+"
    r"(?:frame|backing|board|bar|panel|legs|sides|base|lid|top|front|surface|cover|fabric|material)?\b"
)
_PHYSICAL_COMPONENT = re.compile(r"\b(?:frame|backing|board|bar|panel|legs|sides|base|lid|top|front|surface|cover|fabric|material)\b\s*$")
_ARTWORK_FOLLOWER = re.compile(r"^\s*(?:artwork|texture|look|effect|pattern|design|graphic|image)\b")
_CANVAS_JOINED = re.compile(r"\b(?:diycanvas(?:es)?|canvasboard)\b|\bcanvas(?:es)?(?=\d)")
_CANVAS_FRAME = re.compile(r"\bcanvas frame\b")
_CANVAS_FRAME_COMPONENT = re.compile(
    r"\bcanvas (?:panel|insert|sheet|fabric|backing|material|substrate)\b"
    r"|\b(?:with|w|including|includes|plus) canvas\b"
    r"(?!\s+(?:artwork|design|print|look|effect|texture|pattern|graphic)\b)"
)
_MDF_BAR = re.compile(r"\b(?:with|w) (?:decorative )?mdf bar\b")
_MDF_FRAME_COMPONENT = re.compile(r"\b(?:in|with|w) (?:\d+ )?mdf frame\b")
_BOXED_MDF = re.compile(r"\bboxed mdf\b")
_MDF_PRODUCT_CLAUSE = re.compile(
    r"\bmdf\b(?!\s+(?:logo|graphic|image|picture|artwork)\b)(?:\s+\w+){0,7}\s+"
    r"(?:frame|art|print|poster|box|plaque|hook|clock|organizer|board|sign|stands?|chest|bank|shelf)\b"
)
_MDF_PHYSICAL_COMPONENT = re.compile(r"\bmdf framed\b|\b(?:and|with|w) mdf\b(?=\s*$)|\b(?:die cut|diecut) pieced mdf logo art\b")
_MDF_CALENDAR_CUP = re.compile(r"\bmdf block perpetual calendar with attached pencil cup\b")
_GREYBOARD_BOX = re.compile(r"\bgreyboard lift off(?: lid)?\b.{0,42}\bbox\b")
_GREYBOARD_COMPONENT = re.compile(r"\bgreyboard (?:faux vhs box|(?:flat|float) (?:top|tp))\b")
_FABRIC_COMPONENT = re.compile(r"\b(?:non ?woven fabric desktop storage cubby|fabric covered magnetic memo board|layered fabric|wrapped in glitter fabric)\b")
_PAPER_STOCK = re.compile(r"\b(?:specialty|speciality|watercolou?r) paper\b")
_PAPER_ACCESSORY = re.compile(r"\b(?:with|w) paper accessor(?:y|ies)\b")
_CRAFT_PAPER_ACCESSORY = re.compile(r"\bcraft paper\b")
_PAPER_COMPONENT = re.compile(r"\b(?:paper ?card art print|die cut paper\b.{0,36}\bshadowbox|printed linen paper|framed newspaper|ink pad (?:and )?paper)\b")
_PAPER_PRINT_COMPONENT = re.compile(r"\b(?:paper|ppr|pper) (?:print|prnt)\b|\bfringed paper shadowbox\b|\bdeckle foil edge paper\b")
_SATIN_BANNER = re.compile(r"\bsatin (?:paper )?(?:hanging )?banner\b")
_HGH_GLSS = re.compile(r"\b(?:hgh|high) (?:glss|glass)\b")
_LAWN_SIGN_METAL_PP = re.compile(r"\blawn sign\b.{0,55}\bmetal (?:garden )?stakes\b.{0,110}\bpp\s*$")
_PORCH_LEANER_MDF = re.compile(r"\bporch leaner\b.{0,60}\btall mdf (?:sgn|sign)\b")
_STAINED_GLASS_FRAME = re.compile(
    r"\bstained (?:w|with) glass\b"
    r"(?!\s+(?:artwork|design|look|effect|pattern|image|graphic)\b)"
    r".{0,30}\bframe\b"
)
_SLAT_ART_UNDER_GLASS = re.compile(r"\bslat art (?:undr|under) glass\b")
_RUBBER_MAT_JOINED = re.compile(r"\brubbermat\b")
_CONCRETE_STONE_ABBREVIATED = re.compile(r"\bcncrte (?:stppng (?:stne|stone)|stepping stone)\b")
_MDF_MAGNET_ACCESSORY = re.compile(r"\bmagnet board with mdf die cut magnets\b")
_UNDERSCORE_PHYSICAL = re.compile(r"^\s*(?:led|foil|glitter)\s+(?:and|&)\s+mdf\b(?=\s*$|\s+\d)", re.I)
_CANVAS_CHENILLE = re.compile(r"\bcanvas (?:w|with) chenille\b(?! patch\b)")
_METAL_PLATE_CANVAS = re.compile(r"\bmetal plate (?:emb|embossed) canvas\b")
_METAL_LOGO_CANVAS = re.compile(r"\bcanvas\b.{0,80}\b(?:with|w) metal logo\b")
_CANVAS_FAUX_LEATHER = re.compile(
    r"\bcanvas\b.{0,75}\b(?:with|w)\s+"
    r"(?:(?:handpaint(?:ed)?|chenille|boucle|textured|and)\s+){0,5}faux leather\b"
)
_PLUSH_CUBE_ART = re.compile(r"\bplush cube ?art\b")
_COTTON_ROPE_BIN = re.compile(r"\bcotton rope storage bins?\b")
_HALF_CANVAS_COTTON_BIN = re.compile(r"\bhalf canvas half cotton rope storage bin\b")
_COTTON_BIN_CANVAS_INSIDE = re.compile(r"\bcotton rope storage bins?\b.{0,30}\b(?:w|with) canvas inside\b")
_COTTON_ROPE_STORAGE = re.compile(r"\bcotton rope storage\b")
_PAPER_ROPE = re.compile(r"\bpaper rope\b")
_PAPER_ROPE_PHYSICAL_BOW = re.compile(
    r"\bpaper rope (?:dimensional|sculptural) (?:decorative )?bow\b"
)
_ROPE_HARDWARE = re.compile(r"\b(?:hanging rope|rope hanger)\b")
_SATIN_CANVAS = re.compile(r"\bsatin canvas\b")
_CANVAS_FAUX_LEATHER_ROPE = re.compile(r"\bcanvas\b.{0,80}\b(?:w|with) faux leather and rope\b")
_CERAMIC_PRODUCT = re.compile(
    r"\b(?:ceramic|cermaic|crmic)\s+(?:mini planter|planter with photo frame|"
    r"figure block|(?:three chain links?\s+)?tabletop|piggy bank|"
    r"trnkt tray|trinket tray|min plntr)\b"
)
_PLASTER_FRAME = re.compile(r"\bmdf photo frame with plaster print\b")
_CANVAS_EVA_BIN = re.compile(r"\bcanvas (?:w|with) eva bin\b")
_WIRE_CANVAS = re.compile(r"\bwire emb canvas\b")
_PU_PRODUCT = re.compile(r"\b(?:stretched pu|faux pu hamper|framed metallic pu|frmd w mtallic pu)\b")
_FELT_PLUSH_BASKET = re.compile(r"\bplush basket with felt embroidery\b")
_FELTED_BUNTING = re.compile(r"\bfelted bunting\b(?!\s+(?:look|effect|texture|pattern|design)\b)")
_WOOD_VENEER_WORD = re.compile(r"\bwood veneer\b")
_PVC_PRODUCT = re.compile(r"\bpvc (?:household mat|frame)\b")
_POLYESTER_PRODUCT = re.compile(r"\bpolyester (?:mesh (?:pop up )?(?:\w+ )?hamper|throw rug)\b")
_PE_RATTAN_PRODUCT = re.compile(r"\bpe rattan(?:\s+(?:\d+ tier )?wall shelf)?\b")
_BURLAP_CANVAS = re.compile(r"\bburlap canvas\b")
_CHIFFON_CANVAS = re.compile(r"\bcanvas with chiffon applique\b")
_METAL_BOW_MDF = re.compile(r"\bmetal bow frame mdf print\b")
_WOOD_GLASS_FRAME = re.compile(r"\b(?:printed glass shadowbox\b.{0,50}\bnat wood frame|"
                                  r"framed art under glass w dark wood frame)\b")
_TIN_GLASS_ART = re.compile(r"\bprinted glass (?:under|w|with) die cut tin\b")
_NONWOVEN_STORAGE = re.compile(r"\bnon[ -]?woven storage bin\b")
_MDF_DIECUT_SIGN = re.compile(r"\bmdf die cut\b.{0,45}\b(?:destination )?signs?\b")
_MDF_LENTICULAR_HANGER = re.compile(r"\bmdf (?:w|with) lenticular reversible door hanger\b")
_FRAYED_LINEN_SHADOWBOX = re.compile(r"\b(?:framed )?glass shadowbox (?:w|with) frayed linen\b")
_CERAMIC_BARREL_CUP = re.compile(r"\bfigural ceramic pencil cup wooden barrel\b")
_PLUSH_WALL_ART = re.compile(r"\bplush wall art\b")
_PLUSH_KEYCHAIN = re.compile(r"\bplush keychain\b")
_GLASS_SHADOWBOX_AFTER_SIZE = re.compile(r"\bprinted glass\b.{0,60}\bshadowbox frame\b")
_FRMD_ART_GLSS = re.compile(r"\b(?:framed art undr glass|frmd art undr glss)\b")
_FRAMED_MDF_PRINT_UNDER_GLASS = re.compile(r"\bframed mdf print\b.{0,80}\bunder glass\b")
_RATTAN_FIRST_CLAUSE = re.compile(r"\s*(?:black|colored|natural) rattan\s*", re.I)
_POLYRESIN_PRODUCT = re.compile(r"\b(?:polyresin figural planter|molded polyresin mask|polyresin votive holder)\b")
_FRAYED_BURLAP_GLASS = re.compile(r"\bframed frayed burlap under glass\b")
_FAUX_PU_OXFORD_HAMPER = re.compile(r"\bfaux pu (?:and )?oxford hamper\b")
_COTTON_RUNNER_RUG = re.compile(r"\bcotton kitchen runner rug\b")
_WOOD_BAR_TAPESTRY = re.compile(r"\btapestry (?:w|with) (?:decorative )?wood bar\b")
_ROPE_WRAPPED_CANVAS = re.compile(r"\brope wrapped round canvas\b")
_FUR_RUG = re.compile(r"\bfur rug\b")
_COTTON_HEADED_ART = re.compile(r"\bcrumb rubber outdoor mat cotton headed\b")
_VELVET_WORD = re.compile(r"\bwire word on mdf\b.{0,60}\bon velvet\b")
_ROPE_MDF_SIGN = re.compile(r"\b(?:mdf plaque (?:w|with) rope|die cut mdf sign with rope)\b")
_PHYSICAL_PP_CLOCK = re.compile(r"\bpp (?:molded |mld )?wall clocks?\b")
_TEXTURED_FAUX_LEATHER_FRAME = re.compile(r"\btextured faux leather in floater frame\b")
_PAPER_ROPE_FIRST = re.compile(r"\s*(?:colored )?paper rope\s*", re.I)
_WOVEN_OBJECT_FIRST = re.compile(r"\s*(?:dimensional|sculptural) woven object\s*", re.I)
_PAPER_ROPE_WOVEN_SHAPE = re.compile(
    r"\s*paper rope (?:cactus|flower|tree|topiary|plant|heart|star|sphere)\s*", re.I
)
_COTTON_ROPE_APPLIQUE_BASKET = re.compile(r"\bcotton rope basket (?:w|with) applique\b")
_STEEL_WIRE_WALL_ART = re.compile(r"\bsteel wire wall art\b")
_BOUCLE_LEATHER_FRAME = re.compile(r"\bmdf textured frame with boucle and faux leather\b")
_GUITAR_HOOK_WOOD_CLAUSE = re.compile(r"\s*(?:natural|stained) wood\s*", re.I)
_COTTON_ROPE_FELT_BIN = re.compile(r"\bcotton rope bin (?:w|with) felt\b")
_COTTON_PLUSH_BASKET = re.compile(r"\bcotton rope basket (?:w|with) plush\b")
_PU_PEBBLE_BANNER = re.compile(r"\bpu pebble leather hanging fishtail banner\b")
_FAUX_SUEDE_BANNER = re.compile(r"\bfaux suede hanging fishtail banner\b")
_WOOD_GRAIN_MDF_SIGN = re.compile(r"\bmdf sign (?:w|with) wood grain\b")
_CLOSED_MATERIAL_RESIDUALS = (
    (re.compile(r"\bpanamacoir mat\b"), "Mat", "coir"),
    (re.compile(r"\bfloater frame suede (?:w|with) screenprint\b"), "Frame", "suede"),
    (re.compile(r"\blap desk with sponge\b"), "Lap Desk", "sponge"),
    (re.compile(r"\bcrumb rubber\b.{0,25}\bmats?\b"), "Mat", "crumb rubber"),
    (re.compile(r"\bframed mdf print\b.{0,85}\bwooden frame\b"), "Framed Print", "wood"),
    (re.compile(r"\bpressed leaves under glass in distressed wooden frame\b"), "Frame", "glass"),
    (re.compile(r"\bframed art (?:w|with) chenile\b"), "Framed Art", "chenille"),
    (re.compile(r"\bframed art (?:w|with) dark wood frame\b"), "Framed Art", "wood"),
    (re.compile(r"\bmdf bank with ps plastic cover\b"), "Bank", "plastic"),
)
_TIN_STREET_SIGN = re.compile(r"\blong tin street sign\b")
_PLASTIC_CUBE_CLOCK = re.compile(r"\bplastic cube alarm clock\b")
_ACRYLIC_BACKLIT_PLAQUE = re.compile(r"\bbacklit led acrlyic plaque\b")
_MDF_METAL_TAG = re.compile(r"\bmdf plaque with wood veneer and metal tag\b")
_RESIN_BARREL_CUP = re.compile(r"\bfigural resin pencil cup wooden barrel\b")


def _listed_materials(evidence: str) -> set[str]:
    """Resolve explicit compound names without also reporting their parts."""
    found: set[str] = set()
    covered = [False] * len(evidence)
    for name, pattern in _COMPILED:
        for match in pattern.finditer(evidence):
            if any(covered[match.start():match.end()]):
                continue
            # A visual effect does not identify its substrate.
            left = evidence[:match.start()]
            right = evidence[match.end():]
            if name not in {"Faux Leather", "Faux Suede", "Faux Fur"} and re.search(
                r"\b(?:faux|fake|imitation)\s+$", left
            ):
                continue
            if re.match(r"\s+(?:texture|look|effect|pattern|print|artwork)\b", right):
                continue
            if name == "Glass" and re.search(r"\bhgh\s+$", left):
                continue
            if name == "Sponge" and re.match(r"\s+bob\b", right):
                continue
            found.add(name)
            for index in range(match.start(), match.end()):
                covered[index] = True
    # Textile names sometimes include a generic carrier word, without claiming
    # that two different materials were used.
    if "Wool" in found and re.search(r"\bwool fabric\b", evidence):
        found.discard("Fabric")
    if "Paper" in found and re.search(r"\blinen paper\b", evidence):
        found.discard("Linen")
    return found


def _appearance_only(material: str, title: str) -> bool:
    """Reject even a supplied base material when every mention is visual style."""
    if material == "PU" and (_PU_PRODUCT.search(title) or _FAUX_PU_OXFORD_HAMPER.search(title)):
        return False
    patterns = [pattern for name, pattern in _COMPILED if name == material]
    matches = [match for pattern in patterns for match in pattern.finditer(title)]
    if not matches:
        return False
    for match in matches:
        left, right = title[:match.start()], title[match.end():]
        if re.search(r"\b(?:faux|fake|imitation)\s+$", left):
            continue
        if re.match(r"\s+grain\s+veneer\b", right):
            return False
        if re.match(r"\s+(?:texture|look|effect|pattern|design|image|graphic|"
                    r"illustration|motif|grain)\b", right):
            continue
        return False
    return True


def extract_materials(
    *,
    text: str,
    evidence: str,
    product_start: int,
    product_end: int,
    size_boundaries: Sequence[int] = (),
    product_type: str = "",
    base_materials: str = "",
    description: str | None = None,
) -> str:
    """Return alphabetized material names supported by the physical clause.

    ``text`` is only the normalized title before the first artwork underscore;
    ``evidence`` is the reader's already-bounded physical phrase. Positions are
    spans in ``text``. A size cuts off trailing physical evidence, while an
    explicit material at the title start remains usable before a size.
    """
    if not 0 <= product_start <= product_end <= len(text):
        raise ValueError("product span is outside normalized title")
    phrase = evidence
    prefix = text[:product_start]
    if match := _LEADING_PHYSICAL.match(prefix):
        # A material-looking first word can be a property or pictured object:
        # Metal Gear, Wood Duck, Glass Slipper, Paper Hero, etc. It is usable
        # only when the words through the product noun form a physical clause.
        remainder = prefix[match.end():]
        if (_SAFE_PREFIX_REMAINDER.fullmatch(remainder)
                and not _ARTWORK_FOLLOWER.match(remainder)
                and not (re.fullmatch(r"\s*sponge\s*", match.group())
                         and re.match(r"\s*bob\b", remainder))):
            phrase += " " + match.group()
    # A short material phrase directly before the product noun may follow a
    # licensor or a construction word. A size starts a *new* product clause;
    # material immediately after it is usable, material before it is not.
    last_size = max((point for point in size_boundaries if point < product_start), default=0)
    words = prefix[last_size:].split()
    for offset in range(max(0, len(words) - 9), len(words)):
        if offset and words[offset - 1] in {"faux", "fake", "imitation"}:
            continue
        before = " ".join(words[offset:])
        if _PHYSICAL_PREFIX.fullmatch(before + " ") and any(
            pattern.search(before) for _, pattern in _COMPILED
        ):
            phrase += " " + before
            break
    end = min((point for point in size_boundaries if point >= product_end), default=len(text))
    suffix = text[product_end:end]
    if match := _DIRECT_SUFFIX.match(suffix):
        remainder = suffix[match.end():]
        connector = re.match(r"^\s*(?:w|with|on|in|under|of|and)\b", suffix)
        strong_connector = connector is not None and connector.group().strip() in {"on", "in", "under", "of"}
        if (not _ARTWORK_FOLLOWER.match(remainder)
                and (not remainder.strip() or _PHYSICAL_COMPONENT.search(match.group()) or strong_connector)):
            phrase += " " + match.group()
    # These are closed physical phrases. They may be separated from the chosen
    # noun by licensed artwork, but cannot be supplied by text after a size.
    bounded_title = text[:min(size_boundaries, default=len(text))]
    if product_type in {"Canvas", "Framed Canvas", "Paint-Your-Own Canvas Set", "Tapestry"}:
        if _CANVAS_JOINED.search(bounded_title):
            phrase += " canvas"
    if product_type in {"Tapestry", "Canvas Tapestry"} and _MDF_BAR.search(bounded_title):
        phrase += " mdf"
    if (_MDF_FRAME_COMPONENT.search(text) or _BOXED_MDF.search(text)
            or _MDF_PRODUCT_CLAUSE.search(text) or _MDF_PHYSICAL_COMPONENT.search(text)):
        phrase += " mdf"
    if product_type == "Perpetual Calendar with Pencil Cup" \
            and _MDF_CALENDAR_CUP.search(text[last_size:end]):
        phrase += " mdf"
    if product_type in {"Hard Storage Box", "Storage Box", "Box"} and _GREYBOARD_BOX.search(bounded_title):
        phrase += " greyboard"
    if _GREYBOARD_COMPONENT.search(text):
        phrase += " greyboard"
    if _FABRIC_COMPONENT.search(text):
        phrase += " fabric"
    if _FELTED_BUNTING.search(text[last_size:end]) and product_type == "Bunting":
        phrase += " felt"
    if (re.search(r"(?:print|plaque|shadowbox|frame|banner|easel|painting|\bart\b)", product_type.lower())
            and _PAPER_STOCK.search(bounded_title) and not re.search(
                r"\b(?:specialty|speciality|watercolou?r) paper\s+(?:look|texture|effect|artwork)\b",
                bounded_title)):
        phrase += " paper"
    if _PAPER_ACCESSORY.search(bounded_title):
        phrase += " paper"
    if product_type in {"Easel", "Paint-Your-Own Canvas Set"} or re.search(r"\beasel\b", text):
        first_size = min(size_boundaries, default=len(text))
        for craft in _CRAFT_PAPER_ACCESSORY.finditer(text):
            # Bare material words beyond a size are a new source clause, not
            # evidence for the earlier product. A direct connector still binds
            # an explicitly included paper accessory to that product.
            before_craft = text[first_size:craft.start()]
            if (craft.end() <= first_size or product_start >= first_size
                    or re.search(r"\b(?:w|with|including|includes)\s+$", before_craft)):
                phrase += " paper"
                break
    if _PAPER_COMPONENT.search(text):
        phrase += " paper"
    if _PAPER_PRINT_COMPONENT.search(text):
        phrase += " paper"
    # An underscore normally begins artwork. A separate clause that begins
    # with a closed physical treatment-and-substrate phrase is the narrow
    # exception; an artwork word after MDF disqualifies it.
    if description:
        for clause in description.split("_")[1:]:
            if _UNDERSCORE_PHYSICAL.match(clause):
                phrase += " mdf"
    if _SATIN_BANNER.search(bounded_title):
        phrase += " satin"
        if re.search(r"\bsatin paper banner\b", bounded_title):
            phrase += " paper"
    if _CANVAS_CHENILLE.search(bounded_title):
        phrase += " chenille"
    if _CERAMIC_PRODUCT.search(bounded_title):
        phrase += " ceramic"
    if (description and re.fullmatch(r"\s*ceramic\s*", description.split("_")[0], re.I)
            and product_type in {"Decorative Knot", "Decorative Chain"}):
        phrase += " ceramic"
    if _PLASTER_FRAME.search(text) and product_type == "Photo Frame":
        phrase += " plaster"
    if _CANVAS_EVA_BIN.search(bounded_title) and product_type == "Storage Bin":
        phrase += " canvas"
    if _WIRE_CANVAS.search(bounded_title) and product_type in {"Canvas", "Framed Canvas"}:
        phrase += " wire"
    if _PU_PRODUCT.search(bounded_title) and product_type in {"Print", "Storage Hamper", "Framed Art"}:
        phrase += " pu"
    # A leading dimension can precede the physical veneer clause. The full
    # normalized title still ends before the artwork underscore.
    if _WOOD_VENEER_WORD.search(text) and product_type == "Decorative Word":
        phrase += " wood"
    if _PVC_PRODUCT.search(text) and product_type in {"Photo Frame", "Mat"}:
        phrase += " pvc"
    if _POLYESTER_PRODUCT.search(bounded_title) and product_type in {"Storage Hamper", "Rug"}:
        phrase += " polyester"
    if _PE_RATTAN_PRODUCT.search(bounded_title) and product_type in {"Wall Shelf", "Dimensional Decor"}:
        phrase += " pe rattan"
    if (description and re.fullmatch(r"\s*pe rattan\s*", description.split("_")[0], re.I)
            and product_type in {"Wall Shelf", "Dimensional Decor"}):
        phrase += " pe rattan"
    if _BURLAP_CANVAS.search(bounded_title) and product_type in {"Canvas", "Framed Canvas"}:
        phrase += " burlap"
    if _CHIFFON_CANVAS.search(bounded_title) and product_type in {"Canvas", "Framed Canvas"}:
        phrase += " chiffon"
    if _METAL_BOW_MDF.search(bounded_title) and product_type == "Print":
        phrase += " metal"
    if _WOOD_GLASS_FRAME.search(bounded_title) and product_type in {"Framed Glass Shadowbox", "Framed Art"}:
        phrase += " wood"
    if _TIN_GLASS_ART.search(bounded_title) and product_type == "Glass Art":
        phrase += " tin"
    if _NONWOVEN_STORAGE.search(bounded_title) and product_type == "Storage Bin":
        phrase += " nonwoven"
    if (_MDF_DIECUT_SIGN.search(text) and product_type == "Sign"
            or _MDF_LENTICULAR_HANGER.search(text) and product_type == "Door Hanger"):
        phrase += " mdf"
    if _FRAYED_LINEN_SHADOWBOX.search(text) and product_type == "Framed Glass Shadowbox":
        phrase += " linen"
    if _GLASS_SHADOWBOX_AFTER_SIZE.search(text) and product_type == "Framed Glass Shadowbox":
        phrase += " glass"
    if _FRMD_ART_GLSS.search(text) and product_type == "Framed Art":
        phrase += " glass"
    if _FRAMED_MDF_PRINT_UNDER_GLASS.search(text) and product_type == "Framed Print":
        phrase += " glass"
    if _TEXTURED_FAUX_LEATHER_FRAME.search(text) and product_type == "Frame":
        phrase += " faux leather"
    if description and _PAPER_ROPE_FIRST.fullmatch(description.split("_")[0]) \
            and product_type == "Wall Shelf":
        phrase += " paper rope"
    if (description and product_type == "Decorative Object"
            and len(clauses := description.split("_")) > 1
            and _WOVEN_OBJECT_FIRST.fullmatch(clauses[0])
            and _PAPER_ROPE_WOVEN_SHAPE.fullmatch(clauses[1])):
        phrase += " paper rope"
    if (description and product_type == "Guitar Hook"
            and re.fullmatch(r"\s*functional guitar hook\s*", description.split("_")[0], re.I)
            and len(description.split("_")) > 1
            and _GUITAR_HOOK_WOOD_CLAUSE.fullmatch(description.split("_")[1])):
        phrase += " wood"
    if _BOUCLE_LEATHER_FRAME.search(text) and product_type == "Frame":
        phrase += " boucle faux leather"
    if _LAWN_SIGN_METAL_PP.search(text) and product_type == "Lawn Sign":
        phrase += " metal pp"
    if _PORCH_LEANER_MDF.search(text) and product_type == "Porch Leaner":
        phrase += " mdf"
    if _STAINED_GLASS_FRAME.search(text) and product_type == "Frame":
        phrase += " glass"
    if _SLAT_ART_UNDER_GLASS.search(text) and product_type == "Slat Art":
        phrase += " glass"
    if (_RUBBER_MAT_JOINED.search(text) and product_type == "Mat"
            and not re.search(r"\brubbermat\s+(?:look|effect|texture|pattern|print|design)\b", text)):
        phrase += " rubber"
    if _CONCRETE_STONE_ABBREVIATED.search(text) and product_type == "Stepping Stone":
        phrase += " concrete"
    for pattern, family, physical_material in _CLOSED_MATERIAL_RESIDUALS:
        if product_type == family and pattern.search(text):
            phrase += " " + physical_material
    if _TIN_STREET_SIGN.search(text) and product_type == "Sign":
        phrase += " tin"
    if _PLASTIC_CUBE_CLOCK.search(text) and product_type == "Alarm Clock":
        phrase += " plastic"
    if _ACRYLIC_BACKLIT_PLAQUE.search(text) and product_type == "Plaque":
        phrase += " acrylic"
    if _MDF_METAL_TAG.search(text) and product_type == "Plaque":
        phrase += " metal"
    if description and _RATTAN_FIRST_CLAUSE.fullmatch(description.split("_")[0]) \
            and product_type in {"Decorative Bow", "Wall Shelf"}:
        phrase += " rattan"
    if _POLYRESIN_PRODUCT.search(text) and product_type in {"Planter", "Mask", "Votive Holder"}:
        phrase += " polyresin"
    if _FRAYED_BURLAP_GLASS.search(text) and product_type == "Framed Fabric Art":
        phrase += " burlap"
    if _FAUX_PU_OXFORD_HAMPER.search(text) and product_type == "Storage Hamper":
        phrase += " pu"
    if _COTTON_RUNNER_RUG.search(text) and product_type == "Rug":
        phrase += " cotton"
    if _WOOD_BAR_TAPESTRY.search(text) and product_type in {"Canvas Tapestry", "Tapestry"}:
        phrase += " wood"
    if _ROPE_WRAPPED_CANVAS.search(text) and product_type == "Canvas":
        phrase += " rope"
    if _FUR_RUG.search(text) and product_type == "Rug":
        phrase += " fur"
    if _VELVET_WORD.search(text) and product_type == "Decorative Word":
        phrase += " velvet"
    if _METAL_PLATE_CANVAS.search(bounded_title) or _METAL_LOGO_CANVAS.search(bounded_title):
        phrase += " metal"
    faux_clause = _CANVAS_FAUX_LEATHER.search(bounded_title)
    if faux_clause and not re.match(r"\s+(?:texture|look|effect|pattern)\b", bounded_title[faux_clause.end():]):
        phrase += " faux leather"
    # Product names such as Canvas and Paper Print state the substrate directly.
    # The same scanner handles those words; no family-to-material default exists.
    materials = set(base_materials.split("; ")) if base_materials else set()
    # A frame sized for a canvas is not itself made of canvas. A second,
    # separately stated canvas before that frame remains valid evidence.
    if (product_type in {"Frame", "Photo Frame", "Folding Frame", "Folding Frame Set"}
            and _CANVAS_FRAME.search(bounded_title)
            and len(re.findall(r"\bcanvas\b", bounded_title)) == 1):
        materials.discard("Canvas")
        phrase = re.sub(r"\bcanvas\b", "", phrase)
    if _HGH_GLSS.search(bounded_title) and not re.search(r"\b(?:under|on|in|with) glass\b", bounded_title):
        materials.discard("Glass")
        phrase = _HGH_GLSS.sub("high gloss", phrase)
    if product_type in {"Canvas", "Framed Canvas"} and re.search(r"\bglass bottle\b", bounded_title):
        materials.discard("Glass")
    candidates = _listed_materials(phrase)
    # The existing source vocabulary deliberately records these common aliases
    # at their reviewed physical family. Keep those names stable while adding
    # newly supported explicit substrates.
    aliases = {"Tin": "Metal", "Nonwoven": "Fabric",
               "Plush": "Fabric", "Burlap": "Fabric"}
    for candidate in candidates:
        if candidate == "PP" and "Polypropylene" in materials:
            continue
        if candidate == "Aluminum" and "Metal" in materials:
            materials.discard("Metal")
        if candidate == "Poly-Linen" and "Linen" in materials:
            materials.discard("Linen")
        if candidate == "Poly-Cotton" and "Cotton" in materials:
            materials.discard("Cotton")
        if candidate == "Chenille" and re.search(r"\bchenille patch\b", phrase):
            continue
        if candidate == "Glass" and product_type in {"Canvas", "Framed Canvas"}:
            continue
        if (candidate == "Glass" and _HGH_GLSS.search(bounded_title)
                and not re.search(r"\b(?:under|on|in|with) glass\b", bounded_title)):
            continue
        if candidate in {"Cotton Rope", "Paper Rope"} and "Rope" in materials:
            continue
        candidate = aliases.get(candidate, candidate)
        if candidate in {"Rope", "Faux Suede", "Faux Fur"} and candidate not in materials:
            continue
        materials.add(candidate)
    if product_type == "Canvas Frame":
        # The canvas frame is a product name, not evidence of its substrate.
        # Only a separately named physical component in this product's clause
        # can supply Canvas; a second size begins a different clause.
        physical_clause = text[last_size:end]
        noun_start = product_start - last_size
        noun_end = product_end - last_size
        outside_noun = physical_clause[:noun_start] + " " + physical_clause[noun_end:]
        if not _CANVAS_FRAME_COMPONENT.search(outside_noun):
            materials.discard("Canvas")
    # Product and component wording disambiguates material names from surface
    # styles and hanging hardware. These source phrases are closed and reviewed.
    if _PLUSH_CUBE_ART.search(text) and product_type == "Plush Cube Art":
        materials.discard("Fabric")
    if _FELT_PLUSH_BASKET.search(text) and product_type == "Storage Basket":
        materials.discard("Fabric")
    if _BURLAP_CANVAS.search(text) and product_type in {"Canvas", "Framed Canvas"}:
        materials.discard("Fabric")
        materials.add("Burlap")
    if _TIN_GLASS_ART.search(text) and product_type == "Glass Art":
        materials.discard("Metal")
        materials.add("Tin")
    if _CERAMIC_BARREL_CUP.search(text) and product_type == "Pencil Cup":
        materials.discard("Wood")
    if _PLUSH_WALL_ART.search(text) and product_type == "Wall Art":
        materials.discard("Fabric")
    if _PLUSH_KEYCHAIN.search(text) and product_type == "Keychain":
        materials.discard("Fabric")
        materials.add("Plush")
    if _FRAYED_BURLAP_GLASS.search(text) and product_type == "Framed Fabric Art":
        materials.discard("Fabric")
        materials.add("Burlap")
    if _COTTON_HEADED_ART.search(text) and product_type == "Outdoor Mat":
        materials.discard("Cotton")
    if _ROPE_MDF_SIGN.search(text) and product_type in {"Plaque", "Sign"}:
        materials.discard("Rope")
    if _ROPE_WRAPPED_CANVAS.search(text) and product_type == "Canvas":
        materials.add("Rope")
    if (_MDF_MAGNET_ACCESSORY.search(text) and product_type == "Magnet Board"
            and len(re.findall(r"\bmdf\b", text)) == 1):
        materials.discard("MDF")
    # Only the PP directly naming a clock substrate is expanded; licensor and
    # artwork initials elsewhere in the description are not material evidence.
    if _PHYSICAL_PP_CLOCK.search(text) and product_type in {"Wall Clock", "Clock"}:
        materials.discard("PP")
        materials.add("Polypropylene")
    if _COTTON_ROPE_APPLIQUE_BASKET.search(text) and product_type == "Storage Basket":
        materials.discard("Rope")
    if _STEEL_WIRE_WALL_ART.search(text) and product_type == "Wall Art" and "Steel" in materials:
        materials.discard("Wire")
    if _RESIN_BARREL_CUP.search(text) and product_type == "Pencil Cup":
        materials.discard("Wood")
    if "Iron" in materials and "Metal" in materials and not re.search(r"\bmetal\b", text):
        materials.discard("Metal")
    if "Wool" in materials and re.search(r"\bwool fabric\b", text):
        materials.discard("Fabric")
    if "Poly-Linen" in materials:
        materials.discard("Linen")
    if "EVA Foam" in materials:
        materials.discard("EVA")
        materials.discard("Foam")
    if _COTTON_ROPE_FELT_BIN.search(text) and product_type == "Storage Bin":
        materials.discard("Cotton")
        materials.discard("Rope")
        materials.add("Cotton Rope")
    if _COTTON_PLUSH_BASKET.search(text) and product_type == "Storage Basket":
        materials.discard("Fabric")
        materials.discard("Rope")
        materials.add("Plush")
    if _PU_PEBBLE_BANNER.search(text) and product_type == "Banner":
        materials.discard("Leather")
        materials.add("PU Leather")
    if _FAUX_SUEDE_BANNER.search(text) and product_type == "Banner":
        materials.add("Faux Suede")
    if _WOOD_GRAIN_MDF_SIGN.search(text) and product_type == "Sign":
        materials.discard("Wood")
    materials = {name for name in materials if not _appearance_only(name, bounded_title)}
    if _SATIN_CANVAS.search(text) and product_type in {"Canvas", "Framed Canvas"}:
        materials.discard("Satin")
    if _PAPER_ROPE.search(text) and product_type in {"Storage Bin", "Dimensional Decor"}:
        materials.discard("Rope")
        materials.discard("Paper Rope")
        materials.add("Paper")
    if product_type == "Decorative Bow" and _PAPER_ROPE_PHYSICAL_BOW.search(text):
        # Paper rope names paper's form here; it does not state a second
        # constituent made of another rope material.
        materials.discard("Rope")
        materials.discard("Paper Rope")
        materials.add("Paper")
    if _COTTON_ROPE_BIN.search(text):
        materials.discard("Rope")
        materials.discard("Cotton Rope")
        materials.add("Cotton")
        if re.search(r"\bset\b.{0,35}\bcanvas inside\b", text):
            materials.discard("Cotton")
            materials.add("Cotton Rope")
        if _HALF_CANVAS_COTTON_BIN.search(text) or _COTTON_BIN_CANVAS_INSIDE.search(text):
            materials.add("Canvas")
    elif _COTTON_ROPE_STORAGE.search(text) and product_type == "Storage Container":
        materials.discard("Cotton")
        materials.discard("Rope")
        materials.add("Cotton Rope")
    if _ROPE_HARDWARE.search(text) and product_type in {"Sign", "Door Sign", "Plaque"}:
        materials.discard("Rope")
    if _CANVAS_FAUX_LEATHER_ROPE.search(text) and product_type in {"Canvas", "Framed Canvas"}:
        materials.discard("Rope")
    return "; ".join(sorted(materials))
