"""Conservative, evidence-only API for product descriptions.

The legacy MG reader is preserved separately: its inferred defaults are never
returned by this API. Unknown and conflicting wording stays unreadable.
"""
from __future__ import annotations

import math
import re
import unicodedata

from .legacy import PRODUCT_PATTERNS as LEGACY_PATTERNS
from .construction_rules import _VISUAL_CONTENT, refine_construction
from .material_rules import extract_materials
from .treatment_rules import extract_treatments
from .storage_rules import refine_storage_type

RULES_VERSION = "product-type-reader/1"
DIMENSION = re.compile(
    r'(?<![A-Za-z0-9])\d+(?:\.\d+)?\s*(?:in(?:ches?)?|["”″])?\s*[x×]\s*'
    r'\d+(?:\.\d+)?(?:\s*(?:in(?:ches?)?|["”″]))?'
    r'(?:\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|cm|in(?:ches?)?|["”″])?(?:\s*[dDhH]\b)?)?', re.I)


def normalize(value: object) -> str:
    if value is None or isinstance(value, float) and math.isnan(value):
        return ""
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\bnon[\s-]+woven\b", "nonwoven", text)
    text = re.sub(r"\b(distressed|licenses|r)(?=canvas\b)", r"\1 ", text)
    text = re.sub(r"\b(canvas)(?=(?:w\b|\d{2}\b|\d{2}\s*x\s*\d{2}\b))", r"\1 ", text)
    text = re.sub(r"\bcanva(?=\s+(?:w|with)\b)", "canvas", text)
    replacements = {"shadow box": "shadowbox", "shadow bx": "shadowbox", "shdwbx": "shadowbox",
        "bird house": "birdhouse", "pin board": "pinboard",
        "shdbx": "shadowbox", "die-cut": "die cut", "diecut": "die cut", "doublelayer": "double layer",
        "fatique": "fatigue", "cnvs": "canvas", "cnvas": "canvas", "cvs": "canvas", "lenicular": "lenticular", "lenitcular": "lenticular",
        "frmd": "framed", "frmed": "framed", "frme": "frame", "fltr": "floater", "flter": "floater", "lnticulr": "lenticular",
        "pritned": "printed", "mlded": "molded",
        "prntd": "printed", "prnt": "print", "grybrd": "greyboard", "strge": "storage", "strg": "storage",
        "dcor": "decor", "deocr": "decor", "mtallic": "metallic", "glss": "glass", "acylic": "acrylic", "outfdoor": "outdoor", "velvetmat": "velvet mat",
        "papercard": "paper card", "ppr": "paper", "grbrd": "greyboard", "grbd": "greyboard", "cnv": "canvas",
        "glttr": "glitter", "hghglss": "high gloss", "flt": "float", "flting": "floating",
        "lentculr": "lenticular", "lntclr": "lenticular", "cubeart": "cube art", "organzer": "organizer",
        "lentclr": "lenticular", "dsk": "desk", "llap": "lap", "colcks": "clocks",
        "drwr": "drawer", "nonwvn": "nonwoven", "hnging": "hanging", "clst": "closet",
        "prch": "porch", "lnr": "leaner", "stne": "stone", "stpping": "stepping",
        "fbrc": "fabric", "chst": "chest", "chsts": "chests", "grayboard": "greyboard",
        "fx book": "faux book", "embossd": "embossed", "embss": "embossed", "embsd": "embossed", "floatingframe": "floating frame",
        "clck": "clock", "canv": "canvas", "pcture": "picture", "vrnish": "varnish",
        "clndr": "calendar",
        "trnkt": "trinket",
        "cntdwn": "countdown", "calndr": "calendar",
        "stbck": "setback", "mntd": "mounted",
        "mld": "molded", "wll": "wall", "lanscape": "landscape",
        "hngng": "hanging", "rbbn": "ribbon", "glltr": "glitter",
        "fltng": "floating", "embssd": "embossed", "metllc": "metallic", "stoarge": "storage", "strage": "storage",
        "mettalic": "metallic", "shawdowbox": "shadowbox", "shadowbow": "shadowbox",
        "shawowbox": "shadowbox", "shadwoboxes": "shadowboxes", "shdwbox": "shadowbox", "shwbx": "shadowbox",
        "assrortment": "assortment", "asstd": "assorted", "assted": "assorted",
        "fltoff": "lift off", "lftoff": "lift off", "lft off": "lift off",
        "slvr": "silver", "gld": "gold"}
    for old, new in replacements.items():
        text = re.sub(r"\b" + re.escape(old) + r"\b", new, text)
    text = re.sub(r"\bfloating frm\b", "floating frame", text)
    text = re.sub(r"\bpicture frm\b", "picture frame", text)
    text = re.sub(r"\bphot frame\b", "photo frame", text)
    text = re.sub(r"\bfrm\b", "framed", text)
    text = re.sub(r"\bframe(?=embossed\b)", "frame ", text)
    text = re.sub(r"\bblock(?=\d)", "block ", text)
    text = re.sub(r"\b((?:mdf|die cut) )blck\b", r"\1block", text)
    # These catalog abbreviations identify a product only beside its substrate.
    text = re.sub(r"\bcoir\s+mart\b", "coir mat", text)
    text = re.sub(r"\b(mdf|greyboard|plastic|wood|metal)\s+bx\b", r"\1 box", text)
    text = re.sub(r"\bgreyboard\s+lift[-\s]+off\s+lid\s+bx\b", "greyboard lift off lid box", text)
    text = re.sub(r"\b(?:cnvs|cnv|cvs)(?=\d)", "canvas ", text)
    text = re.sub(r"\bfasux\b", "faux", text)
    text = re.sub(r"\bsrtorage\b", "storage", text)
    text = re.sub(r"(?<=[a-z])(?:cnvs|cnv)\b", " canvas", text)
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


# Specific physical nouns take precedence over the legacy generic Canvas rule.
_FIXES = (
    ("Corkboard with Dry-Erase Board", r"\bcorkboard with magnetic dry erase(?:\s+\w+){0,3}\s+pins?\b"),
    ("Canvas", r"\bcanvasboard\b"),
    ("Storage Bin", r"\b(?:storage )?bins?\b"),
    ("Storage Bin", r"\btoy bins?\b"),
    ("Storage Box", r"\bgreyboard lift off lid box\b"),
    ("Decorative Bow", r"\bdimensional bow\b"),
    ("Jewelry Box", r"\bjewelry box(?:es)?\b"),
    ("Countdown Calendar", r"\b(?:mdf )?block countdown calendar\b"),
    ("Advent Calendar", r"\badvent calendars?\b"),
    ("Neon LED Light", r"\bneon led lights?\b"),
    ("Easel", r"\bdry erase canvas (?:\w+ ){0,3}easels?\b"),
    ("Decorative Shape", r"\b(?:die cut )?decorative shapes?\b"),
    ("Hanging Organizer", r"\bhanging organizers?\b"),
    ("Shadowbox", r"\b(?:shadwbx|shadwbox|shbx)\b"),
    ("Storage Chest", r"\bdome chests?\b"),
    ("Suncatcher", r"\bsuncatchers?\b"),
    ("Block", r"\bblocks?\s+(?:with|w)\s+prints?\b"),
    ("Storage Caddy", r"\bstorage cadd(?:y|ies)\b"),
    ("Hanging Closet Organizer", r"\bstorage \d+ shelf hanging closet org\b"),
    ("Storage Organizer", r"\bstorage \d+ shelf hanging closet\b"),
    ("Sequin Art", r"\bsequin art\b"),
    ("Sequin Art", r"\bsequin flip art\b"),
    ("Mat", r"\brubbermat\b"),
    ("Calendar", r"\bcalandar\b"),
    ("Mug", r"\bmugs\b"),
    ("Stepping Stone", r"\b(?:cncrte|concrete) stppng (?:stne|stone)\b"),
    ("Planter", r"\bcrmic min plntr\b"),
    ("Slat Art", r"\bslit slat art\b"),
    ("Mask", r"\bmolded polyresin masks?\b"),
    ("Garden Bag", r"\bgarden bags?\b"),
    ("Display Rack", r"\bdisplay racks?\b"),
    ("Photo Display String", r"\bphoto string (?:w|with) holders?\b"),
    ("Wall Basket", r"\bwall baskets?\b"),
    ("Bunting", r"\bbunting\b"),
    ("Canvas Tapestry", r"\bcanvas tapsetry\b"),
    ("Canvas Frame", r"\bcanvas frames?\b"),
    ("Frame", r"\bbaby frames?\b"),
    ("Faux Book", r"\bfaux boox storage\b"),
    ("Painting Kit", r"\bdiy set (?:w|with) \d+ paint pots? (?:and )?brsh\b"),
    ("Shape", r"\bmdf shapes?\b"),
    ("Tabletop Art", r"\btabletop art\b"),
    ("Shelf with Hooks", r"(?<!wall )\bshelf (?:w|with) hooks?\b"),
    ("Decorative Object", r"\bdimensional (?:\w+ )?objects?\b"),
    ("Framed Puzzle Art", r"\bframed puzzle art\b"),
    ("LED Infinity Art", r"\binfinity led art\b|\bled infinity art\b"),
    ("Wall Art", r"\bled infinity wall art\b"),
    ("Countdown Clock", r"\bcountdown clocks?\b"),
    ("Tall Sign", r"\btall (?:\w+ ){0,3}(?:mdf )?sign\b"),
    ("Perpetual Calendar with Pencil Cup", r"\bperpetual calendar (?:w|with) (?:\w+ )?pencil cup\b"),
    ("Framed Art", r"\bframed deckle(?:d)? edge art\b"),
    ("Framed Art", r"\bframed 3 d wall art\b"),
    ("Plaque", r"\bchalkboard plaques?\b|\bplque\b"),
    ("Tabletop Clock", r"\btabletop clocks?\b"),
    ("Tabletop Block", r"\bmdf tabletop bobble head block\b"),
    ("Magnet Board", r"\bmagnet boards?\b"),
    ("Storage Hamper", r"\b(?:oval|ovl) hmpr\b"),
    ("Wall Scroll", r"\bwall scrolls?\b"),
    ("Hanging Closet Organizer", r"\b(?:\d+ )?shlf hanging (?:clst|closet) org\b"),
    ("Tray", r"\b(?:(?:ceramic|polyresin|acrylic|glass|wood) )?trays?\b"),
    ("Desktop Organizer", r"\bdesktop storage cubb(?:y|ies)\b"),
    ("Stationery Organizer", r"\b(?:stationery|stationary) organi[sz]ers?\b"),
    ("Mail Organizer", r"\bmail organi[sz]ers?\b"),
    ("Organizer", r"\bfaux book organi[sz]ers?\b"),
    ("Recipe Box", r"\brecipe box(?:es)?\b|\brecipe grey ?board box\b"),
    ("Dry-Erase and Pin Board", r"\bdry erase and (?:\w+ )?pin ?boards?\b"),
    ("Print", r"\bmdf spot varnish prints?\b"),
    ("Planter with Photo Frame", r"\bplanter (?:w|with) (?:a )?photo frame\b"),
    ("String Lights", r"\bstring(?:ed)? lights?\b"),
    ("Light", r"\bled lightbulbs?\b|\bled back lights?\b"),
    ("Frame", r"\bmultiframes?\b"),
    ("Ring Dish", r"\bring dish(?:es)?\b"),
    ("Sticker", r"\bstickers?\b"),
    ("Decorative Flag", r"\b(?:solid wood|wooden) flags?\b"),
    ("Decorative Knot", r"\bclay knots?\b"),
    ("Decorative Chain", r"\bthree chain links\b"),
    ("Framed Glass Shadowbox", r"\bprinted glass shadowbox frame\b|\bprinted glass shadowbox\b"),
    ("Framed Shadowbox", r"\bshadowbox frame\b"),
    ("Framed Glass Art", r"\bframed (?:hexagonal |round )?(?:painted )?glass\b"),
    ("Framed Glass Art", r"\betched glass in (?:an? )?led frame\b"),
    ("Framed Glass Art", r"\bprinted glass (?:(?!artwork|graphic|design|image|scene)\w+ ){0,5}poster in frame\b"),
    ("Glass Shadowbox", r"\bprint glass shadowbox\b|\bshadowbox under glass\b"),
    ("Glass Art", r"\b(?:print on|print) glass\b"),
    ("Framed Collage", r"\bcollage framed\b"),
    ("Framed Canvas", r"\bfloating frame (?:embossed|emboss) print canvas\b"),
    ("Relief Wall Art", r"\b(?:wood|wooden) relief wall art\b"),
    ("Framed Fabric Art", r"\bframed frayed linen under glass\b|\bframed linen (?:w|with) frayed edges\b"),
    ("Framed Print", r"\bframed printed mdf\b|\bframed mdf (?:with )?printed (?:\w+ )?paper(?: under glass)?\b|\bframed deckle(?:d)? edge metallic paper\b|\bframed holographic printed faux leather\b|\bframed (?:w|with) printed metallic pu\b"),
    ("Framed Print", r"\bframed linen under glass with deckle(?:d)? edge prints?\b"
     r"|\bmetal bow frame mdf prints?\b|\bframed glitter prints?\b"
     r"|\bframed layered mdf prints?\b|\bframed (?:high|hgh) (?:gloss|glass) prints?\b"
     r"|\bframed prints?\b|\bmdf prints? with thin black frame\b"),
    ("Framed Print", r"\bframed mdf with paper prints?\b|\bframed mdf arched prints?\b"),
    ("Framed Print", r"\bframe (?:w|with) paper prints?\b"),
    ("Framed Print", r"\bminimalist print in mdf frame\b|\bmdf high gloss print in setback frame\b|\bframed newspaper under glass\b|\b(?:floating|float) (?:frame|framed) (?:embossed|emboss) paper print\b"),
    ("Framed Print", r"\bsetback frame (?:w|with) printed linen paper\b"),
    ("Framed Art", r"\b(?:portrait|landscape) in (?:\w+ )?frame\b|\bmolded frame art\b|\bpressed leaves under glass in (?:\w+ )?frame\b"),
    ("Framed Art", r"\bframed (?:pu mounted|puzzle) art\b|\bsetback framed mounted art\b"),
    ("Framed Art", r"\bframed foil art under glass\b"),
    ("Embroidery Art", r"\bcross stitch embroidery art\b"),
    ("Framed Art", r"\bsetback frame (?:w|with) raised (?:icons?|blocks?)\b|\bpuzzle art (?:w|with) (?:\w+ )?frame\b|\bwrapped linen in (?:a )?floating frame\b"),
    ("Framed Art", r"\bframed rattan (?:w|with) raised resin icon\b"),
    ("Framed Art", r"\b(?:2|two|double) layer framed die cut greyboard\b|\bsetback framed metallic pu\b|\bsetback framed (?:w|with) metallic pu\b"),
    ("Framed Canvas", r"\bframed (?:(?:embossed|paper|high gloss) )+canvas\b|\b(?:floating|floater|float) frame embroidered canvas\b"),
    ("Framed Canvas", r"\bframed art (?:w|with) (?:handpainted|painted) canvas\b"),
    ("Wall Art", r"\bwool fabric embroidered hanging wall art\b"),
    ("Sign", r"\bsign wool fabric embroidered hanging wall art\b"),
    ("Wall Art", r"\bwall deco\b"),
    ("Wall Art", r"\bframe wall art\b"),
    ("Banner", r"\b(?:canvas )?hanging (?:fishtail )?banners?\b"),
    ("Banner", r"\bframed banner (?:under|undr) glass\b"),
    ("Pennant", r"\bpennants?\b"),
    ("Hanging Poster", r"\bhanging posters?\b"),
    ("Bird Feeder", r"\bbird feeders?\b"),
    ("Magazine Holder", r"\bmagazine holders?\b"),
    ("Gel Sticker", r"\bgel stickers?\b"),
    ("Light-Up Silhouette", r"\b(?:led lit )?silhouette (?:light ?up|lit)\b|\bled lit silhouette\b"),
    ("Dimensional Decor", r"\bdimensional (?:bow|deer head)\b"),
    ("Wall Pegs", r"\bwall pegs\b"),
    ("Pencil Cup", r"\bpencil cups?\b"),
    ("Chalkboard", r"\bchalkboards?\b"),
    ("Print", r"\bmdf prints?\b"),
    ("Storage Trunk", r"\b(?:storage )?trunks?\b"),
    ("Storage Ottoman", r"\b(?:storage ottoman|ottoman storage)\b"),
    ("Tabletop Decor", r"\btabletop decor\b"),
    ("Storage Cube", r"\bstorage cubes?\b"),
    ("Comic Art", r"\bfake comic under glass\b"),
    ("Leaner Sign", r"\bleaner\b"),
    ("Art Print", r"\bart prints?\b"),
    ("Cast Frame", r"\bcast frames?\b"),
    ("Wall Art", r"\bwall decor(?:ation)?\b"),
    ("Button Art", r"\bbutton art\b"),
    ("Mirror", r"\b(?:infinity |decorative (?:led )?)?mirror(?: wall art)?\b"),
    ("Letterboard", r"\bletterboards?\b"),
    ("Easel", r"\bdry erase easels?\b"),
    ("Framed Canvas", r"\bframed (?:printed )?canvas\b|\bcanvas framed\b|\bcanvas (?:print )?(?:(?:w|with|in) (?:a )?(?:(?:acrylic|metallic|plastic|wood|mdf) )?)?(?:floating|floater|float) frame\b|\bcanvas (?:print )?(?:w|with) acrylic frame\b|\b(?:floating|floater|float) frame(?:d)? ?(?:(?:w|with) )?(?:embossed |high gloss |metallic |printed )*canvas\b"),
    ("Framed Canvas", r"\bcanvas (?:\w+ ){0,2}in (?:an? )?ornate frame\b|\bfloating (?:\w+ ){0,2}frame canvas\b"),
    ("Framed Canvas", r"\bframed (?:cotton )?canvas flag\b|\bframed float(?:ed|ing)? canvas\b|\bcanvas floater framed\b"),
    ("Framed Glass Art", r"\bframed stained glass art\b|\bstained glass (?:w|with) (?:\w+ )?frame\b|\bprinted glass (?:w|with) (?:\w+ )?frame\b"),
    ("Framed Glass Art", r"\bframed printed glass\b|\bprinted glass (?:w|with) (?:\w+ ){0,6}frame\b"),
    ("Storage Toy Chest", r"\b(?:greyboard |storage )?toy chests?\b"),
    ("Trinket Tray", r"\btrinket tray(?:s)?\b"),
    ("Porch Leaner", r"\bporch leaners?\b"),
    ("Stepping Stone", r"\bstepping stones?\b"),
    ("Wall Figure", r"\bwall figures?\b"),
    ("Wall Mask", r"\bwall masks?\b"),
    ("Votive Holder", r"\bvotive holders?\b"),
    ("Birdhouse", r"\bbirdhouses?\b"),
    ("Pinboard", r"\b(?:fabric )?pinboards?\b"),
    ("Lawn Sign", r"\blawn signs?\b"),
    ("Kitchen Organizer", r"\bkitchen organi[sz]ers?\b"),
    ("Hanging Organizer", r"\bhanging (?:\d+ )?shelf organi[sz]er\b|\b\d+ shelf hanging organi[sz]er\b"),
    ("Wall Plaque", r"\bwall plaques?\b"),
    ("Wall Tile", r"\bwall tiles?\b"),
    ("Planter", r"\bplanters?\b"),
    ("Floating Character Box", r"\bmdf box with floating character\b"),
    ("Door Mat", r"\bdoor ?mats?\b|\bdoormats?\b"),
    ("Framed Art", r"\b(?:arch |squiggle )?framed wall art\b|\bframe wall art\b|\bcollage framed\b|\bframed deckle(?:d)? edge paper\b|\bframed (?:mdf|paper)\b|\bfrm mdf\b"),
    ("Framed Collage", r"\b(?:comic |generic )?collage framed\b|\bframed comic collage\b"),
    ("Framed Fabric Art", r"\b(?:linen|burlap) framed\b|\bframed frayed burlap\b"),
    ("Storage Box", r"\bshaped box storage\b"),
    ("Storage Box", r"\bbox (?:greyboard |mdf )?storage(?: set)?\b"),
    ("MDF Box", r"\bchalkboard art mdf box\b"),
    ("Decorative Word", r"\b(?:mdf|wire|comic wrapped) words?\b"),
    ("Framed Print", r"\b(?:printed )?mdf (?:print )?in (?:a )?(?:deep|floating|floater|float|setback) frame\b|\bframed (?:matted )?(?:paper |linen )?print\b|\b(?:soft touch )?print framed\b|\bframed deckle(?:d)? (?:edge paper )?print\b|\bdeep framed mdf print\b|\bsoft touch paper framed\b|\b(?:float|floating|floater) frame (?:emboss(?:ed)? )?(?:paper )?print\b"),
    ("Framed Print", r"\b(?:embossed )?(?:paper )?print (?:with foil )?(?:in|on|with) (?:a )?(?:(?:floating|floater|wood) )?frame\b|\bframed comic books? under glass\b|\bminimalist print in wood frame\b"),
    ("Photo Frame", r"\b(?:infant )?multi photo (?:mdf )?collage frame\b|\bpicture multi frame collage\b"),
    ("Framed Lenticular Art", r"\bframed (?:3d )?lenticular\b|\b3d frame lenticular art framed\b"),
    ("Framed Lenticular Art", r"\bframed (?:3d )?mdf lenticular\b"),
    ("Lenticular Art", r"\blenticular\b(?! material\b)"),
    ("Framed Print", r"\bframed poster\b"),
    ("Plush Cube Art", r"\bplush cube art\b"),
    ("Cube", r"\bceramic cubes?\b"),
    ("Decorative Figure", r"\b(?:mdf )?die cut figures?\b"),
    ("Hook Plaque", r"\bhook plaque\b"),
    ("Guitar Hook", r"\bguitar hooks?\b"),
    ("Kitchen Mat", r"\bkitchen mats?\b"),
    ("Neon Box", r"\bneon box(?:es)?\b"),
    ("Wall Clock", r"\bwall clocks?\b"),
    ("Garden Tool Set", r"\bgarden tools? sets?\b"),
    ("Garden Tool", r"\bgarden tools?\b"),
    ("Plaque", r"\b(?:mdf )?plaque (?:w|with) (?:\d+ )?hooks\b"),
    ("Candle Holder", r"\bcandle holder with shelf\b"),
    ("Message Board", r"\b(?:printed glass )?shadowbox message board\b"),
    ("Hanging Shoe Organizer", r"\bhanging shoe organi[sz]er\b"),
    ("Jewelry Box", r"\bjewelry box\b"),
    ("Desktop Organizer", r"\b(?:desk|desktop) (?:set )?(?:org|organizer|cubby)\b"),
    ("Faux Book", r"\bfaux books? desktop storage\b|\bfaux books? storage\b"),
    ("Faux Book", r"\bfaux books?\b"),
    ("Desktop Organizer", r"\bfaux books? desk organizer\b"),
    ("MDF Box", r"\bmdf (?:reverse )?box(?:es)?\b"),
    ("Framed Mirror", r"\bframed mirrors?\b"),
    ("Storage Chest", r"\bstorage chests?\b"),
    ("Storage Suitcase", r"\bsuitcs\b|\bsuitcases? (?:(?:greyboard|mdf) )?storage\b"),
    ("Storage Tower", r"\bstorage towers?\b"),
    ("Hang Tab", r"\bhang tabs?\b"),
    ("Art", r"\b(?:high gloss|mdf|die cut|diecut|pieced|metal|double layer|hexagon|leather|suede|satin|pu leather|molded) art\b"
     r"|\b(?:mdf (?:die cut )?(?:silhouette|pieced logo)) art\b"
     r"|\bdie cut pieced mdf logo art\b|\b(?:metallic|cross stitch embroidered|led neon wire) art\b"),
    ("Art", r"\bhigh gloss small art\b|\bdouble layer (?!die(?:\s|-)?cut\b)(?:\w+ ){0,2}art\b"
     r"|\bframed deckle(?:d)? edge art\b|\bglitter uv lacquer art\b"
     r"|\bmolded (?!(?:foam|shadowbox|frame)\b)\w+ art\b|\bled infinity (?:\w+ ){1,3}art\b"),
    ("Die-Cut Art", r"\bdouble layer die cut (?:\w+ ){1,2}art\b"),
    ("Boxed Art", r"\bboxed art\b"),
    ("Storage Chest", r"\bdomed chests?\b"),
    ("Growth Chart", r"\bsize chart(?: long)? canvas\b"),
    ("Hard Storage Box", r"\bglass storage box(?:es)?\b"),
    ("Box", r"\bbox(?: art)? with hooks\b"),
    ("Message Box", r"\bmessage box(?:es)?\b"),
    ("File Organizer", r"\b(?:hanging )?file organi[sz]er\b"),
    ("Hanging Closet Organizer", r"\b(?:\d+ )?shelf hanging closet organi[sz]er\b|\bhanging closet organi[sz]er\b"),
    ("Alarm Clock", r"\b(?:desktop )?alarm clock\b"),
    ("Tapestry", r"\b(?:hanging )?tapestry\b"),
    ("Framed Glass Shadowbox", r"\b(?:printed )?glass shadowboxes?\b|\bprinted glass sb\b|\bprinted glass shawdowbox\b|\bglass \w+ shadowbox frame\b"),
    ("Window Cling", r"\bwindow clings?\b"),
    ("Hard Storage Box", r"\blift off boxes\b"),
    ("Photo Frame", r"\b(?:multi |collage |infant )?(?:photo|picture|phto) frames?\b|\bbaby frames\b"),
    ("Frame", r"\b(?:mdf|pvc|wood|plastic) shaped frames?\b|\bportrait mdf frames?\b"),
    ("Wall Shelf", r"\bwall shelf\b"),
    ("Shelf", r"\b(?:half face )?shelf\b"),
    ("Pencil Case", r"\bpencil case\b"),
    ("Tabletop Block", r"\b(?:mdf )?die cut block\b|\bdomed? block(?: tabletop decor)?\b"),
    ("Tabletop Block", r"\btable top block\b|\bblock tabletop decor\b"),
    ("Floating Character Box", r"\bfloating character box\b"),
    ("Framed Print", r"\bmdf print framed\b|\bframed mdf print\b|\bprint in framed mdf\b"),
    ("Framed Art", r"\bframed (?:mdf |paper )?art\b"),
    ("Box Shelf", r"\b(?:mdf )?box shelf\b"),
    ("Box Frame", r"\b(?:mdf )?box (?:with glitter )?frame\b"),
    ("Coaster", r"\b(?:printed )?(?:glass )?coasters?\b"),
    ("Hard Storage Box", r"\bbox lift off (?:greyboard )?storage\b"),
    ("Die-Cut Art", r"\b(?:double layer )?die cut art\b"),
    ("Floor Mat", r"\b(?:memory foam )?floor mat\b"),
    ("Growth Chart", r"\b(?:canvas )?growth charts?\b"),
    ("Folding Frame Set", r"\bfolding (?:canvas texture )?frame set\b"),
    ("Folding Frame", r"\bfolding (?:canvas texture )?frame\b(?! set)"),
    ("Framed Art", r"\bframed mdf\b(?! (?:print|art))"),
    ("Framed Print", r"\bfloating frame (?:embossed )?paper print\b"),
    ("Perpetual Calendar", r"\b(?:block mdf )?perpetual calendars?\b"),
    ("Writing Desk", r"\b(?:mdf )?writing desks?\b"),
    ("Tall Sign", r"\bporch leaner hanging sign\b"),
    ("MDF Box", r"\bmdf box art\b"),
    ("Framed Shadowbox", r"\bshadowboxes\b"),
    ("Phone Stand", r"\bphone stands\b"),
    ("Lap Desk", r"\blap desks\b"),
    ("Framed Canvas", r"\b(?:floater|floating|float) frame(?:d)? canvas\b|\bcanvas (?:(?:with|in) )?(?:metallic )?(?:floater|floating|float) frame\b"),
    ("Paint-Your-Own Canvas Set", r"\b(?:diy|paint your own|paint by numbers?) canvas\b"),
    ("Paint-Your-Own Canvas Set", r"\bcanvas (?:set )?(?:(?:with|w) )?(?:\d+ )?(?:(?:paint|pnt) pots?|brush(?:es)?)\b|\b(?:pbn|diy) (?:printed )?canvas\b|\bcanvas set (?:w|with) \d+ paint pts\b"),
    ("Paint-Your-Own Canvas Set", r"\bcanvas set (?:\w+ ){0,3}paint tubes? (?:and )?brushes? (?:and )?palette\b"
     r"|\bcyo canvas kit\b.{0,40}\b(?:paint|pnt) pots?\b"),
    ("Perpetual Calendar", r"\b(?:mdf block |block mdf )?perpetual calendars?\b"),
    ("Countdown Calendar", r"\b(?:mdf block )?countdown calendar\b"),
    ("Outdoor Mat", r"\b(?:crumb rubber )?outdoor mats?\b"),
    ("Mat", r"\b(?:shaped )?(?:coir|velvet) mat\b"),
    ("Mat", r"\b(?:die cut )?tpe (?:floor door|floor or door|door floor) mat\b"),
    ("Door Mat", r"\bcrumb rubber mat with pp felt face door mat\b"),
    ("Mat", r"\b(?:printed )?pvc foam mat\b|\bcustom shaped mat\b"),
    ("Perpetual Calendar", r"\bblock perpetual calendars?(?: mdf)?\b"),
    ("Framed Lenticular Art", r"\b3d lenticular(?: portrait)? in (?:\d+ )?(?:(?:mdf|greyboard|plastic) )?frame\b"),
    ("Decorative Letter", r"\b(?:mdf|wood|wooden|greyboard) letters?\b"),
    ("Monogram", r"\b(?:mdf|wood|wooden|greyboard|fabric) monogram\b"),
    ("Wall Monogram", r"\bwall monogram\b"),
    ("Tabletop Plaque", r"\b(?:mdf )?tabletop plaque\b"),
    ("Door Sign", r"\b(?:mdf )?door sign\b"),
    ("Shadowbox Bank", r"\bshadowbox bank\b"),
    ("Wall Bank", r"\bwall bank\b"),
    ("Sign", r"\b(?:die cut )?mdf destination signs?\b"),
    ("LED Infinity Art", r"\bled infinity art\b"),
    ("Floating Character Box", r"\bfloating character (?:mdf )?box\b"),
    ("Corkboard", r"\bcork ?board\b"),
    ("Plaque", r"\b(?:3d )?lenticular plaque\b"),
    ("Garden Flag", r"\bgarden flags?\b"),
    ("Framed Art", r"\bframed art under glass\b"),
    ("Sign", r"\b(?:die cut )?mdf (?:die cut )?signs?\b|\b(?:mdf die cut )?destination signs?\b"),
    ("Framed Print", r"\bframed (?:high gloss |hi gloss |soft touch )?print\b"),
    ("Yarn Art", r"\byarn art\b"),
    ("Foam Art", r"\b(?:molded )?foam art\b"),
    ("Relief Art", r"\b3d relief art\b|\brelief art\b"),
)
# ORDER IS LOAD-BEARING: match selection breaks ties by position in this
# tuple, so the curated fixes come first, then the historical MG-era table
# (legacy.LEGACY_PATTERNS, filtered), then the broad Book, Canvas and Plaque
# fallbacks last.  Reordering these extensions changes predictions.
PRODUCT_PATTERNS = tuple((product, re.compile(pattern)) for product, pattern in _FIXES)
PRODUCT_PATTERNS += tuple((product, pattern) for product, _, pattern in LEGACY_PATTERNS
                         if product not in {"Canvas", "Book", "Framed Print", "Wall Shelf", "Framed Glass Art", "Tabletop Planter", "Pencil Cup"}
                         and "plank palette" not in pattern.pattern and "printed galvani" not in pattern.pattern
                         and not (product == "Door Mat" and any(term in pattern.pattern for term in ("coir", "velvet", "floor mat")))
                         and ".{" not in pattern.pattern)
PRODUCT_PATTERNS += (("Book", re.compile(r"\b(?:coloring|colouring|activity|reading|math|problem|story|word find|sudoku|test prep|pop up) books?\b|^books?$")),)
# Catalog convention uses Canvas as a product noun. Other explicit products
# outrank it; Canvas alone never supplies a stretched construction.
PRODUCT_PATTERNS += (("Canvas", re.compile(r"\b(?:(?:stretched|printed|box) )?canvas(?:es)?\b")),)
PRODUCT_PATTERNS += tuple((product, re.compile(pattern)) for product, pattern in (
    ("Plaque", r"\bplaques?\b"),
))

# _MATERIALS marks the product-phrase boundary and feeds _PHYSICAL.  The output
# vocabulary lives in material_rules._MATERIALS; test_caption_invariant pins
# that every name here (except PE, used only for "pe rattan") exists there.
_MATERIALS = (
    ("Crumb Rubber", r"crumb rubber"), ("Memory Foam", r"memory foam"),
    ("MDF", r"mdf"), ("Greyboard", r"greyboard"), ("Canvas", r"canvas(?! texture)"),
    ("Acrylic", r"acrylic"), ("Polyresin", r"polyresin"), ("Ceramic", r"ceramic"),
    ("Glass", r"glass"), ("Metal", r"metal|tin|aluminium|aluminum|iron(?! man)"), ("Steel", r"steel"),
    ("Wire", r"wire"),
    ("Polypropylene", r"polypropylene|pp(?= molded| felt)"), ("PVC", r"pvc"), ("PE", r"pe(?= rattan)"), ("TPE", r"tpe"),
    ("Dolomite", r"dolomite"), ("Plywood", r"plywood"), ("EVA", r"eva"), ("Yarn", r"yarn"),
    ("Plastic", r"plastic"),
    ("Wool", r"wool"), ("Linen", r"linen(?! paper)"), ("Cotton", r"cotton"),
    ("Cork", r"cork(?:board)?"), ("Jute", r"jute"), ("PU Leather", r"pu leather"),
    ("Faux Leather", r"faux leather"), ("Faux Fur", r"faux fur"), ("Polyester", r"polyester"),
    ("PU", r"pu(?! leather)"),
    ("Velvet", r"velvet"), ("Felt", r"felt"),
    ("Fabric", r"fabric|nonwoven|non woven|oxford|plush|burlap"),
    ("Paper", r"paper|paperboard"), ("Wood", r"wood|wooden"), ("Coir", r"coir"),
    ("Foam", r"(?<!memory )foam"), ("Concrete", r"concrete"),
    ("Rope", r"rope"), ("Seagrass", r"seagrass"), ("Rattan", r"(?<!pe )rattan"),
    ("Rubber", r"(?<!crumb )rubber"),
)
# Vocabulary only: _TREATMENTS feeds _PHYSICAL and variant grouping.  The
# product_treatment output comes solely from treatment_rules.extract_treatments.
_TREATMENTS = (
    ("LED", r"leds?|light up|backlit"), ("Foil", r"foil|holofoil"),
    ("Embroidery", r"embroidered|embroidery|cross stitch|applique"),
    ("High Gloss", r"high gloss|hi gloss"), ("Glitter", r"glitter"),
    ("Sequins", r"sequins?"), ("Pearls", r"pearls?"),
    ("Attachment", r"(?:with|w) bows?|bows? attachments?|attached bows?|attachments?|metal grommets(?: and shoelace)?|sherpa fabric|floating foam silhouette"),
    ("Embellished", r"embellish(?:ed|ments?)"),
    ("Rhinestone", r"rhinestone"), ("Crystal Gravel", r"crystal gravel"),
    ("Diamond Dust", r"diamond dust"), ("Puff Paint", r"puff paint"),
    ("Glue Embellishment", r"glue embellishment"), ("Glow in Dark", r"glow in (?:the )?dark"),
    ("Chenille Patch", r"chenille patch"), ("Flocking", r"flocking"),
    ("Gold Leaf", r"gold leaf"), ("Silver Leaf", r"silver leaf"),
    ("Faux Leather Patch", r"faux leather patch"), ("Spot Varnish", r"spot varnish"),
    ("Handpaint", r"handpaint(?:ed)?|hand paint(?:ed)?"), ("Gel Coat", r"gel(?: coat)?|allover gel|all over gel|dripping gel paint"),
    ("Varnish", r"(?<!spot )varnish"), ("Dry-Erase", r"dry erase"),
    ("Adhesive", r"(?:reusable )?adhesive"), ("Soft Touch", r"soft touch"),
    ("Metallic", r"metallic"), ("Embossed", r"embossed"), ("Debossed", r"debossed"),
    ("Stained Glass", r"stained glass"),
)

_CONSTRUCTIONS = (
    ("Die-Cut Attachment", r"die cut icon"),
    ("Die-Cut", r"die cut"), ("Shaped", r"shape|shaped"), ("Dome", r"dome"),
    ("Domed", r"(?<!flat )domed"), ("Floating Frame", r"(?:floater|floating|float) frame"),
    ("Lift-Off", r"lift off(?: lid)?"), ("Double-Layer", r"double layer|2 layer"), ("Boxed", r"boxed"),
    ("Folding", r"folding"),
    ("Framed", r"framed|(?<=in )frame"), ("Stretched", r"stretched"), ("Molded", r"molded"),
    ("Flat-Top", r"flat top|flat lid"), ("Flat-Domed", r"flat domed"), ("Tapered", r"tapered"),
    ("Half-Moon", r"half moon"), ("Rectangular", r"rectangle|rectangular"),
    ("Collapsible", r"collapsible"), ("Anti-Fatigue", r"anti fatigue|antifatigue"),
    ("Layered", r"layered"), ("Laser-Cut", r"laser cut"),
    ("Faux Book", r"faux book"), ("Suitcase", r"suitcase"), ("Setback", r"setback"),
    ("Floating", r"floating character"),
    ("Hanging", r"hanging"), ("Oval", r"oval"),
    ("Matted", r"matted|with mat"), ("Deckled Edge", r"deckled? edge"),
    ("Pop-Up", r"pop up"), ("Set", r"\bset\b|\d+ (?:piece|pc)"),
    ("Panel", r"panel"), ("Staggered", r"staggered"), ("Arched", r"arched"),
    ("Three-Tier", r"3 tier|three tier"), ("Half-Circle", r"half circle"),
    ("Hexagonal", r"hexagon(?:al)?"), ("With Hooks", r"(?:with|w) hooks"),
    ("With Shelf", r"with shelf"), ("Leaner", r"porch leaner|\bleaner\b"),
    ("Fishtail", r"fishtail"),
    ("Squiggle", r"squiggle"), ("Raised", r"raised"),
    ("Clips", r"clips"), ("Slotted", r"slotted"), ("Reverse", r"reverse"),
)
# One physical vocabulary supplies both prefix and suffix parsing. Unknown
# words end the clause, preventing a global scan through artwork/property text.
_PHYSICAL = "|".join(f"(?:{pattern})" for _, pattern in (*_TREATMENTS, *_CONSTRUCTIONS, *_MATERIALS))
_QUALIFIER = r"printed|landscape|portrait|custom|small|medium|large|xlarge|rough|textured?|all over|allover|static|moving|black|white|gold|silver|copper|iridescent|holo spot|sugar|flat|pe rattan|3d"
_PREFIX = re.compile(r"(?:(?:" + _PHYSICAL + "|" + _QUALIFIER + r")(?:\s+|$))+")


# Broad nouns: a truthful type only when nothing more specific is stated.
BROAD_PRODUCT_PATTERNS = tuple((product, re.compile(pattern)) for product, pattern in (
    ("Wall Art", r"\bwall art\b"),
    ("Glass Art", r"\b(?:printed|stained) glass\b|\bglass art\b"),
    ("Wall Art", r"\bwall decor(?:ation)?\b"),
    ("Organizer", r"\borgani[sz]ers?\b"),
    ("Window Cling", r"\bwindow clings?\b"),
    ("Mat", r"\bmats?\b"),
    ("Calendar", r"\bcalendars?\b"),
    ("Tile", r"\btiles?\b"),
    ("Poster", r"\bposters?\b"),
    ("Painting", r"\bpaintings?\b"),
    ("Sign", r"\bsigns?\b"),
    ("Box", r"\bbox(?:es)?\b"),
    ("Frame", r"\bframes?\b"),
    ("Print", r"\bprints?\b"),
    ("Decorative Letter", r"\bletters?\b"),
    ("Block", r"\bblocks?\b"),
    ("Clock", r"\bclocks?\b"),
    ("Art", r"^art$")))


def _states_product(text, exclude=frozenset()):
    """True when text names a physical product, broad nouns included.

    Every caption guard uses this one predicate, so a caption after
    "wall art" or "sign" is removed exactly as one after "mug" is.
    "Printed glass" names a material before a later product noun, so the
    broad Glass Art reading never makes a prefix a finished product.
    """
    return (any(product not in exclude and pattern.search(text) for product, pattern in PRODUCT_PATTERNS)
            or any(product not in exclude and product not in {"Art", "Glass Art"} and pattern.search(text)
                   for product, pattern in BROAD_PRODUCT_PATTERNS))

def _product_text(value: str) -> str:
    """Normalize wording without treating named identities as product evidence."""
    return " ".join(normalize(value).split())


def _common_variant_treatments(text: str, noun: str) -> set[str] | None:
    """Keep only finishes stated for every explicitly repeated same product."""
    clauses = [part for part in re.split(r"\s*,\s*|\band\b", text)
               if re.search(r"\b" + noun + r"\b", part)]
    if len(clauses) < 2:
        return None
    groups = [{name for name, pattern in _TREATMENTS
               if re.search(r"\b(?:" + pattern + r")\b", part)} for part in clauses]
    return set.intersection(*groups)


def _mixed_distinct_forms(title: str) -> bool:
    """Abstain only for separately named products across title clauses.

    A finish, artwork print, or accessory on the same item is not a second
    product. Repeated Canvas/Shadowbox clauses are one form with variable
    finishes, whose common attributes are handled later.
    """
    forms: set[str] = set()
    named_clauses = 0
    title = re.sub(r"\bb\s*&\s*w\b", "black white", title, flags=re.I)
    # Hooks joined to elastics on one box are hardware on that box.  A bare
    # "box and hooks" still names potentially separate supplied products.
    title = re.sub(r"\bbox art with elastics and hooks\b",
                   lambda m: m.group().replace(" and ", " with "), title, flags=re.I)
    for raw_clause in re.split(r"\s*(?:,|\+|&|\band\b)\s*", title):
        clause = re.sub(r"\bwrtng\s+(?:dsk|desk)\b", "writing desk", normalize(DIMENSION.sub(" ", raw_clause)))
        form = ""
        if re.search(r"\b(?:toy chest|toy chests)\b", clause):
            form = "toy chest"
        elif re.search(r"\b(?:storage )?hampers?\b", clause):
            form = "hamper"
        elif re.search(r"\b(?:storage )?bins?\b", clause):
            form = "bin"
        elif re.search(r"\bcubes?\b", clause):
            form = "cube"
        elif re.search(r"\bblocks?\b", clause):
            form = "block"
        elif re.search(r"\b(?:mdf )?shapes?\b", clause) and not re.search(
                r"\bart\s+on(?:\s+\w+){0,3}\s+shapes?\b", clause):
            form = "shape"
        elif re.search(r"\bsuitcases?\b", clause):
            form = "suitcase"
        elif re.search(r"\bshadowbox(?:es)?\b", clause):
            form = "shadowbox"
        elif re.search(r"\b(?:paper|ppr|pper) prints?\b", clause) and not re.search(r"\bcanvas\b", clause):
            form = "paper print"
        elif re.search(r"\bprinted glass\b", clause) and not re.search(r"\bshadowbox\b", clause):
            form = "glass art"
        elif re.search(r"\bfoam art\b", clause):
            form = "foam art"
        elif re.search(r"\beasels?\b", clause):
            form = "easel"
        elif re.search(r"\bsigns?\b", clause):
            form = "sign"
        elif re.search(r"\bhooks?\b", clause):
            form = "hook"
        elif re.search(r"\bcanvas\b", clause):
            if re.search(r"\b(?:diy|cyo|pyo)\b|\b(?:paint|pnt) pots?\b|\bpaint tubes?\b|"
                         r"\bcanvas set (?:w|with) \d+ paint pts\b", clause):
                form = "paint-your-own canvas set"
            else:
                form = "framed canvas" if re.search(r"\b(?:(?:floating|float|floater) frame|ff)\b", clause) else "canvas"
        elif re.search(r"\b(?:fl|floating) comic\b", clause):
            form = "comic"
        elif re.fullmatch(r"(?:printed )?glass", clause):
            form = "glass art"
        elif re.search(r"\b(?:desk|desktop)(?: set)? (?:org|organizer)\b", clause):
            form = "desktop organizer"
        elif re.search(r"\blap desk\b", clause):
            form = "lap desk"
        elif re.search(r"\bwriting desk\b", clause):
            form = "writing desk"
        elif re.search(r"\bpencil cups?\b", clause):
            form = "pencil cup"
        elif re.search(r"\bphone stands?\b", clause):
            form = "phone stand"
        elif re.search(r"\btrays?\b", clause):
            form = "tray"
        elif re.search(r"\b(?:mdf )?plaques?\b", clause):
            form = "plaque"
        elif re.search(r"\blenticular\b", clause):
            form = "lenticular art"
        elif re.search(r"\bbox(?:es)?\b", clause):
            form = "box"
        elif re.search(r"\b(?:floating|floater) frame\b", clause):
            form = "frame"
        elif re.fullmatch(r"(?:small|large|medium)?\s*art", clause):
            form = "art"
        elif re.search(r"\bstorage\b", clause):
            form = "storage container"
        if form:
            named_clauses += 1
            forms.add(form)
    return named_clauses > 1 and len(forms) > 1


def read_product_type(description: object) -> dict[str, str]:
    result = {key: "" for key in ("product_type", "product_construction", "product_material",
                                  "product_treatment", "matched_wording")}
    result.update(product_type_status="unreadable", product_type_rules_version=RULES_VERSION)
    if description is None or isinstance(description, float) and math.isnan(description):
        description = ""
    parts = str(description).split("_")
    title = re.sub(r"(?i)\b(frame|frme)(?=\d+(?:\.\d+)?\s*x\s*\d+)", r"\1 ", parts[0])
    if len(parts) > 1 and re.fullmatch(r"\s*(?:2|two|double) layer boxed (?:mdf|wood)\s*", normalize(title)) \
            and re.search(r"\bwall art\b", normalize(parts[1])):
        title += " wall art"
    normalized_title = normalize(title) if len(parts) > 1 else ""
    if len(parts) > 1 and not any(pattern.search(normalized_title) for _, pattern in PRODUCT_PATTERNS):
        next_clause = normalize(DIMENSION.sub(" ", parts[1]))
        if re.fullmatch(r"(?:(?:printed|stretched|framed) )?canvas(?: set)?", next_clause):
            title = parts[1]
        elif re.fullmatch(r"framed 3d lenticular|printed glass shadowbox", next_clause):
            title = parts[1]
        elif re.fullmatch(r"wall shelf(?: (?:w|with) bow)?", next_clause):
            title = parts[1]
        elif re.fullmatch(r"(?:clay knot|three chain links)(?: tabletop decor)?", next_clause):
            title = parts[1]
        elif re.fullmatch(r"(?:[a-z]+ )?(?:(?:natural|pe) )?(?:rattan|seagrass|paper rope)", normalized_title) \
                and re.fullmatch(r"dimensional (?:bow|deer head)", next_clause):
            title += " " + parts[1]
    source_for_helpers = str(description)
    # A named object followed by "with ... artwork/graphic" is still that
    # object. The entire depicted clause, including product-like words before
    # the marker, is outside physical evidence for type and attributes.
    depicted_clause = re.search(
        r"\b(?:with|w|of|featuring|depicting)\s+(?:[a-z0-9-]+\s+){1,7}"
        r"(?:artwork|graphic|design|image|pattern|scene)\b", title, re.I)
    if depicted_clause:
        physical_bin = re.search(r"\bcanvas (?:w|with) eva bins?\b", title, re.I)
        if physical_bin:
            remainder = title[physical_bin.end():depicted_clause.end()]
            marker = re.search(r"\b(?:artwork|graphic|design|image|pattern|scene)\b", remainder, re.I)
            between = normalize(remainder[:marker.start()]).split() if marker else []
            if marker and not between:
                # A bin immediately followed by a visual-content noun leaves
                # its physical scope unresolved.
                return result
            if marker and marker.group().lower() == "pattern" and 1 <= len(between) <= 4:
                # The complete contiguous material-and-bin phrase precedes a
                # later pattern caption; keep only that physical phrase.
                title = title[:physical_bin.end()]
                source_for_helpers = title
                depicted_clause = None
    if depicted_clause:
        physical_prefix = _product_text(DIMENSION.sub(" ", title[:depicted_clause.start()]))
        depicted_words = _product_text(title[depicted_clause.start():depicted_clause.end()])
        depicts_another_product = any(
            product not in {"Art", "Art Print", "Canvas", "Print"} and pattern.search(depicted_words)
            for product, pattern in PRODUCT_PATTERNS)
        if depicts_another_product and (_states_product(physical_prefix)
                or re.search(r"\b(?:paper |mdf |glass )?prints?\b", physical_prefix)):
            title = title[:depicted_clause.start()].rstrip()
            source_for_helpers = title
    # "<product> with <words> artwork" describes what is pictured: those words
    # (wooden bowl, glitter bird) are never the product's material or finish.
    # Remove only that caption so a later physical clause ("and foil finish")
    # still reaches the product.
    with_caption = re.search(
        r"\s+(?:with|w)\s+(?:(?!(?:paper|holofoil|foil|mdf|canvas|vinyl|stickers?)\b)[^\s,_&+\d]+\s+){1,5}?artwork\b",
        title, re.I)
    if with_caption and _states_product(_product_text(DIMENSION.sub(" ", title[:with_caption.start()]))):
        caption = with_caption.group()
        title = (title[:with_caption.start()] + " " + title[with_caption.end():]).strip()
        source_for_helpers = source_for_helpers.replace(caption, " ", 1)
    artwork_marker = re.search(r"\b(?:artwork|illustration|graphic|image|scene|depicting)\b", title, re.I)
    if artwork_marker:
        abstract_heads = {"Lenticular Art", "Framed Lenticular Art", "Art", "Print", "Art Print"}
        artwork_start = artwork_marker.start()
        caption_medium = re.search(
            r"\b(?:canvas|mdf|wood|glass|paper|fabric|(?:molded\s+)?foam|foil|glitter|metallic|"
            r"suncatchers?|stickers?|mugs?|books?|pencil cases?)\s*$",
            title[:artwork_start], re.I)
        if caption_medium and _states_product(
                _product_text(DIMENSION.sub(" ", title[:caption_medium.start()])), abstract_heads):
            artwork_start = caption_medium.start()
        physical_prefix = _product_text(DIMENSION.sub(" ", title[:artwork_start]))
        if (_states_product(physical_prefix, abstract_heads)
                or re.search(r"\b(?:prints?|posters?)\b", physical_prefix)):
            title = title[:artwork_start]
    text = _product_text(DIMENSION.sub(" ", title))
    if re.search(r"\bcanvas(?: \w+){0,3} destination sign\b", text):
        # Juxtaposed canvas and sign nouns without a depiction or assembly
        # relation do not establish which physical form is supplied.
        return result
    # Keep size delimiters as evidence boundaries even though product matching
    # ignores their numeric values. Artwork after a size cannot supply material.
    boundaries = [len(_product_text(DIMENSION.sub(" ", parts[0][:m.start()]))) for m in DIMENSION.finditer(parts[0])]
    if re.search(r"\bcanvas (?:and |with )?(?:paper print|mdf plaque)\b|\bperpetual calendars? and (?:mdf )?blocks?\b", text):
        return result
    if re.search(r"\b(?:canvas|cnvs|cvs)\s*(?:&|\+|and)\s*(?:paper\s+)?(?:print|prnt)\b", parts[0], re.I):
        return result
    if re.search(r"\bplaques?\s*(?:and|plus|\+|&)\s*(?:wall\s+)?clocks?\b", parts[0], re.I):
        return result
    # A substrate followed by "growth" is not a chart unless the physical
    # chart noun is actually stated.  Named chart peers cannot supply it.
    if re.search(r"\bcanvas\s+growth\b(?!\s+charts?\b)", text):
        return result
    # Shelf and storage cube name separate forms even when catalog shorthand
    # joins them without a conjunction.  Hooks can be hardware on either.
    if re.search(r"\bshelf\b(?:\s+\w+){0,2}\s+storage\s+cubes?\b", text):
        return result
    if re.search(r"\blenticular\s+and\s+mdf\b", text):
        return result
    # Distant, unjoined finish claims before a lone canvas noun may describe
    # separate products; the source does not bind them to one canvas.
    if re.search(r"\b(?:foil|gel)\b(?:\s+(?!(?:metallic|varnish|with|and|on|in)\b)\w+){2,8}"
                 r"\s+(?:metallic|varnish)\b.{0,35}\bcanvas\b", text):
        return result
    if re.search(r"\bshadow bow\b", text):
        return result
    if re.search(r"\b(?:mdf\s+)?box\s*(?:&|\+|and)\s*(?:perpetual\s+)?calendar\b|\bkneeler\s*(?:&|\+|and)\s*gloves?\b", parts[0], re.I):
        return result
    if re.search(r"\b(?:desk|desktop)(?:\s+set)?\s+(?:org|organizer)\b.{0,35}(?:\+|\band\b)\s*pencil\s+cup\b", parts[0], re.I):
        return result
    if re.search(r"\b(?:framed|frmd)\s+mdf\s+(?:print|prnt)\s*,\s*(?:cnvs|canvas)\b", parts[0], re.I):
        return result
    if re.search(r"\bframed\b.*\bnon framed\b|\bcanvas storage\b(?!\s+(?:bin|basket|cube|box|chest)\b)", text):
        return result
    integrated_glass_shadowbox = bool(re.search(r"\bprinted glass\b.*\bshadowbox frame\b", text)
        and not re.search(r"\bprinted glass\s+(?:and|plus)\s+shadowbox\b", text)
        and not re.search(r"printed glass\s*[,\+&]\s*shadowbox", parts[0], re.I))
    chest_block_pattern = bool(re.search(r"\bstorage chests?\b", text)
                               and re.search(r"\bblocks? patterns?\b", text))
    mixed_title = re.sub(r"\bblocks? patterns?\b", "artwork", parts[0], flags=re.I) if chest_block_pattern else parts[0]
    # Color blocks described as part of one canvas are visual content, not
    # a second supplied block product.
    if re.search(r"\bcanvas\b", text):
        mixed_title = re.sub(r"\bwith\s+color\s+blocks?\b", "with artwork", mixed_title, flags=re.I)
    if _mixed_distinct_forms(mixed_title) and not integrated_glass_shadowbox:
        return result
    if re.search(r"\b(?:toy\s+chest|toy\s+chst)\b.{0,55}(?:,|\+|&)\s*(?:\w+\s+){0,3}(?:hamper|hmpr|bin)\b", parts[0], re.I):
        return result
    if not text or (text not in {"2d", "3d", "4d"} and re.fullmatch(
            r"pending|assortment|assorted|asst|desc|samples?|test(?:ing)?|[a-z]*\d+[a-z0-9]*", text)) \
            or re.fullmatch(r"autocomplete|duty|handling|invoicing purpose|lacey and isf|master|placeholder|tbd|ticketing|test[a-z]*(?: dsn)?", text) \
            or re.search(r"\b(?:fees?|refund|handling charge|rework charge|test item|created for testing|billing purpose|additional cost and labor|"
                         r"ad requirement|extra cost|additional cost|plate cost|port chg|repackaging cost|created new record)\b", text):
        result["product_type_status"] = "placeholder"
        return result
    matches = [(m.start(), -(m.end()-m.start()), order, product, m)
               for order, (product, pattern) in enumerate(PRODUCT_PATTERNS)
               for m in [pattern.search(text)] if m]
    # Dimensions divide the physical title from later identity/artwork. A
    # phrase assembled by deleting a dimension is not source-stated wording.
    matches = [entry for entry in matches if not any(
        entry[0] < boundary < entry[4].end() for boundary in boundaries
    )]
    # Lift-off describes a closure, and storage describes a use. Neither
    # establishes that the object is a box without a separate box noun.
    matches = [entry for entry in matches if not (
        entry[3] == "Hard Storage Box"
        and re.fullmatch(r"lift off (?:lid )?storage", entry[4].group())
    )]
    matches = [entry for entry in matches if not (
        entry[3] == "Storage Tower" and entry[4].group() == "drawer tier storage"
    )]
    matches = [entry for entry in matches if not (
        entry[3] == "Display Rack" and entry[4].group() == "spinner"
    )]
    if boundaries:
        before_size = [entry for entry in matches if entry[0] < boundaries[0]]
        if before_size:
            # A named object before dimensions is the product. Later nouns
            # belong to artwork/identity unless no earlier object was named.
            matches = before_size
    if re.search(r"\bcanvas with (?:glitter )?(?:mdf|wood) letters\b", text):
        matches = [entry for entry in matches if entry[3] != "Decorative Letter"]
    if any(entry[3] == "Hanging Shoe Organizer" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Storage Organizer"]
    if any(entry[3] == "Storage Caddy" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Storage Container"]
    if chest_block_pattern and any(entry[3] == "Storage Chest" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Block"]
    if any(entry[3] == "Canvas" for entry in matches) and re.search(
            r"\bsuncatcher (?:artwork|design|graphic|illustration|image)\b", text):
        matches = [entry for entry in matches if entry[3] != "Suncatcher"]
    if any(entry[3] == "Canvas" for entry in matches) and re.search(
            r"\bart\s+on(?:\s+\w+){0,3}\s+shapes?\b", text):
        matches = [entry for entry in matches if entry[3] != "Shape"]
    if any(entry[3] == "Canvas" for entry in matches) and re.search(
            r"\bshooting (?:\w+ )?hooks?\b", text):
        # Hook is the object of a depicted action, not mounting hardware.
        matches = [entry for entry in matches if entry[3] not in {"Hook", "Wall Hook"}]
    if any(entry[3] == "Canvas" for entry in matches) and re.search(
            r"\bcanvas (?:w|with) hooks?\b", text):
        # Attached hanging hardware does not replace the canvas head noun.
        matches = [entry for entry in matches if entry[3] not in {"Hook", "Wall Hook"}]
    if any(entry[3] == "Canvas" for entry in matches) and re.search(
            r"\bcanvas in (?:a )?tray box\b", text):
        matches = [entry for entry in matches if entry[3] not in {"Tray or Dish", "Tray", "Box"}]
    if any(entry[3] in {"Canvas", "Framed Canvas"} for entry in matches) and re.search(
            r"\bchalkboard (?:artwork|art|design|graphic|image|pattern)\b", normalize(parts[0])):
        matches = [entry for entry in matches if entry[3] != "Chalkboard"]
    if any(entry[3] == "Trinket Tray" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Tray or Dish"]
    if any(entry[3] == "Desktop Organizer" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Stationery Organizer"]
    if any(entry[3] == "Alarm Clock" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Desktop Clock"]
    if any(entry[3] == "Letterboard" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Functional Board"]
    if any(entry[3] == "Door Sign" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Door Hanger"]
    if any(entry[3] in {"Plaque", "Door Hanger", "MDF Box"} for entry in matches):
        # Lenticular names the image effect; an explicit object noun names the
        # product when both occur in the same (non-mixed) physical clause.
        matches = [entry for entry in matches if not entry[3].endswith("Lenticular Art")]
    if any(entry[3] == "Shadowbox Bank" for entry in matches):
        # The bank is the named object; molded/glass describe its shell.
        matches = [entry for entry in matches if entry[3] not in {
            "Shadowbox", "Framed Shadowbox", "Framed Glass Shadowbox", "Glass Art", "Framed Glass Art"
        }]
    if any(entry[3] == "Wall Clock" for entry in matches):
        matches = [entry for entry in matches if entry[3] not in {"Plaque", "Wall Plaque"}]
    if any(entry[3] == "Block" for entry in matches):
        # A print stated on a block is an attribute of that block.
        matches = [entry for entry in matches if entry[3] != "Print"]
    if re.search(r"\bcanvas art print\b", text):
        matches = [entry for entry in matches if entry[3] != "Art Print"]
    if any(entry[3] == "Tapestry" for entry in matches):
        matches = [entry for entry in matches if entry[3] != "Hanging Wall Art"]
    canvas_matches = [entry for entry in matches if entry[3] == "Canvas"]
    if canvas_matches:
        canvas_start = min(entry[0] for entry in canvas_matches)
        canvas_end = min(entry[4].end() for entry in canvas_matches if entry[0] == canvas_start)
        artwork_stickers = set()
        for entry in matches:
            if entry[3] != "Sticker" or entry[0] <= canvas_end:
                continue
            between = text[canvas_end:entry[0]]
            after = text[entry[4].end():]
            if (re.search(r"\b(?:art|background|collage)\b", after[:35])
                    or re.search(r"\b(?:w|with)\s+(?:glitter|foil|gel|led|metallic|embellished)\b", between)
                    or (len(between.split()) >= 3 and re.search(r"\bwith\s*$", between))):
                artwork_stickers.add(entry)
        matches = [entry for entry in matches if entry not in artwork_stickers]
        for _, _, _, _, canvas in canvas_matches:
            canvas_is_kit = any(entry[3] == "Paint-Your-Own Canvas Set"
                                and entry[0] <= canvas.start() and entry[4].end() >= canvas.end()
                                for entry in matches)
            for _, _, _, other, found in matches:
                if other == "Canvas" or found.start() < canvas.end():
                    continue
                if canvas_is_kit and other == "Paint-Your-Own Canvas Set":
                    continue
                between = text[canvas.end():found.start()]
                if re.search(r"\b(?:and|plus)\b", between) or re.search(r"\b(?:assorted|assortment|mixed)\b", text):
                    return result
        matches = [entry for entry in matches if not (entry[3] in {"Book", "Mug"} and entry[0] > canvas_start)]
    if any(product != "Canvas" for _, _, _, product, _ in matches):
        if any(entry[3] == "Canvas" for entry in matches) and re.search(r"\bmirror effect\b", text):
            # A reflected appearance printed on a canvas is not a mirror.
            matches = [entry for entry in matches if entry[3] != "Mirror"]
    if any(product != "Canvas" for _, _, _, product, _ in matches):
        matches = [entry for entry in matches if entry[3] != "Canvas"]
    # A broad noun is still a truthful physical type when that is all the
    # source states. It never competes with an earlier, more specific product.
    if not matches:
        for product, broad_pattern in BROAD_PRODUCT_PATTERNS:
            broad = broad_pattern.search(text)
            if broad:
                matches = [(broad.start(), -(broad.end()-broad.start()), len(PRODUCT_PATTERNS), product, broad)]
                break
    if not matches:
        if re.search(r"\b(?:assorted|asst) molded foam\b", text):
            return result
        if re.search(r"\b(?:framed|tabletop|portraits?|coir|pvc|glass|greyboard|mdf|paper|fabric|molded)\b", text):
            return result
        if re.search(r"\b(?:testing|test|administrative|charge|charges|discount|pending)\b", text):
            result["product_type_status"] = "placeholder"
        return result
    # Explicit correction phrases outrank overlapping older rules; separate
    # product nouns in the same description require review, not longest-match guessing.
    matches.sort()
    _, _, selected_order, product, match = matches[0]
    if product == "Art" and re.search(r"\b(?:comic cover|vector|line|splatter) art\b", text):
        return result
    if re.search(r"\bframed\b.{0,25}\bmdf\b.{0,80}\bposter\b", text) \
            and not re.search(r"\b(?:art|print)\b", text):
        return result
    if product == "Framed Art" and match.group() in {"framed mdf", "frm mdf", "framed paper"} \
            and not re.search(r"\b(?:art|print|plaque|canvas|collage|shadowbox)\b", text):
        return result
    for _, _, order, other, found in matches:
        if found.start() < match.end() and match.start() < found.end():
            if product == "Photo Frame" and other in {"Wall Art", "Framed Art"} and re.search(
                    r"\bwall photo frames? wall art\b", text):
                # A trailing wall-art descriptor does not erase the stated
                # frame object or make framing an added construction.
                continue
            if product == "Framed Print" and other == "Glass Shadowbox" and re.search(
                    r"\bframed prints? glass shadow ?box\b", text):
                # A contiguous frame/print/shadowbox assembly has one print
                # head; the shadowbox wording specifies its enclosure.
                continue
            if order < len(_FIXES) and ((found.end()-found.start()) > (match.end()-match.start()) or
                    ((found.end()-found.start()) == (match.end()-match.start()) and order < selected_order)):
                product, match, selected_order = other, found, order
        elif other != product:
            between = text[match.end():found.start()]
            joined_product = re.fullmatch(
                r"\s*(?:and|plus|with)\s+(?:(?:mdf|paper|glass|wood|plastic|ceramic|fabric|metal|greyboard)\s+)?",
                between)
            integrated_hamper = (product == "Hanging Closet Organizer" and other == "Storage Hamper"
                                 and re.fullmatch(r"\s+with\s+", between)
                                 and re.fullmatch(r"hamper", found.group()))
            attached_hooks = (other in {"Wall Hook", "Hook"}
                              and re.fullmatch(r"\s+(?:w|with)\s+", between)
                              and re.fullmatch(r"hooks?", found.group()))
            if joined_product and not attached_hooks and not (product == "Plaque" and other in {"Wall Hook", "Hook"}) \
                    and not integrated_hamper:
                return result
    mixed_shadowbox = bool(re.search(r"\bglass shadowbox\b.{0,30}\bmolded shadowbox\b|"
                                    r"\bmolded shadowbox\b.{0,30}\bglass shadowbox\b", text))
    prior_glass_shadowbox = product == "Framed Shadowbox" and bool(
        re.search(r"\b(?:printed|print|stained) glass\b", text[:match.start()]))
    if mixed_shadowbox and product in {"Framed Glass Shadowbox", "Framed Shadowbox"}:
        product = "Framed Shadowbox"
    elif prior_glass_shadowbox:
        product = "Framed Glass Shadowbox"
    elif product == "Framed Glass Art" and re.search(
            r"\bshadowbox(?:es)?\b", text[:boundaries[0]] if boundaries else text):
        # Shadowbox is the named physical object; glass is one of its parts.
        product = "Framed Glass Shadowbox"
    if product == "Framed Shadowbox" and re.search(r"\bshawowbox\b", parts[0], re.I) \
            and not re.search(r"\b(?:framed|frame)\b", text):
        product = "Shadowbox"
    if product in {"Box", "MDF Box"} and any(
            re.search(r"\b(?:w|with) functional chalkboard\b", normalize(part))
            for part in parts[:2]):
        # An explicitly usable chalkboard on the named box is a physical
        # function; chalkboard artwork alone is not.
        product = "Chalkboard Box"
    # Only a short contiguous modifier prefix belongs to the product, never
    # artwork text after its noun. Unknown words terminate that prefix.
    prefix = text[:match.start()].rstrip()
    prefix_words = prefix.split()
    evidence = match.group()
    if product == "Frame" and prefix_words and prefix_words[-1] in {"floating", "floater", "float"}:
        evidence = prefix_words[-1] + " " + evidence
    for offset in range(len(prefix_words)):
        candidate = " ".join(prefix_words[offset:]) + " "
        if _PREFIX.fullmatch(candidate) and not (offset and prefix_words[offset - 1] in {"faux", "fake", "imitation"}):
            evidence = candidate + evidence
            break
    if prior_glass_shadowbox and not mixed_shadowbox:
        evidence = "glass " + evidence
    if product == "Framed Glass Shadowbox" and re.match(r"^printed glass\b", text) \
            and "glass" not in evidence:
        evidence = "glass " + evidence
    if product == "Glass Art" and re.match(r"^printed glass\b", text) and any(
            re.fullmatch(r"shadowbox(?: (?!artwork|graphic|design|image|pattern|scene)\w+){0,3} frame",
                         normalize(part)) for part in parts[1:]):
        # A later whole physical specification can name the enclosure even
        # when intervening underscore segments contain only artwork identity.
        product = "Framed Glass Shadowbox"
        evidence += " shadowbox frame"
    # Physical materials must bind to the noun through the recognized prefix.
    # A leading material-like word separated by artwork (Wood Duck, Metal Gear,
    # Glass Slipper) cannot be taken as a substrate claim.
    # Technical substrate names are unambiguous even when artwork intervenes;
    # a size still terminates their physical title clause.
    leading_substrate = re.match(r"^(?:mdf|greyboard|pvc|tpe|polypropylene)\b", text)
    if leading_substrate and not any(point < match.start() for point in boundaries) \
            and leading_substrate.group() not in evidence:
        evidence = leading_substrate.group() + " " + evidence
    # Consume only explicit adjacent treatment clauses. Never scan an artwork
    # suffix for words that happen to resemble a material or embellishment.
    suffix = text[match.end():]
    following_boundaries = [point for point in boundaries if point >= match.end()]
    if following_boundaries:
        suffix = text[match.end():min(following_boundaries)]
    negative = re.match(r"^\s+without (?:raised )?(?:embossed|debossed|glitter|foil)(?:\s+(crumb rubber|rubber))?\b", suffix)
    if negative:
        evidence += " " + (negative.group(1) or "")
        suffix = suffix[negative.end():]
    suffix_pattern = re.compile(r"^\s+(?:(?:w|with|and|under|in|on)\s+)?(?:(?:" + _QUALIFIER + r"|\d+)\s+)*(?:"
        + _PHYSICAL + r")(?: sides| legs| frame)?\b")
    while suffix_match := suffix_pattern.match(suffix):
        if re.match(r"\s+artwork\b", suffix[suffix_match.end():]):
            break
        evidence += suffix_match.group()
        suffix = suffix[suffix_match.end():]
    if "Lenticular Art" in product:
        lenticular_suffix = text[match.end():]
        frame_metadata = re.match(
            r"\s*(?:(?:landscape|portrait)\s+)?(?:in|with)\s+(?:\d+\s+)?"
            r"(?:(?:mdf|greyboard|plastic|wood|metal) )?frame(?: width)?\b"
            r"|\s*(?:\d+\s+(?:inch(?:es?)?\s+)?)?frame\b|\s+framed\b",
            lenticular_suffix)
        if frame_metadata is None:
            frame_metadata = re.search(r"\b(?:\d+\s+)?frame width\b", lenticular_suffix)
        if frame_metadata is None and re.search(r"\bframe\s*$", prefix):
            frame_metadata = re.search(r"\bframe\b", prefix)
        if frame_metadata and not re.search(r"\b(?:no frame|noframe|unframed)\b", text):
            product = "Framed Lenticular Art"
            evidence += " " + frame_metadata.group()
    if "Lenticular" in product or "Canvas" in product:
        for point in following_boundaries:
            frame_clause = re.match(
                r"\s*(?:(?:in|with) (?:(?:mdf|greyboard|plastic|wood|metal) )?frame(?: width)?"
                r"|(?:\d+(?: \d+)? )?(?:(?:mdf|greyboard|plastic|wood|metal) )?frame width)\b",
                text[point:])
            if frame_clause:
                evidence += " " + frame_clause.group().strip()
                if not product.startswith("Framed "):
                    product = "Framed " + product
    # Underscore usually begins artwork, but a whole clause explicitly naming
    # the frame is independently physical evidence; Wood Duck is not.
    for part in parts[1:]:
        clause = normalize(DIMENSION.sub(" ", part))
        if re.fullmatch(r"(?:(?:oak|light|dark|natural|black|white) )?(?:wood|mdf|metal|plastic) frame", clause):
            evidence += " " + clause
        elif clause and _PREFIX.fullmatch(clause + " "):
            # Underscore-separated artwork is ignored. A whole independent
            # physical-modifier clause can still state a material or finish.
            evidence += " " + clause
    # Faux/texture/appearance are not claims of the underlying material.
    material_evidence = re.sub(r"\b(?:faux|imitation|fake)\s+(?!leather\b|fur\b)\w+\b|\b\w+\s+(?:texture|look|effect)\b", "", evidence)
    material_evidence = re.sub(r"\bwool fabric\b", "wool", material_evidence)
    material_evidence = re.sub(r"\blinen paper\b", "paper", material_evidence)
    material_evidence = re.sub(r"\bjute rope\b", "jute", material_evidence)
    if re.search(r"\b(?:faux|imitation|fake)\s*$", text[:match.start()]) and material_evidence == evidence:
        material_evidence = ""
    materials = [name for name, pattern in _MATERIALS if re.search(r"\b(?:" + pattern + r")\b", material_evidence)]
    if re.search(r"\bpe rattan\b", material_evidence):
        materials = [name for name in materials if name != "PE"]
    if mixed_shadowbox:
        materials = []
    repeated_noun = "canvas" if product in {"Canvas", "Framed Canvas"} else "glass" if product == "Glass Art" else ""
    common_treatments = _common_variant_treatments(text, repeated_noun) if repeated_noun else None
    # A depicted-content clause ("with layered flowers graphic") names what is
    # pictured, never how the product is built, so it cannot add a construction.
    physical_evidence = _VISUAL_CONTENT.sub(" ", evidence)
    constructions = [name for name, pattern in _CONSTRUCTIONS if re.search(r"\b(?:"+pattern+r")\b", physical_evidence)]
    if product == "Decorative Bow" and re.search(r"\bdimensional bow\b", evidence):
        constructions.append("Dimensional")
    if product == "Framed Art" and re.search(r"\bframed 3 d wall art\b", evidence):
        constructions.append("3D")
    if product == "Trinket Tray" and re.search(r"\bdiy crmic trinket tray\b", text):
        constructions.append("DIY")
    if product == "Organizer" and re.search(r"\bfaux book organi[sz]er\b", evidence):
        constructions.append("Faux Book")
    if mixed_shadowbox:
        constructions = [name for name in constructions if name != "Molded"]
    # These are explicit assembly words in the title; short intervening
    # artwork names and dimensions must not erase them from the product.
    if re.search(r"\bframed\b", evidence) and "Framed" not in constructions:
        constructions.append("Framed")
    if product == "Wall Art" and re.search(r"\bframe wall art\b", evidence):
        constructions.append("Framed")
    if re.search(r"\b(?:floating|floater|float) frame\b", evidence) and "Floating Frame" not in constructions:
        constructions.append("Floating Frame")
    if re.search(r"\bdie cut\b", evidence) and not re.search(r"\bdie cut (?:icon|attachment)\b", evidence):
        if "Die-Cut" not in constructions and "Die-Cut Attachment" not in constructions:
            constructions.append("Die-Cut")
    # The product noun already includes a coordinated kit, and identical
    # canvases/hamper multipacks gain no additional construction from quantity.
    if product.endswith(" Set") or product in {"Canvas", "Framed Canvas", "Storage Hamper"}:
        constructions = [name for name in constructions if name != "Set"]
    if product == "Faux Book":
        constructions = [name for name in constructions if name != "Faux Book"]
    if product in {"Mat", "Door Mat", "Outdoor Mat", "Floor Mat"} and re.search(r"\bhalf circle\b", text):
        constructions.append("Half-Circle")
    if "Die-Cut Attachment" in constructions:
        constructions = [name for name in constructions if name != "Die-Cut"]
    if product == "Message Board" and re.search(r"\bshadowbox\b", evidence):
        constructions.append("Shadowbox")
    # Lenticular describes an image technique, not a three-dimensional
    # construction. Reserve the explicit 3D modifier for physical relief art.
    if product in {"Relief Art", "Framed Relief Art"} and re.search(r"\b3d\b", evidence):
        constructions.append("3D")
    if product.startswith("Framed ") and re.search(r"\bframe\b", evidence) and not any("Frame" in c for c in constructions):
        constructions.append("Framed")
    if product.startswith("Framed ") and not re.search(r"\b(?:frame|framed|shadowbox(?:es)?)\b", evidence):
        product = product.removeprefix("Framed ")
    # Legacy MG families add placement qualifiers that are not always stated.
    if product.startswith("Wall ") and not re.search(r"\bwall\b", evidence):
        product = product.removeprefix("Wall ")
    if product == "Tall Sign" and "tall" not in evidence:
        product = "Sign"
        if "leaner" in evidence:
            constructions.append("Leaner")
    if product == "Tall Wall Sign" and "wall" not in evidence:
        product = "Tall Sign" if "tall" in evidence else "Sign"
    if product == "Tabletop Box" and "tabletop" not in evidence:
        product = "MDF Box" if re.search(r"\bmdf box\b", evidence) else "Box"
    if product == "Tabletop Block" and not re.search(r"\btable ?top\b", text):
        product = "Block"
    if product == "Box" and re.search(r"^mdf(?: \w+){0,4} box\b", text):
        product = "MDF Box"
    product = refine_storage_type(text, product)
    # The bounded source parser also recognizes when a finish belongs only to
    # artwork or to one variant, so its abstention must override legacy terms.
    treatments = sorted(set(extract_treatments(
        source_for_helpers, normalized_title=text, product_span=match.span(), physical_evidence=evidence)))
    if product == "Embroidery Kit":
        treatments = [name for name in treatments if name != "Embroidery"]
    if common_treatments is not None:
        treatments = [name for name in treatments if name in common_treatments]
    result.update(product_type=product,
                  product_construction=refine_construction(source_for_helpers, product, "; ".join(sorted(set(constructions)))),
                  product_material="" if mixed_shadowbox else extract_materials(text=text, evidence=material_evidence,
                      product_start=match.start(), product_end=match.end(),
                      size_boundaries=boundaries, product_type=product,
                      base_materials="; ".join(sorted(set(materials))), description=source_for_helpers),
                  product_treatment="; ".join(sorted(set(treatments))),
                  product_type_status="accepted", matched_wording=evidence)
    return result
