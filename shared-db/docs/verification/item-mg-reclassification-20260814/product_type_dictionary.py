"""Governed semantic item-type dictionary support.

The rule set identifies physical products and independently records construction/shape
and treatment. It never reads MG codes. MG codes are learned later, only from accepted
post-change rows carrying the resulting semantic signature.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import pandas as pd


def normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", "" if pd.isna(value) else str(value))
    text = text.encode("ascii", "ignore").decode().lower()
    replacements = {
        "shadow box": "shadowbox", "shadow bx": "shadowbox", "shdwbx": "shadowbox",
        "shdbx": "shadowbox", "die-cut": "die cut", "diecut": "die cut",
        "fatique": "fatigue", "cnvs": "canvas", "cnvas": "canvas",
        "cvs": "canvas", "frmd": "framed", "frmed": "framed",
        "frme": "frame", "lnticulr": "lenticular", "prntd": "printed",
        "prnt": "print", "grybrd": "greyboard", "strge": "storage",
        "dcor": "decor", "deocr": "decor", "stggerd": "staggered",
        "mtallic": "metallic", "glss": "glass", "ml ded": "molded",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def candidate_wording(description: object) -> str:
    """Stable observed wording used as the exact dictionary lookup key."""
    text = "" if pd.isna(description) else str(description)
    return text.split("_", 1)[0].strip()[:240]


UNUSABLE_PATTERNS = (
    r"^(?:pending|assortment|assorted|asst|desc|sample|samples|test|testing|tes)$",
    r"\b(?:testing|created for testing|test item|test style|test creation)\b",
    r"\b(?:fee|fees|refund|clearance fee|handling charge|handing charge|mddp)\b",
    r"\b(?:discount|rework charges?|additional cost|contractual samples?|samples for)\b",
    r"^(?:assort(?:ed|ment)?|asst|assr?ortment)(?: [a-z0-9]+){0,6}$",
    r"^(?:lacey and isf|foil corners|contractual samples?|assorted contractuals?)$",
)


def unusable_reason(value: object) -> str:
    text = normalize(value)
    if not text:
        return "blank description"
    if re.fullmatch(r"[a-z]*\d+[a-z0-9]*", text):
        return "identifier only"
    for pattern in UNUSABLE_PATTERNS:
        if re.search(pattern, text):
            return "test, fee, placeholder, or non-product wording"
    return ""


@dataclass(frozen=True)
class SemanticSignature:
    physical_product: str = ""
    construction_shape: str = ""
    treatment: str = ""
    matched_wording: str = ""
    status: str = "needs_review"
    decision: str = "No reviewed physical-product rule matched"

    @property
    def full_key(self) -> str:
        return "|".join(normalize(v) for v in (self.physical_product, self.construction_shape, self.treatment))

    @property
    def product_key(self) -> str:
        return normalize(self.physical_product)

    @property
    def product_construction_key(self) -> str:
        return "|".join(normalize(v) for v in (self.physical_product, self.construction_shape))


# Ordered most-specific-first. These are product concepts, never artwork/property terms.
PRODUCT_PATTERNS: tuple[tuple[str, str, str], ...] = (
    ("Paint-Your-Own Canvas Set", "Canvas Set", r"\b(?:diy|pbn|paint by numbers?|paint your own)\b.{0,55}\bcanvas\b|\bcanvas\b.{0,55}\b(?:paint pots?|brush(?:es)?)\b"),
    ("Framed Canvas", "Floater Frame", r"\b(?:floater|floating|float) frame(?:d)?\b.{0,35}\bcanvas\b|\bcanvas\b.{0,35}\b(?:floater|floating) frame\b"),
    ("Framed Canvas", "Frame", r"\bframed canvas\b"),
    ("Canvas Tapestry", "Wood-Bar Hanging", r"\bcanvas tapestry\b|\bprinted canvas tapestry\b"),
    ("Canvas", "Stretched", r"\bcanvas(?:es)?\b"),
    ("Framed Glass Shadowbox", "Glass Shadowbox", r"\b(?:printed )?glass shadowbox\b|\bglass shad(?:ow)?box\b"),
    ("Framed Shadowbox", "Molded", r"\bmolded shadowbox\b|\bmold shadowbox\b"),
    ("Framed Shadowbox", "MDF", r"\bmdf (?:printed )?shadowbox\b|\bshadowbox\b.{0,25}\bmdf\b"),
    ("Framed Shadowbox", "Shadowbox", r"\bshadowbox\b"),
    ("Framed Glass Art", "Printed Glass", r"\bprinted glass\b|\bprint glass\b|\bglass under (?:die cut )?tin\b"),
    ("Framed Glass Art", "Stained Glass", r"\bstained glass\b"),
    ("Framed Glass Art", "Glass", r"\bframed glass\b|\bglass framed art\b"),
    ("Framed Lenticular Art", "3D Lenticular", r"\b3d lenticular\b|\blenticular (?:art|print|image|plaque)\b|\bframed lenticular\b"),
    ("Framed Relief Art", "Foam", r"\bmolded foam(?: wall)? art\b|\bfoam relief\b"),
    ("Framed Relief Art", "3D", r"\b(?:framed )?3d (?:wall )?art\b|\b3d in (?:a )?1 (?:inch )?frame\b|\b3d portrait\b"),
    ("Framed Print", "MDF", r"\bframed\b.{0,30}\bmdf\b|\bmdf framed\b|\bframe mdf\b|\bmdf print in (?:a )?(?:setback|floating) frame\b"),
    ("Framed Print", "Paper", r"\bframed (?:paper )?(?:art|print|poster|wall art)\b|\bsetback framed\b|\barch framed wall art\b|\bsquiggle framed wall art\b"),
    ("Framed Print", "Paper", r"\bsetback frame\b|\bframed deckle(?:d)? (?:edge )?(?:paper|print)\b|\bdeckle(?:d)? print under glass\b|\bsoft touch print framed\b"),
    ("Framed Fabric Art", "Fabric", r"\bframed\b.{0,30}\b(?:fabric|linen|burlap|jersey|embroidered)\b|\bfabric bubble frame\b"),
    ("Framed Mirror", "Mirror", r"\bframed mirror\b|\bmirror\b.{0,20}\bframe\b"),
    ("Photo Frame", "Collage", r"\b(?:multi |collage |infant )?(?:photo|picture|phto) frame\b|\bphoto collage frame\b"),
    ("Wall Plaque", "MDF", r"\bmdf (?:wall )?plaque\b|\bprinted die cut mdf wall\b|\blayered mdf laser cut plaque\b|\bmdf tabletop plaque\b"),
    ("Wall Plaque", "MDF", r"\b(?:boxed|box) mdf\b|\b[2-9] layer boxed mdf\b|\bmdf planks?\b|\bplank palette\b|\bprinted mdf wood\b|\bflush mount mdf\b"),
    ("Wall Plaque", "Natural", r"\b(?:wood|wooden|natural) (?:wall )?plaque\b"),
    ("Wall Plaque", "Plastic", r"\b(?:acrylic|plastic) (?:shaped )?(?:led )?(?:wall )?plaque\b"),
    ("Wall Plaque", "Relief", r"\b(?:relief|layered|3d molded) (?:wall )?(?:art|plaque)\b"),
    ("Tall Wall Sign", "Leaner", r"\b(?:tall|porch leaner|leaning) (?:mdf )?(?:wall )?sign\b|\bmdf porch leaner\b"),
    ("Door Hanger", "MDF", r"\b(?:mdf )?door hanger\b|\breversible door sign\b"),
    ("Wall Sign", "Metal", r"\b(?:tin|metal) sign\b"),
    ("Wall Sign", "Metal", r"\bprinted galvani[sz]ed steel\b|\bprinted aluminum\b|\bprinted aluminium\b"),
    ("Wall Sign", "MDF", r"\b(?:mdf )?(?:door|wall) sign\b|\bhanging sign\b"),
    ("Wall Sign", "Glass", r"\bglass sign\b"),
    ("Wall Shelf", "MDF", r"\b(?:die cut )?mdf shelf\b|\bwall shelf\b|\bnested mdf box shelf\b"),
    ("Wall Hook", "MDF", r"\b(?:mdf |functional |full figure )?(?:wall )?hooks?\b|\bmdf plaque hook\b|\bguitar hook\b"),
    ("Memo Board", "Dry-Erase", r"\b(?:dry erase|magnetic) (?:memo )?board\b|\bmemo board\b"),
    ("Functional Board", "Pinboard", r"\b(?:fabric )?pin ?board\b|\bcork ?board\b"),
    ("Functional Board", "Letterboard", r"\bletter ?board\b"),
    ("Hanging Wall Art", "Tapestry", r"\b(?:woven |fabric |canvas )?(?:hanging )?tapestry\b"),
    ("Hanging Wall Art", "Banner", r"\bhanging banner\b|\bwall banner\b|\bbunting\b|\bpennant\b"),
    ("Hanging Wall Art", "Scroll", r"\bhanging poster\b|\bwall scroll\b|\bhanging scroll\b"),
    ("Hanging Wall Art", "Fabric", r"\b(?:embroidered|fabric|plush|yarn|wool).{0,30}\b(?:hanging )?wall art\b|\bfabric bow wall art\b"),
    ("Hanging Wall Art", "Yarn", r"\byarn art\b|\bbutton art\b|\bsequin art\b"),
    ("Wall Decal", "Sticker", r"\bwall (?:stickers?|decals?)\b"),
    ("Foam Wall Decor", "Foam", r"\b(?:froomies )?(?:printed |molded )?foam (?:foam )?wall (?:decor|decoration|art)\b|\beva wall (?:decor|decoration)\b"),
    ("Wall Light", "LED", r"\b(?:neon|infinity|string) led (?:wall )?(?:light|art|mirror)\b|\bled infinity (?:art|mirror)\b"),
    ("Wall Decor", "Dimensional", r"\b(?:paper rope|natural|plastic) dimensional (?:wall )?(?:art|decor)\b"),
    ("Paper Shade", "Paper", r"\bpaper shade\b"),
    ("Tabletop Block", "Ceramic", r"\b(?:die cut |odd size |holiday )?ceramic (?:tabletop )?block\b"),
    ("Tabletop Block", "Glass", r"\bglass block\b"),
    ("Tabletop Block", "Acrylic", r"\bacrylic block\b"),
    ("Tabletop Block", "MDF", r"\b(?:solid |die cut |shaped |holiday |tabletop )?mdf (?:tabletop )?block\b|\bblock mdf\b|\bwood rounded block\b|\bwood block\b"),
    ("Tabletop Monogram", "Letter", r"\b(?:wood|mdf|greyboard|fabric) (?:letter|monogram)\b"),
    ("Perpetual Calendar", "MDF", r"\b(?:perpetual|countdown) calendar\b|\bcalendar block\b"),
    ("Tabletop Box", "Jewelry", r"\bjewelry box\b|\bnecklace storage\b"),
    ("Tabletop Box", "Music", r"\bmusic box\b"),
    ("Tabletop Box", "MDF", r"\bmdf (?:tabletop )?box\b|\bbox painted art\b"),
    ("Mug", "Ceramic", r"\bceramic mug\b|\bmug\b"),
    ("Tabletop Box", "Glass", r"\bglass (?:storage )?box\b"),
    ("Bookend", "Object", r"\bbook ?ends?\b|\bbook rack\b"),
    ("Candle Holder", "Object", r"\bcandle holder\b"),
    ("Snow Globe", "Object", r"\bsnow globe\b"),
    ("Tabletop Planter", "Ceramic", r"\b(?:ceramic |diy )?(?:mini )?planter\b"),
    ("Tabletop LED Art", "Acrylic", r"\btabletop led acrylic art\b|\betched acrylic (?:tabletop )?(?:art|light)\b"),
    ("Tabletop Easel", "Dry-Erase", r"\bdry erase easel\b|\btabletop easel\b"),
    ("Bank", "Tabletop", r"\b(?:mdf |ceramic )?bank\b"),
    ("Wall Clock", "Molded Plastic", r"\b(?:pp|polypropylene)? ?molded wall clock\b|\bpp wall clock\b"),
    ("Wall Clock", "MDF", r"\b(?:die cut |round )?mdf (?:wall )?clock\b|\bwall clock plaque\b"),
    ("Wall Clock", "Metal", r"\bmetal wall clock\b"),
    ("Wall Clock", "Clock", r"\bwall clock\b"),
    ("Desktop Clock", "Alarm", r"\b(?:metal )?(?:alarm|desktop) clock\b"),
    ("Storage Hamper", "Mesh", r"\bmesh pop up hamper\b|\bpolymesh hamper\b"),
    ("Storage Hamper", "Felt", r"\bfelt (?:oval |half moon |tapered )?hamper\b"),
    ("Storage Hamper", "Fabric", r"\b(?:fabric |oxford |greyboard |faux leather |nonwoven |rectangle |rectangular |storage )+hamper\b|\bhamper\b"),
    ("Storage Toy Chest", "Fabric", r"\b(?:nonwoven |fabric |oxford |collapsible |storage )*toy chest\b|\btoy bin\b"),
    ("Storage Chest", "Greyboard", r"\b(?:flat top |domed |greyboard |storage )+storage chest\b|\bgreyboard (?:toy )?chest\b"),
    ("Storage Chest", "Plastic", r"\bplastic storage chest\b"),
    ("Storage Bin", "Fabric", r"\b(?:storage |fabric |woven |oxford |greyboard |tapered |rectangle |square |medium |large )+bin\b|\bstorage bin\b"),
    ("Storage Basket", "Fabric", r"\b(?:storage |plush |rope |woven |seagrass )+basket\b|\bstorage basket\b"),
    ("Storage Cube", "Collapsible", r"\b(?:storage |fabric |nonwoven |collapsible )+cube\b|\bdesktop cube\b"),
    ("Storage Ottoman", "MDF", r"\b(?:mdf )?storage ottoman\b"),
    ("Storage Organizer", "Hanging", r"\b(?:hanging |closet |shoe |file |pocket |storage )+organi[sz]er\b"),
    ("Storage Tower", "Tower", r"\bstorage towers?\b|\bstorage stands?\b|\bdrawer tier storage\b"),
    ("Hard Storage Box", "Faux Book", r"\bfaux book storage\b|\bgreyboard book storage\b"),
    ("Hard Storage Box", "Suitcase", r"\bsuitcase (?:greyboard )?storage\b"),
    ("Hard Storage Box", "Lift-Off", r"\blift off (?:lid )?(?:storage|box)\b|\blid box\b|\bglitter lid box\b"),
    ("Hard Storage Box", "Function Box", r"\b(?:storage |greyboard |plastic )+box\b|\bfunction box\b|\b7pc box set\b"),
    ("Hard Storage Box", "Flip-Top", r"\b(?:greyboard )?flip top box\b"),
    ("Tray or Dish", "Ceramic", r"\b(?:ceramic |polyresin )?(?:trinket )?tray\b|\bceramic dish\b"),
    ("Tray or Dish", "Acrylic", r"\bacrylic tray\b"),
    ("Tray or Dish", "Glass", r"\bglass tray\b"),
    ("Tray or Dish", "Wood", r"\bwood tray\b"),
    ("Pencil Cup", "Organizer", r"\bpencil cup\b|\bresin pencil\b"),
    ("Memo Holder", "Desktop", r"\bmemo holder\b|\bsticky note holder\b|\bmemo pad\b"),
    ("Stationery Organizer", "Multi-Section", r"\b(?:desk |stationery |stationary |mail |desktop )+organi[sz]er\b|\bdesktop org set\b|\bdesk set organizer\b"),
    ("Phone Stand", "Desktop", r"\b(?:desktop |mdf |plastic |pvc molded )?phone stand\b"),
    ("Tablet Stand", "Desktop", r"\b(?:desktop |mdf )?tablet stand\b"),
    ("Headphone Stand", "Desktop", r"\bheadphone stand\b"),
    ("Desk Mat", "Rubber", r"\bdesk ?mat\b"),
    ("Lap Desk", "Lapdesk", r"\b(?:plastic |tech |rectangle |writing |mdf )?lap ?desk\b|\blap writing desk\b"),
    ("Monitor Stand", "Desktop", r"\bmonitor stand\b"),
    ("Door Mat", "Crumb Rubber Outdoor", r"\bcrumb rubber outdoor mat\b"),
    ("Door Mat", "Crumb Rubber Door", r"\bcrumb rubber door mat\b|\bpoly doormat\b"),
    ("Door Mat", "Coir", r"\b(?:shaped |panama |debossed )?coir (?:door )?mat\b"),
    ("Door Mat", "Velvet", r"\b(?:custom )?shaped velvet mat\b"),
    ("Door Mat", "Memory Foam", r"\bmemory foam floor mat\b"),
    ("Door Mat", "Floor", r"\bdoor ?mat\b|\bdoormat\b|\bfloor mat\b|\bassorted? .{0,20} mats\b"),
    ("Kitchen Mat", "Anti-Fatigue PVC", r"\banti fatigue (?:pvc )?kitchen(?: mat)?\b|\bkitchen pvc mat\b"),
    ("Kitchen Mat", "PVC Foam", r"\b(?:pvc )?kitchen mat\b"),
    ("Rug", "Floor", r"\brug\b"),
    ("Garden Sign or Flag", "Outdoor", r"\b(?:lawn sign|garden flag)\b"),
    ("Birdhouse or Feeder", "Wood", r"\b(?:bird ?house|bird feeder)\b"),
    ("Stepping Stone", "Concrete", r"\b(?:concrete )?stepping stone\b"),
    ("Garden Tool", "Tool Set", r"\bgarden tool set\b"),
    ("Garden Thermometer", "Metal", r"\bgarden thermometer\b|\biron thermometer\b"),
    ("Watering Can", "Metal", r"\bwatering can\b"),
    ("Garden Kneeler", "Kneeler", r"\bkneeler\b"),
    ("Garden Decor", "Outdoor", r"\bgarden (?:stake|decor|decoration)\b"),
    ("Keychain", "Plush", r"\bplush keychain\b"),
    ("Embroidery Kit", "DIY", r"\b(?:diy )?embroidery kit\b"),
    ("Book", "Printed Book", r"\b(?:coloring|activity|reading|math|problem|stories|story|prompt|word find|sudoku|test prep)? ?books?\b|\bpop up books?\b|\bhard cover stories\b"),
    ("Display Rack", "Retail Fixture", r"\b(?:spinner|pocket|column|tier) racks?\b|\bspinner\b"),
)

PRODUCT_PATTERNS = tuple((product, construction, re.compile(pattern, re.I)) for product, construction, pattern in PRODUCT_PATTERNS)


def treatment_from_text(text: str, product: str) -> str:
    checks = (
        ("DIY", r"\b(?:diy|pbn|paint by numbers?|paint your own)\b"),
        ("LED", r"\b(?:led|light up|lightup|backlit|neon)\b"),
        ("Foil", r"\b(?:foil|holofoil|holographic|gold leaf)\b"),
        ("Embroidery", r"\b(?:embroidered|embroidery|cross stitch|chenille|applique)\b"),
        ("High Gloss", r"\b(?:high|hi) gloss\b"),
        ("Glitter", r"\b(?:glitter|sequin|rhinestone|diamond dust|crystal gravel)\b"),
        ("Handpaint", r"\bhand ?paint(?:ed)?\b"),
        ("Gel Coat", r"\b(?:gel|gel coat|allover gel|spot gel|varnish)\b"),
        ("Metallic", r"\b(?:metallic|metal plate|metallic pu)\b"),
        ("Staggered", r"\bstaggered\b|\b[2-9] ?(?:piece|pc) (?:multi )?(?:panel )?canvas\b"),
        ("Shaped", r"\b(?:shaped|die cut|arched|round|hexagon|custom shape)\b"),
        ("Attachment", r"\b(?:attachment|raised|layered|fabric bow|grommet|shoelace)\b"),
        ("Debossed or Embossed", r"\b(?:debossed|embossed|raised embossed)\b"),
        ("Printed", r"\b(?:printed|print)\b"),
    )
    for treatment, pattern in checks:
        if re.search(pattern, text):
            return treatment
    if product in {"Canvas", "Framed Print", "Framed Glass Art", "Door Mat"}:
        return "Plain or Printed"
    return ""


def classify_semantic_signature(value: object) -> SemanticSignature:
    original = "" if pd.isna(value) else str(value)
    reason = unusable_reason(original)
    if reason:
        return SemanticSignature(status="placeholder", decision=reason)
    text = normalize(original)
    for product, construction, pattern in PRODUCT_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        treatment = treatment_from_text(text, product)
        wording = " ".join(match.group(0).split())
        return SemanticSignature(
            physical_product=product,
            construction_shape=construction,
            treatment=treatment,
            matched_wording=wording,
            status="accepted",
            decision="Reviewed physical-product rule matched the full description",
        )
    return SemanticSignature()


GENERIC_ONLY = {"mat", "box", "set", "art", "board", "bin", "storage", "decor", "wall art"}


def validate_signature(signature: SemanticSignature) -> list[str]:
    errors: list[str] = []
    if signature.status == "accepted" and not signature.physical_product:
        errors.append("accepted signature lacks physical product")
    if signature.status not in {"accepted", "alias", "rejected", "placeholder", "needs_review"}:
        errors.append("invalid status")
    if normalize(signature.matched_wording) in GENERIC_ONLY and signature.status in {"accepted", "alias"}:
        errors.append("generic noun wording cannot be accepted or aliased")
    if signature.status in {"rejected", "placeholder", "needs_review"} and signature.physical_product:
        errors.append("non-accepted signature cannot carry a physical product")
    return errors
