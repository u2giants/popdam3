import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from tools.product_type_reader import read_product_type
from tools.product_type_reader.reader import normalize

@pytest.mark.parametrize("description,product,material", [
    ("Studio Alpha Acrylic Pencil Case", "Pencil Case", "Acrylic"),
    ("Studio Alpha MDF die-cut block", "Block", "MDF"),
    ("Fictional Hero MDF floating character box", "Floating Character Box", "MDF"),
    ('MDF Print Framed 16"x20"', "Framed Print", "MDF"),
    ("Studio Alpha dome block tabletop décor", "Tabletop Block", ""),
    ("Cartoon Family XLarge Box Lift-Off Greyboard Storage", "Hard Storage Box", "Greyboard"),
    ("Fictional Hero DoubleLayer Diecut Art Figure", "Die-Cut Art", ""),
    ("Memory Foam Floor Mat", "Floor Mat", "Memory Foam"),
    ("canvas growth chart", "Growth Chart", "Canvas"),
    ("3pcs folding canvas-texture frame set with 3 markers", "Folding Frame Set", ""),
    ("Studio Alpha Desk Mat", "Desk Mat", ""),
])
def test_reported_failure(description, product, material):
    result = read_product_type(description)
    assert result["product_type_status"] == "accepted"
    assert result["product_type"] == product
    assert result["product_material"] == material

@pytest.mark.parametrize("description", ["", None, "Pending internal catalog review", "Test item for sample", "Handling fee adjustment", "ZXQ999"])
def test_placeholders(description):
    assert read_product_type(description)["product_type_status"] == "placeholder"

@pytest.mark.parametrize("prefix", ["Studio Alpha red", "Fictional Hero blue", "Brand Beta green", ""])
def test_brand_size_color_do_not_change_product(prefix):
    for size in ['16x20', '20x16']:
        result = read_product_type(prefix + ' Acrylic Pencil Case ' + size)
        assert result["product_type"] == "Pencil Case"
        assert result["product_material"] == "Acrylic"

@pytest.mark.parametrize("description", ["mystery object", "Pencil Case and Wall Clock"])
def test_ambiguous_is_unreadable(description):
    assert read_product_type(description)["product_type_status"] == "unreadable"

@pytest.mark.parametrize("description", ["Mug", "Desk Mat", "Framed Print", "Wall Clock"])
def test_no_invented_material(description):
    assert read_product_type(description)["product_material"] == ""

@pytest.mark.parametrize("suffix", [" canvas artwork", " gold foil artwork", "_ canvas mug"])
def test_artwork_does_not_supply_material_or_treatment(suffix):
    result = read_product_type("Acrylic Pencil Case" + suffix)
    assert result["product_type"] == "Pencil Case"
    assert result["product_material"] == "Acrylic"
    assert result["product_treatment"] == ""

def test_normalization_does_not_replace_inside_words():
    assert normalize("abcvsdef cnvs") == "abcvsdef canvas"

def test_no_inferred_frame_or_wall_placement():
    assert read_product_type("3D Lenticular Art")["product_type"] == "Lenticular Art"
    assert read_product_type("Tin Sign")["product_type"] == "Sign"

def test_nan_is_blank():
    assert read_product_type(float("nan"))["product_type_status"] == "placeholder"

def test_canvas_product_does_not_infer_stretched():
    result = read_product_type("Studio Alpha Canvas 16x20")
    assert result["product_type"] == "Canvas"
    assert result["product_construction"] == ""

@pytest.mark.parametrize("description", ["canvas w foil", "framed MDF print with foil"])
def test_contiguous_suffix_treatment(description):
    assert read_product_type(description)["product_treatment"] == "Foil"

def test_mdf_box_does_not_infer_placement():
    assert read_product_type("Studio Alpha MDF Box 16x20")["product_type"] == "MDF Box"

@pytest.mark.parametrize("description,product", [("MDF box shelf", "Box Shelf"), ("printed glass coaster", "Coaster")])
def test_more_specific_physical_noun(description, product):
    assert read_product_type(description)["product_type"] == product

def test_faux_material_is_not_actual_material():
    assert read_product_type("faux wood tray")["product_material"] == ""

@pytest.mark.parametrize("description", ["MDF box frame", "MDF box with glitter frame"])
def test_box_frame_is_not_tabletop_box(description):
    assert read_product_type(description)["product_type"] == "Box Frame"

def test_multiple_explicit_suffix_treatments():
    assert read_product_type("MDF box w/ glitter sides and foil")["product_treatment"] == "Foil; Glitter"

def test_suffix_material():
    assert read_product_type("Lap Desk MDF")["product_material"] == "MDF"
    assert read_product_type("framed MDF print under glass")["product_material"] == "Glass; MDF"

def test_no_frame_is_not_framed():
    assert read_product_type("3D lenticular portrait No Frame")["product_type"] == "Lenticular Art"
    assert read_product_type("3D wall art No Frame")["product_type"] == "Relief Art"

def test_growth_chart_plural():
    assert read_product_type("printed canvas growth charts")["product_type"] == "Growth Chart"

def test_folding_single_frame():
    result = read_product_type("folding canvas texture frame")
    assert result["product_type"] == "Folding Frame"
    assert result["product_material"] == ""

def test_reviewed_acrylic_typo():
    assert read_product_type("Acylic Pencil Case")["product_material"] == "Acrylic"

def test_growth_chart_suffix_material():
    assert read_product_type("growth chart canvas")["product_material"] == "Canvas"

def test_polypropylene_specificity():
    result = read_product_type("PP molded wall clock")
    assert result["product_material"] == "Polypropylene"
    assert result["product_construction"] == "Molded"

def test_negated_embossing_retains_material():
    result = read_product_type("Poly doormat without Raised Embossed (Crumb Rubber)")
    assert result["product_material"] == "Crumb Rubber"
    assert result["product_treatment"] == ""

def test_folding_legs_is_stated_construction():
    assert read_product_type('Lap Desk MDF w/ 10" folding legs')["product_construction"] == "Folding"

@pytest.mark.parametrize("description, product", [("canvases", "Canvas"), ("shadowboxes", "Framed Shadowbox"),
    ("phone stands", "Phone Stand"), ("Framed MDF", ""),
    ("floating frame embossed paper print", "Framed Print"), ("block MDF perpetual calendar", "Perpetual Calendar"),
    ("domed block tabletop decor", "Tabletop Block"), ("MDF writing desk w legs", "Writing Desk"),
    ("porch leaner hanging sign", "Sign"), ("MDF box art boss mug", "MDF Box")])
def test_catalog_compound_products(description, product):
    assert read_product_type(description)["product_type"] == product

def test_molded_foam_without_object_stays_unreadable():
    assert read_product_type("molded foam")["product_type_status"] == "unreadable"

@pytest.mark.parametrize("treatment", ["Crystal Gravel", "Diamond Dust", "Puff Paint", "Glue Embellishment",
    "Glow in Dark", "Chenille Patch", "Flocking", "Gold Leaf", "Silver Leaf", "Faux Leather Patch", "Spot Varnish", "Rhinestone"])
def test_explicit_canvas_treatments(treatment):
    expected = "Glow in the Dark" if treatment == "Glow in Dark" else treatment
    assert expected in read_product_type("Canvas with " + treatment)["product_treatment"].split("; ")

def test_physical_frame_clause_after_underscore():
    result = read_product_type("framed canvas_Oak Wood Frame_Wood Duck")
    assert result["product_material"] == "Canvas; Wood"
    assert read_product_type("canvas_Wood Duck")["product_material"] == "Canvas"

@pytest.mark.parametrize("description", ["Floater Frame Canvas", "canvas with floating frame"])
def test_floating_frame_canvas(description):
    result = read_product_type(description)
    assert result["product_type"] == "Framed Canvas"
    assert result["product_construction"] == "Floating Frame"

@pytest.mark.parametrize("modifier,treatment", [("Handpaint", "Handpaint"), ("Static LED", "LED"),
    ("black glitter", "Glitter"), ("dripping gel paint", "Gel Coat"), ("allover gel", "Gel Coat")])
def test_canvas_modifier_variants(modifier, treatment):
    assert read_product_type("canvas with " + modifier)["product_treatment"] == treatment

def test_diy_canvas():
    assert read_product_type("DIY canvas")["product_type"] == "Paint-Your-Own Canvas Set"

def test_plural_lap_desks():
    assert read_product_type("lap desks")["product_type"] == "Lap Desk"

@pytest.mark.parametrize("description", ["administrative sample", "pending approval"])
def test_administrative_without_product(description):
    assert read_product_type(description)["product_type_status"] == "placeholder"


def test_assortment_or_contractual_alone_does_not_establish_admin_placeholder():
    assert read_product_type('assorted contractual material')['product_type_status'] == 'unreadable'

def test_assorted_product_remains_product():
    assert read_product_type("assorted acrylic pencil case")["product_type"] == "Pencil Case"

@pytest.mark.parametrize("description, product, material", [("coir mat", "Mat", "Coir"),
    ("shaped velvet mat", "Mat", "Velvet"), ("crumb rubber outdoor mat", "Outdoor Mat", "Crumb Rubber"),
    ("poly doormat", "Door Mat", ""), ("Memory Foam floor mat", "Floor Mat", "Memory Foam")])
def test_mat_location_is_only_stated(description, product, material):
    result = read_product_type(description)
    assert result["product_type"] == product
    assert result["product_material"] == material

@pytest.mark.parametrize("description, construction", [("flat top storage chest", "Flat-Top"),
    ("tapered storage bin", "Tapered"), ("half moon fabric hamper", "Half-Moon"),
    ("rectangular fabric hamper", "Rectangular"), ("collapsible toy chest", "Collapsible")])
def test_storage_construction_stated(description, construction):
    assert read_product_type(description)["product_construction"] == construction

@pytest.mark.parametrize("description, treatment", [("canvas with sequins", "Sequins"),
    ("canvas with foil and pearls", "Foil; Pearls"), ("canvas with varnish", "Varnish"),
    ("canvas with bows and glitter", "Attachment; Glitter")])
def test_precise_treatment(description, treatment):
    assert read_product_type(description)["product_treatment"] == treatment

def test_property_book_is_not_product():
    assert read_product_type("Fable Book MDF Box")["product_type"] == "MDF Box"
    assert read_product_type("canvas Fable Book")["product_type"] == "Canvas"

def test_calendar_component_does_not_become_block():
    assert read_product_type("MDF block perpetual calendar")["product_type"] == "Perpetual Calendar"

@pytest.mark.parametrize("description", ["book", "books", "colouring book", "reading book", "pop-up book"])
def test_book_capability_preserved(description):
    assert read_product_type(description)["product_type"] == "Book"

def test_mat_composite_materials():
    result = read_product_type("Crumb Rubber Mat with PP Felt Face Door Mat")
    assert result["product_type"] == "Door Mat"
    assert result["product_material"] == "Crumb Rubber; Felt; Polypropylene"

def test_mat_shaped_is_distinct_from_die_cut():
    assert read_product_type("shaped velvet mat")["product_construction"] == "Shaped"

def test_outdoor_typo():
    assert read_product_type("Crumb Rubber Outfdoor Mat")["product_type"] == "Outdoor Mat"

def test_tpe_mat_ambiguous_placement():
    result = read_product_type("die cut TPE floor/door mat")
    assert result["product_type"] == "Mat"
    assert result["product_material"] == "TPE"

def test_synthetic_rattan_is_not_natural_fiber():
    assert read_product_type("PE rattan wall shelf")["product_material"] == "PE Rattan"

def test_dolomite_material_is_preserved():
    assert read_product_type("Dolomite Mug")["product_material"] == "Dolomite"

@pytest.mark.parametrize("description", ["canvas and paper print", "canvas MDF plaque", "canvas and mug", "assorted canvas mug"])
def test_owner_ruled_mixed_products_unreadable(description):
    assert read_product_type(description)["product_type_status"] == "unreadable"

@pytest.mark.parametrize("description,product", [("Canvas w Paint Pots", "Paint-Your-Own Canvas Set"),
    ("block perpetual calendar MDF", "Perpetual Calendar"), ("Printed PVC Foam Mat", "Mat"),
    ("Custom Shaped Mat", "Mat"), ("Print in Framed MDF", "Framed Print")])
def test_confirmed_compound_variants(description, product):
    assert read_product_type(description)["product_type"] == product

@pytest.mark.parametrize("description,treatment", [("Canvas with rough gel coat", "Gel Coat"),
    ("Canvas with all-over glitter", "Glitter"), ("High Gloss Landscape Canvas", "High Gloss")])
def test_physical_qualifier_grammar(description, treatment):
    assert read_product_type(description)["product_treatment"] == treatment

def test_lenticular_explicit_frame_material():
    result = read_product_type('3D lenticular portrait in 1" MDF frame')
    assert result["product_type"] == "Framed Lenticular Art"
    assert result["product_material"] == "MDF"
    assert result["product_construction"] == "Framed"

def test_photo_frame_suffix_die_cut():
    assert read_product_type("photo frame die cut")["product_construction"] == "Die-Cut"

def test_shadowbox_paper_texture():
    assert read_product_type("Glass Shadowbox texture paper")["product_material"] == "Glass; Paper"

def test_flat_domed_storage_chest():
    assert read_product_type("flat domed storage chest")["product_construction"] == "Flat-Domed"

@pytest.mark.parametrize("description,product", [("MDF letter", "Decorative Letter"),
    ("greyboard monogram", "Monogram"), ("wall monogram", "Wall Monogram"),
    ("MDF tabletop plaque", "Tabletop Plaque"), ("MDF door sign", "Door Sign")])
def test_placement_is_not_invented(description, product):
    assert read_product_type(description)["product_type"] == product

def test_layered_laser_cut_construction():
    result = read_product_type("layered MDF laser cut plaque")
    assert result["product_type"] == "Plaque"
    assert result["product_construction"] == "Laser-Cut; Layered"

@pytest.mark.parametrize("size", ["20 x 30 x 1.5", "16x20", "20x16"])
def test_dimensions_preserve_artwork_boundary(size):
    result = read_product_type("Distressed Canvas " + size + " Fictional Hero")
    assert result["product_type"] == "Canvas"
    assert result["product_material"] == "Canvas"

@pytest.mark.parametrize("description,product", [("Shadowbox Bank", "Shadowbox Bank"),
    ("Wall Bank", "Wall Bank"), ("diecut MDF destination signs", "Sign"),
    ("LED Infinity Art", "LED Infinity Art"), ("floating character MDF box", "Floating Character Box"),
    ("Corkboard", "Corkboard"), ("3D Lenticular plaque", "Plaque"),
    ("Garden Flag", "Garden Flag"), ("Framed Art under glass", "Framed Art"), ("velvetmat", "Mat")])
def test_specific_physical_products(description, product):
    assert read_product_type(description)["product_type"] == product

def test_faux_book_storage_construction():
    actual = read_product_type("Faux Book Storage")
    assert (actual["product_type"], actual["product_construction"]) == ("Faux Book", "")

def test_dry_erase_treatment():
    assert read_product_type("dry erase memo board")["product_treatment"] == "Dry-Erase"

def test_art_does_not_infer_print():
    assert read_product_type("Framed MDF Art")["product_type"] == "Framed Art"

def test_numbered_paint_pots():
    assert read_product_type("Canvas w 6 paint pots")["product_type"] == "Paint-Your-Own Canvas Set"

def test_fictional_identity_is_not_material():
    assert read_product_type("Canvas Fictional Hero")["product_material"] == "Canvas"

def test_dimension_followed_by_explicit_frame_metadata():
    result = read_product_type('3D lenticular portrait 11x17 MDF frame width 1 inch')
    assert result["product_type"] == "Framed Lenticular Art"
    assert result["product_material"] == "MDF"
    assert result["product_construction"] == "Framed"


def test_lenticular_3d_word_is_image_effect_not_physical_relief():
    result = read_product_type('3D lenticular portrait in MDF frame')
    assert result['product_type'] == 'Framed Lenticular Art'
    assert result['product_construction'] == 'Framed'


def test_physical_3d_relief_keeps_depth_construction():
    result = read_product_type('3D relief art')
    assert result['product_construction'] == '3D'


def test_framed_printed_canvas_is_not_plain_canvas():
    result = read_product_type('Framed printed canvas')
    assert result['product_type'] == 'Framed Canvas'
    assert result['product_material'] == 'Canvas'
    assert result['product_construction'] == 'Framed'


def test_canvas_print_in_floating_frame_is_framed_canvas():
    result = read_product_type('Canvas print in floating frame')
    assert result['product_type'] == 'Framed Canvas'
    assert result['product_construction'] == 'Floating Frame'


def test_framed_wall_art_does_not_invent_a_print():
    result = read_product_type('Arch framed wall art')
    assert result['product_type'] == 'Framed Art'


def test_printed_mdf_in_deep_frame_is_framed_print():
    result = read_product_type('Printed MDF in deep frame')
    assert result['product_type'] == 'Framed Print'
    assert result['product_material'] == 'MDF'
    assert result['product_construction'] == 'Deep Frame; Framed'


def test_material_at_start_survives_artwork_between_it_and_product():
    result = read_product_type('MDF Yellow pals frame wall art')
    assert result['product_type'] == 'Wall Art'
    assert result['product_construction'] == 'Framed'
    assert result['product_material'] == 'MDF'


def test_shelf_without_wall_word_has_no_invented_placement():
    result = read_product_type('MDF half-face shelf')
    assert result['product_type'] == 'Shelf'
    assert result['product_material'] == 'MDF'


def test_deckled_paper_is_framed_art_without_invented_print():
    result = read_product_type('Framed deckled edge paper with mat')
    assert result['product_type'] == 'Framed Art'
    assert result['product_material'] == 'Paper'


def test_deep_framed_mdf_print_keeps_explicit_print_type():
    result = read_product_type('Deep framed MDF print')
    assert result['product_type'] == 'Framed Print'
    assert result['product_material'] == 'MDF'


def test_greyboard_lift_off_storage_without_container_noun_abstains():
    result = read_product_type('Lift off greyboard storage with foil')
    assert result['product_type_status'] == 'unreadable'
    assert result['product_type'] == ''
    assert result['product_construction'] == ''
    assert result['product_material'] == ''
    assert result['product_treatment'] == ''


def test_lift_off_storage_with_finish_still_needs_container_noun():
    assert read_product_type('Large lift-off storage with glitter and foil')['product_type_status'] == 'unreadable'
    assert read_product_type('Large lift-off storage box with glitter')['product_type'] == 'Hard Storage Box'


def test_suitcs_abbreviation_names_a_physical_suitcase():
    assert read_product_type('Polyester SUITCS with handle')['product_type'] == 'Storage Suitcase'


def test_explicit_substrate_or_finish_art_noun_is_physical():
    assert read_product_type('High gloss art 16x20 with abstract design')['product_type'] == 'Art'
    assert read_product_type('Die cut MDF art 8x10')['product_type'] == 'Art'
    assert read_product_type('Suede art 8x10 with painted waves')['product_type'] == 'Art'
    assert read_product_type('MDF diecut silhouette art 8x10')['product_type'] == 'Art'
    assert read_product_type('Double layer diecut art 8x10')['product_type'] == 'Die-Cut Art'
    assert read_product_type('Die cut pieced MDF logo art 8x10')['product_type'] == 'Art'
    assert read_product_type('Cross stitch embroidered art 8x10')['product_type'] == 'Art'
    assert read_product_type('LED neon wire art 8x10')['product_type'] == 'Art'
    assert read_product_type('Canvas with line art pattern')['product_type'] == 'Canvas'


def test_boxed_art_noun_is_distinct_from_boxed_artwork_caption():
    assert read_product_type('Boxed art with raised paper layers')['product_type'] == 'Boxed Art'
    assert read_product_type('Boxed artwork caption only')['product_type_status'] == 'unreadable'


def test_framed_and_embroidered_art_require_explicit_art_noun():
    assert read_product_type('Framed PU mounted art with raised motif')['product_type'] == 'Framed Art'
    assert read_product_type('Framed puzzle art with border')['product_type'] == 'Framed Puzzle Art'
    assert read_product_type('Setback framed mounted art with metallic PU')['product_type'] == 'Framed Art'
    assert read_product_type('Cross stitch embroidery art 10x12')['product_type'] == 'Embroidery Art'
    assert read_product_type('Framed PU mount with portrait scene')['product_type_status'] == 'unreadable'


def test_fabric_hanging_wall_art_keeps_art_form_and_hanging_construction():
    for description in ('Fabric hanging wall art 12x18 geometric pattern',
                        'Hanging fabric wall art 12x18 geometric pattern',
                        'Wool fabric embroidered hanging wall art 12x18'):
        result = read_product_type(description)
        assert result['product_type'] == 'Wall Art'
        assert result['product_construction'] == 'Hanging'


def test_box_storage_word_order_names_storage_box_without_hardness_inference():
    assert read_product_type('Shaped 10x12 box greyboard storage set')['product_type'] == 'Storage Box'
    assert read_product_type('Framed canvas box artwork')['product_type'] == 'Framed Canvas'


def test_chalkboard_artwork_on_mdf_box_does_not_invent_functional_board():
    assert read_product_type('Chalkboard art MDF box 10x12 graphic')['product_type'] == 'MDF Box'
    assert read_product_type('Functional chalkboard with box pattern')['product_type'] == 'Chalkboard'


def test_chalkboard_artwork_on_canvas_does_not_change_canvas_form():
    assert read_product_type('Canvas with chalkboard artwork')['product_type'] == 'Canvas'
    assert read_product_type('Canvas chalkboard design')['product_type'] == 'Canvas'
    assert read_product_type('Functional chalkboard with canvas backing')['product_type'] == 'Chalkboard'


def test_product_phrase_cannot_cross_size_into_artwork():
    result = read_product_type('Canvas 10x20 framed paper artwork')
    assert result['product_type'] == 'Canvas'
    assert result['product_construction'] == ''
    assert read_product_type('Framed canvas 10x20 abstract artwork')['product_type'] == 'Framed Canvas'


def test_framed_substrate_without_object_noun_abstains_consistently():
    assert read_product_type('Framed paper 10x12 high gloss')['product_type_status'] == 'unreadable'
    assert read_product_type('Framed MDF 10x12 high gloss')['product_type_status'] == 'unreadable'
    assert read_product_type('Framed paper art 10x12')['product_type'] == 'Framed Art'


def test_literal_functional_guitar_hook_outweighs_generic_hook():
    assert read_product_type('Functional guitar hook with LED and MDF')['product_type'] == 'Guitar Hook'


def test_lenticular_effect_on_mdf_box_does_not_change_box_form():
    assert read_product_type('MDF box with lenticular image')['product_type'] == 'MDF Box'
    assert read_product_type('Lenticular art on MDF backing')['product_type'] == 'Lenticular Art'


def test_explicit_garden_tool_set_is_one_named_set_product():
    assert read_product_type('Garden tool set with steel handles')['product_type'] == 'Garden Tool Set'
    assert read_product_type('Garden tool with steel handle')['product_type'] == 'Garden Tool'


def test_physical_wall_clock_and_perpetual_calendar_abbreviation():
    assert read_product_type('Molded wall clock with pendulum')['product_type'] == 'Wall Clock'
    assert read_product_type('MDF block perpetual CLNDR with month tabs')['product_type'] == 'Perpetual Calendar'
    assert read_product_type('Canvas 10x12 artwork wall clock scene')['product_type'] == 'Canvas'


@pytest.mark.parametrize(('description', 'product_type'), [
    ('PRCH LNR with LED border', 'Porch Leaner'),
    ('STPPING STNE with handprint mold', 'Stepping Stone'),
    ('Molded wall figures with ribbon', 'Wall Figure'),
    ('Fabric wall mask with hanging loop', 'Wall Mask'),
    ('Glass votive holder with metal base', 'Votive Holder'),
    ('Garden flags with stakes', 'Garden Flag'),
])
def test_literal_physical_forms_and_bounded_abbreviations(description, product_type):
    assert read_product_type(description)['product_type'] == product_type


def test_led_light_artwork_does_not_change_canvas_form():
    assert read_product_type('Canvas with LED light artwork 10x12')['product_type'] == 'Canvas'


@pytest.mark.parametrize(('description', 'product_type'), [
    ('Wood birdhouse with hanging cord', 'Birdhouse'),
    ('Wood bird house with hanging cord', 'Birdhouse'),
    ('Cork pinboard with calendar grid', 'Pinboard'),
    ('Cork pin board with calendar grid', 'Pinboard'),
    ('Fabric pin board with magnetic strip', 'Pinboard'),
    ('Lawn sign with ground stakes', 'Lawn Sign'),
    ('Kitchen organizer with drawer', 'Kitchen Organizer'),
    ('Hanging 4 shelf organizer with zipper', 'Hanging Organizer'),
    ('6 shelf hanging organizer with zipper', 'Hanging Organizer'),
    ('MDF wall plaque with hanging cord', 'Wall Plaque'),
    ('Ceramic wall tile with glaze', 'Wall Tile'),
])
def test_explicit_physical_subtype_nouns(description, product_type):
    assert read_product_type(description)['product_type'] == product_type


def test_bird_feeder_and_canvas_pinboard_artwork_keep_their_forms():
    assert read_product_type('Wood bird feeder with hanging cord')['product_type'] == 'Bird Feeder'
    assert read_product_type('Canvas 10x12 artwork pinboard scene')['product_type'] == 'Canvas'


def test_canvas_in_tray_box_names_canvas_not_packaging():
    assert read_product_type('Set of 2 printed canvas in a tray box')['product_type'] == 'Canvas'
    assert read_product_type('Canvas and tray box')['product_type_status'] == 'unreadable'


def test_explicit_kitchen_mat_and_neon_box_nouns():
    assert read_product_type('Cushioned kitchen mat with pattern')['product_type'] == 'Kitchen Mat'
    assert read_product_type('LED neon box with acrylic cover')['product_type'] == 'Neon Box'


def test_shadowbox_frame_needs_literal_glass_for_glass_subtype():
    assert read_product_type('Die-cut paper art in shadowbox frame')['product_type'] == 'Framed Shadowbox'
    assert read_product_type('Printed glass shadowbox frame with foil')['product_type'] == 'Framed Glass Shadowbox'


@pytest.mark.parametrize('description', [
    'Framed linen under glass with deckled edge print 12x16',
    'Metal bow frame MDF print with foil',
    'Framed glitter print 12x16',
    'Framed layered MDF print with LED',
    'FRMD HIGH GLSS PRNT 12x16',
    'Framed prints with mat',
    'MDF print with thin black frame 12x16',
])
def test_explicit_physical_frame_print_assemblies(description):
    assert read_product_type(description)['product_type'] == 'Framed Print'


def test_frame_only_in_print_artwork_does_not_frame_product():
    assert read_product_type('Paper print 12x16 artwork with arched frame pattern')['product_type'] == 'Print'


@pytest.mark.parametrize(('description', 'product_type'), [
    ('Clear hang tab with adhesive', 'Hang Tab'),
    ('3D LENTCLR print on board', 'Lenticular Art'),
    ('Cushioned LAP DSK with handle', 'Lap Desk'),
    ('Folding LLAP DESK with legs', 'Lap Desk'),
    ('PP MLD WALL COLCKS with pendulum', 'Wall Clock'),
])
def test_bounded_physical_noun_abbreviations(description, product_type):
    assert read_product_type(description)['product_type'] == product_type


def test_drawer_tier_storage_without_container_noun_abstains():
    assert read_product_type('DRWR TIER STRGE with wheels')['product_type_status'] == 'unreadable'
    assert read_product_type('Drawer tier storage tower with wheels')['product_type'] == 'Storage Tower'


def test_printed_glass_shadowbox_beats_glass_art():
    result = read_product_type('Printed glass shadowbox')
    assert result['product_type'] == 'Framed Glass Shadowbox'
    assert result['product_material'] == 'Glass'


def test_lenticular_art_with_later_frame_metadata_is_framed():
    result = read_product_type('3D lenticular portrait 11x17 0.59 frame width')
    assert result['product_type'] == 'Framed Lenticular Art'
    assert result['product_construction'] == 'Framed'


def test_plural_photo_frames_are_not_unreadable():
    result = read_product_type('Infant multi photo frames')
    assert result['product_type'] == 'Photo Frame'


def test_plain_plaque_with_explicit_material_remains_neutral():
    result = read_product_type('Aluminum plaque')
    assert result['product_type'] == 'Plaque'
    assert result['product_material'] == 'Aluminum'


def test_window_cling_plural_is_a_product():
    assert read_product_type('Window clings with cut edge')['product_type'] == 'Window Cling'


def test_material_print_is_read_without_artwork_semantics():
    result = read_product_type('MDF metallic print')
    assert result['product_type'] == 'Print'
    assert result['product_material'] == 'MDF'
    assert result['product_treatment'] == 'Metallic'


def test_different_named_products_joined_by_and_are_unreadable():
    result = read_product_type('Perpetual calendars and MDF blocks')
    assert result['product_type_status'] == 'unreadable'
    assert result['product_type'] == ''


def test_lenicular_typo_still_reads_image_type():
    assert read_product_type('3D Lenicular image')['product_type'] == 'Lenticular Art'


def test_stated_mdf_before_short_artwork_words_is_kept():
    result = read_product_type('Infant multi photo MDF collage frame')
    assert result['product_material'] == 'MDF'


def test_wool_fabric_is_one_specific_material():
    result = read_product_type('Wool fabric embroidered hanging wall art')
    assert result['product_material'] == 'Wool'


def test_linen_paper_is_paper_stock_not_linen_fabric():
    result = read_product_type('Framed linen paper print')
    assert result['product_material'] == 'Paper'


def test_linen_hamper_keeps_explicit_linen_material():
    result = read_product_type('Linen hamper')
    assert result['product_material'] == 'Linen'


def test_bow_shape_does_not_imply_attached_bow_treatment():
    assert read_product_type('Metal bow frame')['product_treatment'] == ''
    assert read_product_type('Canvas with bows')['product_treatment'] == 'Attachment'


def test_physical_foil_clause_after_artwork_is_read():
    result = read_product_type('Ceramic block_Tabletop flowers_Copper foil_4x4')
    assert result['product_treatment'] == 'Foil'


def test_artwork_foil_word_is_not_read_as_finish():
    result = read_product_type('Ceramic block_Foil hero artwork_4x4')
    assert result['product_treatment'] == ''


def test_plural_led_and_glitter_abbreviations_are_physical_modifiers():
    assert read_product_type('Tall sign with LEDs')['product_treatment'] == 'LED'
    assert read_product_type('Canvas w glttr')['product_treatment'] == 'Glitter'


def test_canvas_with_named_acrylic_frame_is_framed_canvas():
    result = read_product_type('Canvas w acrylic frame and spot varnish')
    assert result['product_type'] == 'Framed Canvas'
    assert result['product_material'] == 'Acrylic; Canvas'


def test_floating_frame_paper_print_is_framed_print():
    result = read_product_type('Float frame embossed paper print')
    assert result['product_type'] == 'Framed Print'
    assert result['product_material'] == 'Paper'


def test_multi_photo_mdf_collage_frame_is_photo_frame():
    result = read_product_type('Infant multi photo MDF collage frame')
    assert result['product_type'] == 'Photo Frame'
    assert result['product_material'] == 'MDF'


def test_file_organizer_specificity():
    assert read_product_type('Hanging file organizer')['product_type'] == 'File Organizer'


def test_shelves_inside_named_closet_organizer_do_not_become_product_type():
    result = read_product_type('3 shelf hanging closet organizer')
    assert result['product_type'] == 'Hanging Closet Organizer'


def test_alarm_clock_beats_desktop_clock_family():
    assert read_product_type('Desktop alarm clock')['product_type'] == 'Alarm Clock'


def test_tapestry_explicit_noun_beats_hanging_wall_art_family():
    assert read_product_type('Wool fabric embroidered hanging tapestry')['product_type'] == 'Tapestry'


def test_typo_lenticular_frame_still_reads_framed_form():
    assert read_product_type('Frmd 3D lntclr')['product_type'] == 'Framed Lenticular Art'


def test_bare_lenticular_does_not_invent_frame():
    assert read_product_type('Lenticular portrait')['product_type'] == 'Lenticular Art'


def test_plush_cube_art_is_named_product():
    assert read_product_type('Plush CubeArt')['product_type'] == 'Plush Cube Art'


def test_ceramic_cube_and_die_cut_figure_are_physical_nouns():
    assert read_product_type('Ceramic cube')['product_type'] == 'Cube'
    assert read_product_type('MDF diecut figure')['product_type'] == 'Decorative Figure'


def test_desktop_org_abbreviation_keeps_neutral_type():
    assert read_product_type('4 compartment desktop org')['product_type'] == 'Desktop Organizer'


def test_faux_book_desktop_storage_is_specific_box_form():
    assert read_product_type('Faux book desktop storage')['product_type'] == 'Faux Book'


def test_framed_poster_is_framed_print():
    assert read_product_type('Framed poster')['product_type'] == 'Framed Print'


def test_wool_fabric_hanging_wall_art_keeps_plain_product_type():
    result = read_product_type('Wool fabric embroidered hanging wall art')
    assert result['product_type'] == 'Wall Art'
    assert result['product_construction'] == 'Hanging'
    assert result['product_material'] == 'Wool'
    assert result['product_treatment'] == 'Embroidery'


def test_lenticular_plaque_keeps_physical_plaque_type():
    assert read_product_type('3D lenticular plaque')['product_type'] == 'Plaque'


def test_named_banner_and_pennant_are_specific_forms():
    assert read_product_type('Canvas hanging fishtail banner')['product_type'] == 'Banner'
    assert read_product_type('Hanging pennant')['product_type'] == 'Pennant'


def test_printed_glass_before_artwork_shadowbox_noun_is_shadowbox():
    result = read_product_type('Printed glass red hero scene shadowbox frame')
    assert result['product_type'] == 'Framed Glass Shadowbox'
    assert result['product_material'] == 'Glass'


def test_two_shadowbox_material_variants_keep_common_type_without_material():
    result = read_product_type('Glass shadowbox, molded shadowbox')
    assert result['product_type'] == 'Framed Shadowbox'
    assert result['product_material'] == ''


def test_printed_metal_without_product_noun_is_unreadable():
    assert read_product_type('Printed galvanized steel with hero image')['product_type_status'] == 'unreadable'


def test_plank_palette_without_product_noun_is_unreadable():
    assert read_product_type('4 plank palette with lettering')['product_type_status'] == 'unreadable'


def test_dimension_does_not_eat_first_letter_of_high_gloss():
    result = read_product_type('11x14" x 1.5" high gloss canvas')
    assert result['product_type'] == 'Canvas'
    assert result['product_treatment'] == 'High Gloss'


def test_repeated_canvas_with_plain_and_glitter_keeps_common_type_only():
    result = read_product_type('Canvas with glitter and plain Canvas')
    assert result['product_type'] == 'Canvas'
    assert result['product_material'] == 'Canvas'
    assert result['product_treatment'] == ''


def test_bounded_treatment_parser_filters_legacy_artwork_and_variant_terms():
    assert read_product_type('Canvas, plain canvas with glitter')['product_treatment'] == ''
    assert read_product_type('Canvas 16x20 artwork girl with glitter')['product_treatment'] == ''
    assert read_product_type('Canvas with glitter 16x20 artwork girl')['product_treatment'] == 'Glitter'


def test_physical_shadowbox_noun_outranks_glass_art_modifier():
    assert read_product_type('Framed glass with fringed layered paper shadowbox')['product_type'] == 'Framed Glass Shadowbox'
    assert read_product_type('Framed glass 11x14 shadowbox artwork')['product_type'] == 'Framed Glass Art'


def test_product_before_size_outranks_artwork_noun_after_size():
    assert read_product_type('Canvas 11x14 Sticker Girl Power artwork')['product_type'] == 'Canvas'
    assert read_product_type('Canvas 16x20 artwork with block shapes')['product_type'] == 'Canvas'
    assert read_product_type('11x14 Canvas with glitter')['product_type'] == 'Canvas'


def test_physical_noun_outranks_lenticular_image_or_print_finish():
    assert read_product_type('3D lenticular flip on MDF plaque')['product_type'] == 'Plaque'
    assert read_product_type('Lenticular image on door hanger')['product_type'] == 'Door Hanger'
    assert read_product_type('MDF block with print')['product_type'] == 'Block'
    assert read_product_type('Block with print')['product_type'] == 'Block'
    assert read_product_type('Lenticular art and MDF plaque')['product_type_status'] == 'unreadable'


def test_sticker_artwork_after_canvas_does_not_change_the_product():
    assert read_product_type('11x14 Canvas w glitter Brand Alpha Sticker Caption')['product_type'] == 'Canvas'
    assert read_product_type('Canvas sticker collage artwork')['product_type'] == 'Canvas'
    assert read_product_type('Canvas character jumping with stickers')['product_type'] == 'Canvas'
    assert read_product_type('Canvas Sticker')['product_type'] != 'Canvas'


@pytest.mark.parametrize('description', [
    'Portrait in wood frame', 'Molded frame art',
    'Pressed leaves under glass in frame', 'Setback frame with raised icons',
    'Puzzle art with wood frame', 'Wrapped linen in floating frame',
])
def test_finished_content_inside_frame_is_framed_art(description):
    assert read_product_type(description)['product_type'] == 'Framed Art'


@pytest.mark.parametrize('description', [
    'FLTR FRME CNVS', 'Canvas floating frame12x36',
    'Framed embossed paper canvas', 'Floating frame embroidered canvas',
])
def test_bounded_frame_canvas_phrases(description):
    assert read_product_type(description)['product_type'] == 'Framed Canvas'


@pytest.mark.parametrize('description, expected', [
    ('Greyboard storage caddy', 'Storage Caddy'),
    ('MDF writing desks', 'Writing Desk'),
    ('Planter with photo frame', 'Planter with Photo Frame'),
    ('Decorative string lights', 'String Lights'),
])
def test_explicit_product_compounds_and_plurals(description, expected):
    assert read_product_type(description)['product_type'] == expected


@pytest.mark.parametrize('description', [
    'Framed rattan with raised resin icon',
    '2 layer framed die cut greyboard',
    'Setback framed metallic PU',
])
def test_framed_substrate_with_physical_insert(description):
    assert read_product_type(description)['product_type'] == 'Framed Art'


def test_framed_finish_and_portrait_without_object_noun_abstains():
    assert read_product_type('Framed high gloss textured portrait')['product_type_status'] == 'unreadable'


def test_literal_suncatcher_noun_does_not_read_its_depicted_artwork():
    assert read_product_type('Suncatcher with amber-colored design')['product_type'] == 'Suncatcher'
    assert read_product_type('Canvas with suncatcher artwork')['product_type'] == 'Canvas'


def test_artwork_tail_does_not_create_mixed_products():
    assert read_product_type('Canvas artwork pencil case and mug')['product_type'] == 'Canvas'
    assert read_product_type('Framed canvas artwork non-framed art')['product_type'] == 'Framed Canvas'
    assert read_product_type('Canvas and paper print')['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('spelling', ['nonwoven', 'non-woven', 'non woven'])
def test_nonwoven_spelling_keeps_fabric_without_woven_construction(spelling):
    result = read_product_type(spelling + ' storage bin')
    assert result['product_type'] == 'Storage Bin'
    assert result['product_material'] == 'Fabric'
    assert 'Woven' not in result['product_construction']


@pytest.mark.parametrize('description, expected', [
    ('Glass art with gold leaf', 'Glass Art'),
    ('Pritned glass art', 'Glass Art'),
    ('Hanging organizer with a pocket', 'Hanging Organizer'),
    ('Fabric desktop storage cubby', 'Desktop Organizer'),
])
def test_explicit_decorated_glass_and_storage_nouns(description, expected):
    assert read_product_type(description)['product_type'] == expected


@pytest.mark.parametrize('description', [
    'Assorted soft storage set samples',
    'Gold leaf on glass finish only',
    'Die cut cupcake motif',
    'Dry erase to-do list with marker and color art',
    'Hanging woven fabric storage with 1 pocket sample',
])
def test_technique_or_use_without_physical_noun_abstains(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', [
    'Cotton rope storage', 'Flat domed storage',
    'Lift off greyboard storage', 'Greyboard storage', 'Domed plastic storage',
])
def test_storage_function_without_container_noun_abstains(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


def test_storage_with_literal_container_noun_remains_readable():
    assert read_product_type('Cotton rope storage basket')['product_type'] == 'Storage Basket'
    assert read_product_type('Greyboard storage box')['product_type'] == 'Hard Storage Box'


def test_chest_noun_survives_block_artwork_but_not_separate_block_product():
    assert read_product_type('Assorted dome chests')['product_type'] == 'Storage Chest'
    assert read_product_type('Greyboard storage chest with block pattern artwork')['product_type'] == 'Storage Chest'
    assert read_product_type('Storage chest and block')['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', [
    'Mlded shadwbx', 'Shadwbox with diamond dust', 'SHBX Brand Alpha',
])
def test_abbreviated_shadowbox_stays_neutral_without_frame_evidence(description):
    assert read_product_type(description)['product_type'] == 'Shadowbox'
    assert read_product_type(description)['product_type_status'] == 'accepted'
    assert read_product_type('Framed glass shadowbox')['product_type'] == 'Framed Glass Shadowbox'


@pytest.mark.parametrize('description', [
    'rCanvas 12x16', 'DistressedCanvas 12x16',
    'LicensesCanvas 12x16', 'Canvas40 12x16', 'Canvas40x30', 'Canvasw Glitter',
])
def test_joined_canvas_wording_recovers_explicit_noun(description):
    assert read_product_type(description)['product_type'] == 'Canvas'


def test_repeated_canvas_with_same_foil_keeps_shared_finish():
    result = read_product_type('Canvas with foil and Canvas with foil')
    assert result['product_treatment'] == 'Foil'


def test_printed_glass_same_form_mixed_foil_has_blank_treatment():
    result = read_product_type('Printed glass and printed glass with foil')
    assert result['product_type'] == 'Glass Art'
    assert result['product_treatment'] == ''


def test_explicit_canvas_attachment_keeps_named_material():
    result = read_product_type('Canvas w acrylic attachment')
    assert result['product_material'] == 'Acrylic; Canvas'
    assert result['product_treatment'] == 'Attachment'


def test_literal_embellishments_are_recorded_as_treatment():
    assert read_product_type('Canvas with embellishments')['product_treatment'] == 'Embellished'


def test_pu_and_steel_are_stored_only_when_named():
    assert read_product_type('MDF box with PU leather')['product_material'] == 'MDF; PU Leather'
    assert read_product_type('MDF box with steel clips')['product_material'] == 'MDF; Steel'


def test_faux_fur_is_explicit_material_not_real_fur():
    result = read_product_type('Shaped faux fur rug')
    assert result['product_material'] == 'Faux Fur'
    assert result['product_construction'] == 'Shaped'


def test_deckled_matted_framed_print_keeps_both_constructions():
    result = read_product_type('Framed deckled edge paper print with mat')
    assert 'Deckled Edge' in result['product_construction']
    assert 'Matted' in result['product_construction']


def test_mdf_plaque_with_hooks_keeps_literal_plaque_type():
    result = read_product_type('MDF plaque with hooks')
    assert result['product_type'] == 'Plaque'
    assert result['product_construction'] == 'With Hooks'


def test_shadowbox_message_board_is_a_message_board():
    result = read_product_type('Printed glass shadowbox message board')
    assert result['product_type'] == 'Message Board'
    assert result['product_construction'] == 'Shadowbox'


def test_die_cut_icon_is_attachment_on_plaque():
    result = read_product_type('MDF plaque with die cut icon')
    assert result['product_type'] == 'Plaque'
    assert result['product_construction'] == 'Die-Cut Attachment'


def test_custom_shaped_coir_mat_does_not_invent_door_placement():
    result = read_product_type('Debossed coir mat')
    assert result['product_type'] == 'Mat'
    assert result['product_material'] == 'Coir'


def test_outdoor_mat_is_not_door_mat():
    assert read_product_type('Crumb rubber outdoor mat')['product_type'] == 'Outdoor Mat'


def test_generic_plural_mats_are_read_despite_assortment_word():
    assert read_product_type('Assorted licensed mats')['product_type'] == 'Mat'


def test_wall_or_tabletop_placement_is_not_inferred_for_planter():
    assert read_product_type('Ceramic planter')['product_type'] == 'Planter'


def test_explicit_toy_chest_beats_generic_chest():
    assert read_product_type('Greyboard toy chest')['product_type'] == 'Storage Toy Chest'


def test_frmed_stained_glass_art_keeps_frame_and_finish():
    result = read_product_type('Framed stained glass art')
    assert result['product_type'] == 'Framed Glass Art'
    assert result['product_treatment'] == 'Stained Glass'


def test_mdf_box_with_floating_character_is_specific_product():
    assert read_product_type('MDF box with floating character')['product_type'] == 'Floating Character Box'


def test_artwork_named_mug_after_box_does_not_create_mixed_product():
    result = read_product_type('MDF box with foil Winter Holiday Central Perk mug illustration')
    assert result['product_type'] == 'MDF Box'
    assert result['product_treatment'] == 'Foil'


def test_two_directly_joined_distinct_products_are_unreadable():
    result = read_product_type('Canvas and MDF plaque')
    assert result['product_type_status'] == 'unreadable'

@pytest.mark.parametrize("description,product", [("wall art", "Wall Art"),
    ("wall decoration", "Wall Art"), ("art", "Art"),
    ("assorted contractual organizers", "Organizer")])
def test_broad_source_noun_remains_readable(description, product):
    result = read_product_type(description)
    assert result["product_type"] == product
    assert result["product_type_status"] == "accepted"
    assert result["product_material"] == ""

def test_generic_art_tail_cannot_change_specific_product():
    assert read_product_type("Acrylic Pencil Case Mascot Art")["product_type"] == "Pencil Case"

def test_lenticular_material_is_not_finished_product():
    assert read_product_type("Lenticular material sample only")["product_type_status"] == "unreadable"

def test_rope_does_not_infer_natural_fiber():
    assert read_product_type("rope storage basket")["product_material"] == "Rope"

@pytest.mark.parametrize("prefix", ["Fictional Hero red", "Studio Alpha blue", "Fable Book green", ""])
@pytest.mark.parametrize("suffix", [" 16x20_Group Shot", " 20x16_Artwork Fictional Hero", "_Wood Duck", ""])
def test_type_invariant_to_metadata(prefix, suffix):
    assert read_product_type(prefix + " Acrylic Pencil Case" + suffix)["product_type"] == "Pencil Case"

def test_hash_seed_determinism():
    code = 'import json; from tools.product_type_reader import read_product_type; print(json.dumps(read_product_type("MDF die-cut block"), sort_keys=True))'
    outputs = [subprocess.check_output([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[2],
               env={**os.environ, "PYTHONHASHSEED": str(seed)}, text=True) for seed in [1, 42, 999]]
    assert len(set(outputs)) == 1


@pytest.mark.parametrize("description,product,material", [
    ("Coir Mart", "Mat", "Coir"),
    ("MDF bx", "MDF Box", "MDF"),
    ("MDF Reverse Box", "MDF Box", "MDF"),
    ("Framed mirror", "Framed Mirror", ""),
    ("Storage chest", "Storage Chest", ""),
    ("Dry erase calendar", "Calendar", ""),
    ("Wall clck", "Wall Clock", ""),
    ("Poster", "Poster", ""),
    ("Tile", "Tile", ""),
    ("Painting", "Painting", ""),
    ("Sign", "Sign", ""),
    ("Box", "Box", ""),
    ("Wire word on MDF", "Decorative Word", "MDF; Wire"),
    ("Framed frayed burlap", "Framed Fabric Art", "Fabric"),
])
def test_explicit_product_noun_and_reviewed_abbreviations(description, product, material):
    result = read_product_type(description)
    assert result["product_type"] == product
    assert result["product_material"] == material


def test_unqualified_mart_or_bx_does_not_invent_a_product():
    assert read_product_type("Fictional Hero Mart")["product_type_status"] == "unreadable"
    assert read_product_type("Blue bx")["product_type_status"] == "unreadable"


@pytest.mark.parametrize("description,product,construction", [
    ("Four-pack canvas set", "Canvas", ""),
    ("Five piece staggered canvas set", "Canvas", "Staggered"),
    ("Canvas set with paint pots and brush", "Paint-Your-Own Canvas Set", ""),
])
def test_product_set_does_not_duplicate_quantity(description, product, construction):
    result = read_product_type(description)
    assert result["product_type"] == product
    assert result["product_construction"] == construction


def test_frame_modifier_survives_intervening_artwork_name():
    result = read_product_type("MDF Framed Steel Wire Wall Art")
    assert result["product_type"] == "Wall Art"
    assert result["product_construction"] == "Framed"


def test_floating_frame_is_assembly_even_when_frame_is_the_only_product_noun():
    result = read_product_type("Floating Frame with gel illustration")
    assert result["product_type"] == "Frame"
    assert result["product_construction"] == "Floating Frame"


def test_die_cut_product_shape_survives_brief_artwork_wording():
    result = read_product_type("Desktop phone stand Fictional Hero die-cut")
    assert result["product_type"] == "Phone Stand"
    assert result["product_construction"] == "Die-Cut"


def test_die_cut_icon_remains_attachment_not_whole_product_shape():
    result = read_product_type("MDF plaque with die-cut icon")
    assert result["product_construction"] == "Die-Cut Attachment"


def test_canvas_print_with_acrylic_frame_is_framed_canvas():
    result = read_product_type("Canvas print w acrylic frame")
    assert result["product_type"] == "Framed Canvas"
    assert result["product_construction"] == "Framed"


def test_framed_comic_collage_names_framed_art():
    result = read_product_type("Framed comic collage")
    assert result["product_type"] == "Framed Collage"
    assert result["product_construction"] == "Framed"


def test_printed_glass_with_short_frame_clause_is_framed_glass_art():
    result = read_product_type("Printed glass w glitter back print blue frame")
    assert result["product_type"] == "Framed Glass Art"
    assert result["product_material"] == "Glass"


def test_floating_frame_embossed_canvas_keeps_framed_type():
    result = read_product_type("Floating FrameEmbossed Canvas")
    assert result["product_type"] == "Framed Canvas"
    assert result["product_construction"] == "Floating Frame"


def test_lift_off_lid_is_construction():
    result = read_product_type("Greyboard lift-off lid storage box")
    assert result["product_construction"] == "Lift-Off"


def test_molded_wall_clock_abbreviations():
    result = read_product_type("PP mlded wll clck")
    assert result["product_type"] == "Wall Clock"
    assert result["product_construction"] == "Molded"


def test_corkboard_noun_states_cork_material():
    result = read_product_type("Die-cut corkboard")
    assert result["product_type"] == "Corkboard"
    assert result["product_material"] == "Cork"


def test_misspelled_landscape_keeps_adjacent_led_treatment():
    result = read_product_type("LED lanscape canvas")
    assert result["product_treatment"] == "LED"


def test_moving_led_after_canvas_is_explicit_treatment():
    result = read_product_type("Canvas with moving LED")
    assert result["product_treatment"] == "LED"


def test_led_message_box_is_named_product():
    result = read_product_type("LED message box")
    assert result["product_type"] == "Message Box"
    assert result["product_treatment"] == "LED"


def test_desk_organizer_is_neutral_desktop_product():
    assert read_product_type("Desk organizer")['product_type'] == 'Desktop Organizer'


def test_trinket_tray_plural_pattern_covers_singular():
    assert read_product_type("Ceramic trinket tray")['product_type'] == 'Trinket Tray'


def test_porch_leaner_is_explicit_product_noun():
    assert read_product_type("Porch leaner with LED")['product_type'] == 'Porch Leaner'


def test_lift_off_greyboard_storage_without_box_noun_abstains():
    assert read_product_type("Lift-off greyboard storage")['product_type_status'] == 'unreadable'


def test_mdf_die_cut_tabletop_block_keeps_explicit_placement():
    assert read_product_type("MDF die-cut block tabletop decor")['product_type'] == 'Tabletop Block'


def test_framed_banner_beats_generic_frame():
    assert read_product_type("Framed banner under glass")['product_type'] == 'Banner'


def test_abbreviated_distinct_canvas_and_print_are_unreadable():
    assert read_product_type("CNVS & PRNT")['product_type_status'] == 'unreadable'


def test_distinct_toy_chest_and_hamper_are_unreadable():
    assert read_product_type("Toy Chst, Grybrd Strge Hmpr")['product_type_status'] == 'unreadable'


def test_frm_abbreviation_preserves_physical_context():
    assert read_product_type("FRM MDF Wall Art")['product_type'] == 'Framed Art'
    assert read_product_type("FLTNG FRM CNVS")['product_type'] == 'Framed Canvas'


@pytest.mark.parametrize("description,product", [
    ("Button Art", "Button Art"),
    ("Dry erase easel with marker", "Easel"),
    ("Decorative LED Mirror Wall Art", "Mirror"),
    ("Metal alarm clock", "Alarm Clock"),
    ("Felt letterboard", "Letterboard"),
    ("Desk set organizer", "Desktop Organizer"),
    ("Four piece desktop org set", "Desktop Organizer"),
])
def test_literal_physical_noun_overrides_legacy_generic(description, product):
    assert read_product_type(description)["product_type"] == product


@pytest.mark.parametrize("description,product", [
    ("Floating Frame w Metallic Canvas", "Framed Canvas"),
    ("Floater Framed High Gloss Canvas", "Framed Canvas"),
    ("Stained Glass w Black Frame", "Framed Glass Art"),
    ("Embossed Paper Print with Foil on Floating Frame", "Framed Print"),
    ("Framed comic book under glass", "Framed Print"),
    ("Minimalist Print in wood frame", "Framed Print"),
    ("MDF Comic Cover Box Art", "MDF Box"),
])
def test_explicit_product_phrase_overrides_generic_frame_or_storage(description, product):
    assert read_product_type(description)["product_type"] == product


def test_distinct_box_and_calendar_are_unreadable():
    assert read_product_type("MDF Box & Perpetual Calendar")['product_type_status'] == 'unreadable'


def test_distinct_kneeler_and_glove_are_unreadable():
    assert read_product_type("Garden Kneeler and Glove Set")['product_type_status'] == 'unreadable'


def test_isolated_second_clause_can_name_canvas_product():
    result = read_product_type("Beach Dunes Grass_Printed Canvas Set_3x 12x24")
    assert result['product_type'] == 'Canvas'
    assert result['product_type_status'] == 'accepted'


def test_shadowbox_spelling_variation_still_names_product():
    assert read_product_type("Assorted shawowbox")['product_type'] == 'Shadowbox'


def test_domed_chest_is_explicit_storage_form():
    assert read_product_type("Domed chest")['product_type'] == 'Storage Chest'


@pytest.mark.parametrize("description,product", [
    ("Hanging poster", "Hanging Poster"),
    ("Papercard art print", "Art Print"),
    ("Die-cut MDF infant cast frame", "Cast Frame"),
    ("Woven wall decor", "Wall Art"),
    ("Glass storage box", "Hard Storage Box"),
    ("Faux book desk organizer", "Desktop Organizer"),
])
def test_explicit_merchant_product_phrase_beats_generic_family(description, product):
    assert read_product_type(description)['product_type'] == product


def test_bare_framed_mdf_with_only_identity_has_no_product_noun():
    assert read_product_type("FRM MDF Zorblax")['product_type_status'] == 'unreadable'


def test_framed_mdf_print_plus_canvas_is_mixed_products():
    assert read_product_type("FRMD MDF PRNT, CNVS")['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', ["Comic cover art", "Molded foam hero vector art", "Splatter art"])
def test_artwork_phrase_does_not_become_physical_art(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


def test_molded_foam_without_a_product_noun_is_not_placeholder():
    assert read_product_type("Assorted molded foam")['product_type_status'] == 'unreadable'


def test_canvas_art_print_keeps_canvas_physical_form():
    assert read_product_type("Canvas art print")['product_type'] == 'Canvas'


def test_explicit_tapestry_beats_generic_hanging_wall_art():
    assert read_product_type("Mini woven hanging tapestry with bars")['product_type'] == 'Tapestry'


@pytest.mark.parametrize("description,product", [
    ("Framed floated canvas", "Framed Canvas"),
    ("Canvas floater framed", "Framed Canvas"),
    ("Size chart long canvas", "Growth Chart"),
    ("Molded shdwbox", "Framed Shadowbox"),
    ("MDF plaque with 4 hooks", "Plaque"),
    ("Hook plaque", "Hook Plaque"),
    ("Plywood bird feeder", "Bird Feeder"),
    ("MDF reversible door sign", "Door Sign"),
    ("LED lit silhouette", "Light-Up Silhouette"),
    ("TPR gel sticker", "Gel Sticker"),
    ("Natural rattan dimensional bow", "Decorative Bow"),
    ("Magazine holder with drawer desktop org", "Magazine Holder"),
])
def test_explicit_special_product_noun_stays_specific(description, product):
    assert read_product_type(description)['product_type'] == product


def test_desk_organizer_and_separate_pencil_cup_are_mixed_products():
    result = read_product_type('MDF desk organizer set Seoul + pencil cup + phone stand')
    assert result['product_type_status'] == 'unreadable'


def test_block_tabletop_placement_after_noun_is_specific():
    assert read_product_type('Block tabletop decor')['product_type'] == 'Tabletop Block'
    assert read_product_type('Table top block')['product_type'] == 'Tabletop Block'


@pytest.mark.parametrize("description,product", [
    ("10x48 horror leaner with LED", "Leaner Sign"),
    ("Framed MDF lenticular", "Framed Lenticular Art"),
    ("Natural Rattan_Dimensional Bow_13x15", "Decorative Bow"),
    ("MDF wall pegs", "Wall Pegs"),
    ("Nonwoven storage cubes", "Storage Cube"),
    ("Die cut decorative shape", "Decorative Shape"),
    ("fake comic under glass", "Comic Art"),
    ("MDF die cut block7x8", "Block"),
    ("DIE CUT MDF BLCK", "Block"),
])
def test_physical_catalog_alias_stays_bounded(description, product):
    assert read_product_type(description)['product_type'] == product


@pytest.mark.parametrize('description', [
    'Canvas + Paper Print',
    'Canvas, molded shadowbox',
    'Toy chest, greyboard storage hamper, storage bin',
    'Lift-off greyboard storage, box greyboard storage',
    'Desk organizer set + pencil cup + phone stand',
])
def test_separately_named_distinct_forms_are_unreadable(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description,product', [
    ('Canvas, metallic canvas', 'Canvas'),
    ('Glass shadowbox, molded shadowbox', 'Framed Shadowbox'),
    ('MDF box with foil illustration print', 'MDF Box'),
    ('Box art with hooks', 'Box'),
    ('Canvas printed floral artwork', 'Canvas'),
])
def test_one_form_with_finish_or_accessory_is_not_mixed(description, product):
    assert read_product_type(description)['product_type'] == product


@pytest.mark.parametrize("description,product", [
    ("Cnvs24x36", "Canvas"),
    ("Assorted licensed pencil cups", "Pencil Cup"),
    ("Assorted fasux books", "Faux Book"),
    ("Assorted 7pc trunk set", "Storage Trunk"),
    ("Ottoman srtorage", "Storage Ottoman"),
    ("Ceramic tabletop decor", "Tabletop Decor"),
])
def test_explicit_noun_with_assortment_word_is_readable(description, product):
    assert read_product_type(description)['product_type'] == product


@pytest.mark.parametrize("description", [
    "Billing purpose for synthetic sample", "Additional cost and labor for rivets", "testquokka dsn",
])
def test_pure_admin_text_is_placeholder(description):
    assert read_product_type(description)['product_type_status'] == 'placeholder'


@pytest.mark.parametrize("description", [
    "Assorted framed", "Assorted tabletop samples", "Assorted coir",
    "Assorted glass samples", "Assorted portraits", "Assorted molded PVC",
])
def test_physical_clue_without_product_noun_is_unreadable(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


def test_blck_color_abbreviation_never_creates_block():
    assert read_product_type('BLCK logo artwork')['product_type_status'] == 'unreadable'
    assert read_product_type('DIE CUT MDF BLCK')['product_type'] == 'Block'


@pytest.mark.parametrize('description', [
    'Lap desk, writing desk with legs',
    'Printed glass shadowbox, printed glass',
    'Storage toy chest, tapered storage cube',
    'Canvas, small art',
    'MDF plaque, framed lenticular',
    'Cube & shaped ceramic block',
    'Framed Art - Non Framed',
    'Canvas Storage',
])
def test_distinct_or_contradictory_physical_forms_abstain(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


def test_hamper_built_into_hanging_closet_organizer_is_one_product():
    actual = read_product_type('Nonwoven storage 3 shelf hanging closet organizer with hamper')
    assert actual['product_type'] == 'Hanging Closet Organizer'
    assert actual['product_construction'] == 'Hanging'
    assert actual['product_type_status'] == 'accepted'
    assert read_product_type('Hanging closet organizer and hamper')['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', [
    'Back lit setback framed MDF with diecut icon',
    'Framed MDF original poster',
    'Framed high gloss MDF character poster',
])
def test_frame_material_and_poster_artwork_do_not_invent_art(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


def test_explicit_print_noun_survives_framed_mdf_artwork_guard():
    assert read_product_type('Framed MDF print with poster artwork')['product_type'] == 'Framed Print'


def test_generic_plush_fabric_storage_has_no_container_noun():
    assert read_product_type('Plush fabric storage with character face')['product_type_status'] == 'unreadable'
    assert read_product_type('Plush fabric stoarge')['product_type_status'] == 'unreadable'
    assert read_product_type('Plush fabric storage bin')['product_type'] == 'Storage Bin'


def test_domed_storage_needs_a_named_container():
    assert read_product_type('Domed storage with varnish')['product_type_status'] == 'unreadable'
    assert read_product_type('Domed storage chest')['product_type'] == 'Storage Chest'


@pytest.mark.parametrize('description', [
    'Lap desk, wrtng dsk with legs',
    'Desk organizer set with map cups and text tray',
    'Printed glass and shadowbox',
    'MDF plaque with foil and framed 3D lenticular',
    '3D lenticular and MDF with foil stamp',
])
def test_separately_named_forms_or_material_only_lenticular_abstain(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description,product', [
    ('MDF textured frame chalkboard with chalk', 'Chalkboard'),
    ('Metal bow frame MDF print', 'Framed Print'),
    ('MDF framed canv print', 'Framed Canvas'),
    ('MDF DIY pcture frme die-cut attachment', 'Photo Frame'),
    ('Framed MDF print with artwork', 'Framed Print'),
])
def test_explicit_object_noun_outranks_earlier_frame_word(description, product):
    assert read_product_type(description)['product_type'] == product


@pytest.mark.parametrize('description', [
    'Floating frame embossed print canvas, metallic canvas',
    'High gloss canvas, FF canvas',
    'Canvas, fl comic, glitter canvas',
    'Metallic canvas, glass 13x19',
    'Foil floral art metallic canvas',
    'Gel floral art varnish glass canvas',
])
def test_unbound_or_distinct_canvas_forms_abstain(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


def test_joined_finishes_and_single_canvas_remain_readable():
    assert read_product_type('Foil and metallic canvas')['product_type'] == 'Canvas'
    assert read_product_type('Floating frame canvas')['product_type'] == 'Framed Canvas'


@pytest.mark.parametrize('description', [
    'Resin pencil mask bust',
    'Shadow bow with laser cut coffee mug and matte border',
])
def test_incomplete_physical_nouns_never_become_a_cup_or_mug(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', [
    'Metal Gear Solid Canvas',
    'Wood Duck Canvas',
    'Glass Slipper Canvas',
])
def test_artwork_names_cannot_supply_canvas_material(description):
    actual = read_product_type(description)
    assert actual['product_type'] == 'Canvas'
    assert actual['product_material'] == 'Canvas'


def test_contiguous_material_canvas_remains_source_grounded():
    assert 'Metal' in read_product_type('Metal Canvas')['product_material'].split('; ')
    assert 'Wood' in read_product_type('Wood Canvas')['product_material'].split('; ')


def test_lenticular_artwork_frame_phrase_is_not_physical_frame():
    actual = read_product_type('3D lenticular portrait Popping Out of Frame')
    assert actual['product_type'] == 'Lenticular Art'
    assert actual['product_construction'] == ''
    assert read_product_type('Lenticular art in MDF frame')['product_type'] == 'Framed Lenticular Art'


def test_framing_in_artwork_caption_cannot_supply_canvas_construction():
    assert read_product_type('Canvas artwork framed portrait')['product_construction'] == ''
    assert read_product_type('Framed Canvas artwork portrait')['product_construction'] == 'Framed'


def test_artwork_after_size_cannot_supply_canvas_construction_or_treatment():
    actual = read_product_type('Canvas 16x20 artwork girl with glitter and die cut flower')
    assert actual['product_type'] == 'Canvas'
    assert actual['product_construction'] == ''
    assert actual['product_treatment'] == ''
    physical = read_product_type('Die-cut canvas with glitter 16x20 artwork girl')
    assert physical['product_construction'] == 'Die-Cut'
    assert physical['product_treatment'] == 'Glitter'


def test_nonwoven_cannot_be_woven_construction():
    assert 'Woven' not in read_product_type('Non-woven storage bin')['product_construction']


@pytest.mark.parametrize('description', [
    '3D lenticular landscape in 1 MDF frame',
    '3D lenticular portrait 13x19 308x458mm .59 frame width',
    'Frame 3D lenticular 16x16',
    '3D lenticular framed 20x27',
    '3D lenticular, 2 inch frame',
])
def test_bounded_explicit_lenticular_frame_metadata(description):
    actual = read_product_type(description)
    assert actual['product_type'] == 'Framed Lenticular Art'
    assert 'Framed' in actual['product_construction'].split('; ')


def test_lenticular_artwork_saying_out_of_frame_is_not_framed():
    assert read_product_type('3D lenticular picture Popping Out of Frame 20x20')['product_type'] == 'Lenticular Art'


@pytest.mark.parametrize('description', [
    'Framed Printed MDF',
    'Framed MDF with Printed Paper',
    'Framed MDF Printed Scalloped Paper Under Glass',
    'Framed Deckle Edge Metallic Paper',
    'Framed Holographic Printed Faux Leather',
    'Framed w Printed Metallic PU',
])
def test_explicit_framed_printed_assemblies(description):
    assert read_product_type(description)['product_type'] == 'Framed Print'


@pytest.mark.parametrize('description', [
    'Framed Frayed Linen Under Glass',
    'Framed Linen w Frayed Edges',
])
def test_explicit_framed_linen_assemblies(description):
    assert read_product_type(description)['product_type'] == 'Framed Fabric Art'


@pytest.mark.parametrize('description', [
    'Framed Glass',
    'Framed Hexagonal Painted Glass',
])
def test_explicit_framed_glass_assemblies(description):
    assert read_product_type(description)['product_type'] == 'Framed Glass Art'


def test_whole_underscore_clause_can_name_physical_lenticular_product():
    assert read_product_type('Sunset_Framed 3D Lenticular_28x20')['product_type'] == 'Framed Lenticular Art'


def test_whole_underscore_clause_can_name_glass_shadowbox():
    assert read_product_type('Game_Printed Glass Shadowbox_15x20')['product_type'] == 'Framed Glass Shadowbox'


def test_printed_glass_and_shadowbox_frame_bind_across_identity_and_size():
    actual = read_product_type('Printed Glass licensed collection 10x30 Shadowbox Frame')
    assert actual['product_type'] == 'Framed Glass Shadowbox'
    assert actual['product_material'] == 'Glass'
    assert read_product_type('Printed Glass Shadowbox, Printed Glass')['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', [
    'Assorted licensed storage samples',
    'Assorted wood samples',
    'Licensed 3D sample',
    '3D',
])
def test_product_like_samples_without_a_noun_are_unreadable(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', [
    'Extra cost for manual handling and packing', 'additional cost for sample invoice', 'Plate cost adjustment', 'Port chg adjustment',
    'AD REQUIREMENT for web banner', 'tbd', 'Pending.',
    'Operator created new record on reference date', 'testfoobar dsn',
])
def test_explicit_administrative_wording_is_placeholder(description):
    assert read_product_type(description)['product_type_status'] == 'placeholder'


@pytest.mark.parametrize('description', [
    'Mixed packaging case', 'Mixed licensed pack', 'Mixed SKU',
    'Filling component only required', 'zzzunknownzzz',
])
def test_unknown_pack_or_noise_is_unreadable_not_placeholder(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', [
    'Minimalist Print in MDF frame',
    'MDF High Gloss Print in Setback Frame',
    'Framed newspaper under glass',
    'Float frm embossd ppr prnt',
    'Floatingframe embsd paper prnt with foil',
])
def test_explicit_print_noun_outranks_earlier_frame(description):
    assert read_product_type(description)['product_type'] == 'Framed Print'


def test_frame_and_mdf_without_print_noun_stays_frame():
    assert read_product_type('Floating Frame MDF 16x16')['product_type'] == 'Frame'
    assert read_product_type('MDF Multiframe')['product_type'] == 'Frame'


def test_printed_linen_paper_in_setback_frame_is_framed_print():
    assert read_product_type('Setback Frame w Printed Linen Paper')['product_type'] == 'Framed Print'


def test_whole_underscore_physical_material_clause_is_source_grounded():
    actual = read_product_type('Functional Guitar Hook_LED and MDF 11.4x8')
    assert actual['product_type'] == 'Guitar Hook'
    assert actual['product_material'] == 'MDF'


def test_generic_storage_and_specific_bin_are_one_product_across_artwork_ampersand():
    assert read_product_type('Tapered storage comic b&w panel bin')['product_type'] == 'Storage Bin'
    assert read_product_type('Storage bin & hamper')['product_type_status'] == 'unreadable'
    assert read_product_type('Lift-off storage w glitter, box storage w foil')['product_type_status'] == 'unreadable'


def test_canvas_growth_needs_a_chart_noun():
    assert read_product_type('Canvas Growth')['product_type_status'] == 'unreadable'
    assert read_product_type('Canvas Growth Chart')['product_type'] == 'Growth Chart'


def test_shelf_and_storage_cube_are_distinct_physical_forms():
    assert read_product_type('Wall Shelf alongside Storage Cube and Hooks')['product_type_status'] == 'unreadable'
    assert read_product_type('Wall Shelf with Hooks')['product_type'] == 'Wall Shelf'
    assert read_product_type('Storage Cube with Hooks')['product_type'] == 'Storage Cube'


def test_explicit_suitcase_storage_is_a_suitcase_not_an_inferred_box():
    assert read_product_type('Suitcase Greyboard Storage')['product_type'] == 'Storage Suitcase'
    assert read_product_type('Greyboard Storage Box')['product_type'] != 'Storage Suitcase'


def test_plural_stationery_organizers_keep_the_explicit_function():
    assert read_product_type('Stationary Organizers')['product_type'] == 'Stationery Organizer'
    assert read_product_type('Assorted Organizers')['product_type'] == 'Organizer'


@pytest.mark.parametrize('description', [
    'High Gloss Small Art 11x14',
    'Double Layer Cut Paper Art',
    'Glitter UV Lacquer Art',
    'Molded Resin Art',
    'LED Infinity Wire Layered Dimensional Art',
])
def test_explicit_qualified_art_is_physical_art_without_guessed_form(description):
    assert read_product_type(description)['product_type'] == 'Art'


def test_explicit_framed_deckle_edge_art_keeps_framed_type():
    assert read_product_type('Framed Deckle Edge Art')['product_type'] == 'Framed Art'


def test_artwork_tail_does_not_create_a_second_art_product():
    assert read_product_type('Canvas 10x20 artwork landscape art scene')['product_type'] == 'Canvas'


@pytest.mark.parametrize(('description', 'expected'), [
    ('Molded Foam Art', 'Foam Art'),
    ('Molded Shadowbox Art', 'Framed Shadowbox'),
    ('Molded Frame Art', 'Framed Art'),
])
def test_named_molded_object_outranks_generic_art(description, expected):
    assert read_product_type(description)['product_type'] == expected


def test_molded_foam_art_and_canvas_are_two_products_in_either_order():
    assert read_product_type('Molded Foam Art and Canvas')['product_type_status'] == 'unreadable'
    assert read_product_type('Canvas and Molded Foam Art')['product_type_status'] == 'unreadable'
    assert read_product_type('Molded Foam Art')['product_type'] == 'Foam Art'


def test_molded_foam_in_canvas_artwork_does_not_supply_product_attributes():
    for description in ('Canvas with molded foam artwork', 'Canvas depicting molded foam art'):
        result = read_product_type(description)
        assert result['product_type'] == 'Canvas'
        assert result['product_material'] == 'Canvas'
        assert result['product_construction'] == ''


def test_shadowbox_bank_noun_outranks_shell_modifiers():
    for description in ('Shadowbox Bank', 'Molded Shadowbox Bank', 'Printed Glass Shadowbox Bank'):
        assert read_product_type(description)['product_type'] == 'Shadowbox Bank'


def test_stated_print_canvas_kit_and_die_cut_art_heads_survive_later_captions():
    assert read_product_type('MDF Spot Varnish Print artwork travel poster')['product_type'] == 'Print'
    assert read_product_type('Canvas Set with Paint Tubes Brushes Palette')['product_type'] == 'Paint-Your-Own Canvas Set'
    assert read_product_type('CYO Canvas Kit with Paint Pots')['product_type'] == 'Paint-Your-Own Canvas Set'
    assert read_product_type('CYO Canvas Kit with PNT Pots')['product_type'] == 'Paint-Your-Own Canvas Set'
    assert read_product_type('Double Layer Die Cut Geometric Paper Art')['product_type'] == 'Die-Cut Art'
    assert read_product_type('Double Layer Art')['product_type'] == 'Art'
    assert read_product_type('Canvas artwork paint tubes and brushes')['product_type'] == 'Canvas'


def test_recipe_box_clock_and_combined_board_keep_explicit_head_nouns():
    assert read_product_type('Wood Recipe Box')['product_type'] == 'Recipe Box'
    assert read_product_type('Recipe Grey Board Box with Cards')['product_type'] == 'Recipe Box'
    assert read_product_type('MDF Plaque Wall Clock')['product_type'] == 'Wall Clock'
    assert read_product_type('MDF Plaque and Wall Clock')['product_type_status'] == 'unreadable'
    assert read_product_type('Framed Dry Erase and Fabric Pinboard')['product_type'] == 'Dry-Erase and Pin Board'
    assert read_product_type('Fabric Pinboard')['product_type'] == 'Pinboard'


def test_explicit_led_light_banner_and_framed_print_assemblies():
    assert read_product_type('LED Lightbulb')['product_type'] == 'Light'
    assert read_product_type('LED Back Light')['product_type'] == 'Light'
    assert read_product_type('Lightbulb Frame')['product_type'] == 'Frame'
    assert read_product_type('Framed Banner undr Glass')['product_type'] == 'Banner'
    assert read_product_type('Framed MDF with Paper Print')['product_type'] == 'Framed Print'
    assert read_product_type('Framed MDF Arched Print')['product_type'] == 'Framed Print'
    assert read_product_type('Framed MDF with Paper Artwork')['product_type_status'] == 'unreadable'


def test_literal_small_product_nouns_and_abbreviations_outrank_broad_families():
    expected = {
        'Sequin Art': 'Sequin Art',
        'Rubbermat': 'Mat',
        'Chalkboard Plaque': 'Plaque',
        'MDF PLQUE': 'Plaque',
        'Tabletop Clock': 'Tabletop Clock',
        'Magnet Board': 'Magnet Board',
        'Felt Oval HMPR': 'Storage Hamper',
        'Wall Scroll': 'Wall Scroll',
        '6 SHLF HANGING CLST ORG': 'Hanging Closet Organizer',
        'Frame with Paper Print': 'Framed Print',
    }
    for description, product in expected.items():
        assert read_product_type(description)['product_type'] == product


def test_abbreviated_storage_material_without_hamper_noun_stays_unreadable():
    assert read_product_type('Felt Oval Storage')['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('other', ['Magnet Board', 'Wall Scroll', 'Sequin Art', 'Rubbermat',
                                   'Tabletop Clock', 'Felt Oval HMPR'])
def test_new_physical_nouns_do_not_swallow_a_separate_canvas(other):
    assert read_product_type(f'Canvas and {other}')['product_type_status'] == 'unreadable'


def test_repeated_canvas_kits_are_one_form_but_a_plain_canvas_is_distinct():
    assert read_product_type('Canvas set with paint pots and brush, DIY canvas with paint pots and brush')['product_type'] == 'Paint-Your-Own Canvas Set'
    assert read_product_type('Canvas set w 12 pnt pots and brsh, DIY canvas w 12 pnt pots and brsh')['product_type'] == 'Paint-Your-Own Canvas Set'
    assert read_product_type('DIY canvas w 8 paint pts, canvas set w 8 paint pts')['product_type'] == 'Paint-Your-Own Canvas Set'
    assert read_product_type('Canvas set with 12 paint finishes')['product_type'] == 'Canvas'
    assert read_product_type('Canvas set with paint pots and brush, plain canvas')['product_type_status'] == 'unreadable'


def test_source_named_collage_and_embossed_canvas_outrank_generic_frame_or_print():
    assert read_product_type('Paper Collage Framed')['product_type'] == 'Framed Collage'
    assert read_product_type('Floating Frame Embossed Print Canvas')['product_type'] == 'Framed Canvas'
    assert read_product_type('Framed Art artwork collage framed scene')['product_type'] == 'Framed Art'


def test_literal_tray_relief_wall_art_and_printed_glass_nouns():
    assert read_product_type('MDF Tray')['product_type'] == 'Tray'
    assert read_product_type('Polyresin Tray')['product_type'] == 'Tray'
    assert read_product_type('Wood Relief Wall Art')['product_type'] == 'Relief Wall Art'
    assert read_product_type('Print on Glass')['product_type'] == 'Glass Art'
    assert read_product_type('Printed Glass')['product_type'] == 'Glass Art'
    assert read_product_type('Canvas in Tray Box')['product_type'] == 'Canvas'


@pytest.mark.parametrize(('description', 'expected'), [
    ('Generic calandar', 'Calendar'),
    ('Generic multipack mugs', 'Mug'),
    ('DIY CNCRTE STPPNG STNE', 'Stepping Stone'),
    ('DIY CRMIC MIN PLNTR', 'Planter'),
    ('Generic slit slat art under glass', 'Slat Art'),
    ('Generic sequin flip art', 'Sequin Art'),
    ('Generic molded polyresin mask', 'Mask'),
    ('Generic outdoor garden bag', 'Garden Bag'),
    ('Generic photo string with holders', 'Photo Display String'),
    ('Generic wall basket', 'Wall Basket'),
    ('Generic faux boox storage', 'Faux Book'),
    ('DIY SET W 8 PAINT POTS AND BRSH', 'Painting Kit'),
    ('PE Rattan_Dimensional Bow_12x14', 'Decorative Bow'),
])
def test_source_neutral_explicit_product_aliases(description, expected):
    assert read_product_type(description)['product_type'] == expected


@pytest.mark.parametrize('description', [
    'Assorted rubber material', 'DIY concrete material', 'Ceramic mini material',
    'Polyresin material', 'Felt Oval Storage', 'Nonwoven hanging storage with pocket',
    'PE Rattan_Bow artwork', 'Faux wood storage', 'PAINT POTS AND BRSH',
    'Canvas and garden bag', 'Canvas and molded polyresin mask',
])
def test_aliases_do_not_turn_material_or_separate_products_into_one_form(description):
    assert read_product_type(description)['product_type_status'] == 'unreadable'


@pytest.mark.parametrize('description', [
    'Calendar-themed canvas', 'Canvas depicting mugs', 'Canvas depicting slit slat art',
    'Canvas depicting sequin flip art', 'Canvas depicting a wall basket',
    'Photo artwork on canvas',
])
def test_aliases_in_artwork_do_not_override_physical_canvas(description):
    assert read_product_type(description)['product_type'] == 'Canvas'


def test_canvas_with_color_blocks_or_bounded_typo_remains_one_canvas():
    assert read_product_type('Canvas with color blocks')['product_type'] == 'Canvas'
    assert read_product_type('Canva w foil')['product_type'] == 'Canvas'
    assert read_product_type('Canvas and decorative blocks')['product_type_status'] == 'unreadable'


def test_explicit_frame_assembly_preserves_its_named_product_head():
    wall_art = read_product_type('Wood Frame Wall Art')
    assert wall_art['product_type'] == 'Wall Art'
    assert wall_art['product_construction'] == 'Framed'
    assert read_product_type('Framed Foil Art Under Glass')['product_type'] == 'Framed Art'
    assert read_product_type('Canvas in Ornate Frame')['product_type'] == 'Framed Canvas'
    assert read_product_type('Canvas Scenic Collage in Ornate Frame')['product_type'] == 'Framed Canvas'
    assert read_product_type('Floating Blue 12 Frame Canvas')['product_type'] == 'Framed Canvas'
    assert read_product_type('Unframed Wall Art')['product_construction'] == ''


def test_explicit_shape_art_object_and_suitcase_heads_are_readable():
    assert read_product_type('MDF Shape')['product_type'] == 'Shape'
    assert read_product_type('LED Acrylic Tabletop Art')['product_type'] == 'Tabletop Art'
    assert read_product_type('Dimensional Wood Object')['product_type'] == 'Decorative Object'
    assert read_product_type('Suitcase MDF Storage')['product_type'] == 'Storage Suitcase'
    assert read_product_type('Shelf w Hooks')['product_type'] == 'Shelf with Hooks'
    assert read_product_type('Canvas depicting an MDF shape')['product_type'] == 'Canvas'
    assert read_product_type('Canvas, group art on floral shape')['product_type'] == 'Canvas'
    assert read_product_type('Canvas and Shelf w Hooks')['product_type_status'] == 'unreadable'
    assert read_product_type('MDF shapes and suitcase')['product_type_status'] == 'unreadable'


@pytest.mark.parametrize(('description', 'expected'), [
    ('Framed Puzzle Art', 'Framed Puzzle Art'),
    ('Infinity LED Art in Frame', 'LED Infinity Art'),
    ('MDF Countdown Clock', 'Countdown Clock'),
    ('Tall Wooden MDF Sign', 'Tall Sign'),
    ('Perpetual Calendar with Metal Pencil Cup', 'Perpetual Calendar with Pencil Cup'),
    ('Framed Deckled Edge Art', 'Framed Art'),
])
def test_specific_stated_product_heads_beat_broad_nouns(description, expected):
    assert read_product_type(description)['product_type'] == expected


def test_specific_art_names_in_canvas_artwork_do_not_retype_the_canvas():
    assert read_product_type('Canvas artwork framed puzzle art')['product_type'] == 'Canvas'
    assert read_product_type('Canvas artwork infinity LED art')['product_type'] == 'Canvas'


@pytest.mark.parametrize(('description', 'product', 'material'), [
    ('Canvas with tabletop art graphic', 'Canvas', 'Canvas'),
    ('Canvas with dimensional bow object graphic', 'Canvas', 'Canvas'),
    ('Canvas with MDF shapes artwork', 'Canvas', 'Canvas'),
    ('Canvas with suitcase greyboard storage artwork', 'Canvas', 'Canvas'),
    ('Canvas with frame wall art graphic', 'Canvas', 'Canvas'),
    ('Canvas with sequin flip art artwork', 'Canvas', 'Canvas'),
    ('Canvas with framed foil art under glass graphic', 'Canvas', 'Canvas'),
    ('Paper print with sequin flip art graphic', 'Print', 'Paper'),
])
def test_depicted_product_words_do_not_supply_type_or_attributes(description, product, material):
    actual = read_product_type(description)
    assert actual['product_type'] == product
    assert actual['product_material'] == material
    assert actual['product_construction'] == ''
    assert actual['product_treatment'] == ''


def test_abbreviated_physical_art_and_box_nouns_do_not_need_artwork_identity():
    assert read_product_type('Printed EVA Wall Deco')['product_type'] == 'Wall Art'
    framed = read_product_type('STBCK FRMD MNTD ART W PU')
    assert framed['product_type'] == 'Framed Art'
    assert framed['product_construction'] == 'Framed; Setback'
    assert read_product_type('Canvas artwork STBCK FRMD MNTD ART')['product_type'] == 'Canvas'
    box = read_product_type('Greyboard Lift-Off Lid BX')
    assert box['product_type'] == 'Storage Box'
    assert box['product_material'] == 'Greyboard'


def test_glass_frame_and_shadowbox_compounds_keep_explicit_object_head():
    framed = read_product_type('Etched Glass in LED Frame')
    assert framed['product_type'] == 'Framed Glass Art'
    assert framed['product_material'] == 'Glass'
    assert read_product_type('Print Glass Shadowbox')['product_type'] == 'Glass Shadowbox'
    shadowbox = read_product_type('Paper Shadowbox under Glass')
    assert shadowbox['product_type'] == 'Glass Shadowbox'
    assert shadowbox['product_material'] == 'Glass; Paper'
    assert read_product_type('Canvas artwork etched glass in LED frame')['product_type'] == 'Canvas'


def test_specific_box_calendar_frame_and_light_nouns_stay_physical():
    expected = {
        'Wood Jewelry Boxes': 'Jewelry Box',
        'MDF Block CNTDWN CALNDR': 'Countdown Calendar',
        'Advent Calendar': 'Advent Calendar',
        'MDF Phot Frame': 'Photo Frame',
        'Neon LED Light with Cable': 'Neon LED Light',
    }
    for description, product_type in expected.items():
        assert read_product_type(description)['product_type'] == product_type
    assert read_product_type('Canvas with jewelry box artwork')['product_type'] == 'Canvas'
    assert read_product_type('Canvas depicting Advent calendar')['product_type'] == 'Canvas'
    assert read_product_type('Canvas and Jewelry Box')['product_type_status'] == 'unreadable'


def test_dimensional_bow_names_a_bow_only_in_physical_clause():
    for description in ('PE Rattan_Dimensional Bow_12x14', 'Natural Rattan_Dimensional Bow_12x14',
                        'Sample Rattan_Dimensional Bow_12x14'):
        actual = read_product_type(description)
        assert actual['product_type'] == 'Decorative Bow'
        assert actual['product_construction'] == 'Dimensional'
    assert read_product_type('PE Rattan_Bow artwork')['product_type_status'] == 'unreadable'
    assert read_product_type('Canvas with dimensional bow graphic')['product_type'] == 'Canvas'


def test_mirror_effect_is_an_appearance_not_a_second_mirror():
    assert read_product_type('Canvas with mirror effect')['product_type'] == 'Canvas'
    assert read_product_type('Canvas and Mirror')['product_type_status'] == 'unreadable'
    assert read_product_type('Framed Mirror')['product_type'] == 'Framed Mirror'


def test_dry_erase_canvas_is_the_stated_material_of_an_easel():
    actual = read_product_type('Dry Erase Canvas Folding Easel')
    assert actual['product_type'] == 'Easel'
    assert actual['product_material'] == 'Canvas'
    assert read_product_type('Canvas depicting an easel')['product_type'] == 'Canvas'
    assert read_product_type('Canvas and Easel')['product_type_status'] == 'unreadable'


def test_functional_chalkboard_on_box_is_a_subtype_not_an_artwork_caption():
    assert read_product_type('MDF Box_With functional chalkboard_10x12')['product_type'] == 'Chalkboard Box'
    assert read_product_type('MDF Box with chalkboard artwork')['product_type'] == 'MDF Box'
    assert read_product_type('Canvas with functional chalkboard graphic')['product_type'] == 'Canvas'


def test_handpainted_canvas_is_the_content_of_framed_art_assembly():
    actual = read_product_type('Framed Art with Handpainted Canvas')
    assert actual['product_type'] == 'Framed Canvas'
    assert actual['product_material'] == 'Canvas'
    assert read_product_type('Framed Art with handpainted canvas artwork')['product_type'] == 'Framed Art'
    assert read_product_type('Canvas depicting framed art')['product_type'] == 'Canvas'


def test_photo_frame_head_survives_wall_art_descriptor():
    actual = read_product_type('MDF Frame Wall Photo Frame Wall Art')
    assert actual['product_type'] == 'Photo Frame'
    assert actual['product_construction'] == ''
    assert actual['product_material'] == 'MDF'


def test_whole_shadowbox_frame_specification_after_artwork_names_its_object():
    actual = read_product_type('Printed Glass with Motif_Illustration_12x14_Shadowbox Oval MDF Frame')
    assert actual['product_type'] == 'Framed Glass Shadowbox'
    assert actual['product_construction'] == 'Framed'
    assert actual['product_material'] == 'Glass'
    assert read_product_type('Printed Glass_Illustration_Shadowbox artwork frame')['product_type'] == 'Glass Art'


def test_wall_art_placement_is_preserved_when_illumination_is_named():
    assert read_product_type('LED Infinity Wall Art')['product_type'] == 'Wall Art'
    assert read_product_type('Canvas artwork LED Infinity Wall Art')['product_type'] == 'Canvas'


def test_printed_glass_poster_inside_a_frame_is_decorated_glass():
    actual = read_product_type('Printed Glass Illustrated Poster in Frame')
    assert actual['product_type'] == 'Framed Glass Art'
    assert actual['product_construction'] == 'Framed'
    assert actual['product_material'] == 'Glass'
    assert read_product_type('Printed Glass Artwork Poster in Frame')['product_type'] != 'Framed Glass Art'


def test_mail_organizer_noun_is_more_specific_than_stationery_use():
    actual = read_product_type('MDF Mail Organizer with Hooks')
    assert actual['product_type'] == 'Mail Organizer'
    assert actual['product_material'] == 'MDF'
    assert read_product_type('Canvas with mail organizer artwork')['product_type'] == 'Canvas'


def test_framed_print_with_shadowbox_enclosure_keeps_print_head():
    actual = read_product_type('Framed Print Glass Shadow Box')
    assert actual['product_type'] == 'Framed Print'
    assert actual['product_construction'] == 'Framed'
    assert actual['product_material'] == 'Glass'
    assert read_product_type('Framed Print and Glass Shadow Box')['product_type_status'] == 'unreadable'


def test_explicit_canvas_eva_bin_refines_material_to_named_container():
    actual = read_product_type('Canvas w EVA Bin with handle')
    assert actual['product_type'] == 'Storage Bin'
    assert actual['product_material'] == 'Canvas; EVA'
    assert read_product_type('Canvas and EVA Bin')['product_type_status'] == 'unreadable'
    assert read_product_type('Canvas w EVA Bin floral pattern')['product_type'] == 'Storage Bin'
    assert read_product_type('Canvas with EVA Bin graphic')['product_type_status'] == 'unreadable'
    assert read_product_type('Canvas with graphic of an EVA Bin')['product_type'] == 'Canvas'


def test_literal_bunting_is_not_retyped_by_later_wall_art_words():
    assert read_product_type('Felted Bunting with Wall Art Graphic')['product_type'] == 'Bunting'
    assert read_product_type('Canvas with bunting graphic')['product_type'] == 'Canvas'


def test_source_spelled_canvas_tapestry_with_wood_bar_is_one_object():
    actual = read_product_type('Canvas Tapsetry with Wood Bar')
    assert actual['product_type'] == 'Canvas Tapestry'
    assert actual['product_material'] == 'Canvas; Wood'
    assert read_product_type('Canvas with tapsetry artwork')['product_type'] == 'Canvas'


def test_canvas_frame_is_a_named_frame_without_invented_material():
    actual = read_product_type('Canvas Frame')
    assert actual['product_type'] == 'Canvas Frame'
    assert actual['product_material'] == ''
    assert actual['product_construction'] == ''
    assert read_product_type('Canvas with frame artwork')['product_type'] == 'Canvas'


def test_literal_framed_three_dimensional_wall_art_keeps_both_constructions():
    actual = read_product_type('Framed 3-D Wall Art')
    assert actual['product_type'] == 'Framed Art'
    assert actual['product_construction'] == '3D; Framed'
    assert read_product_type('Canvas with framed 3-D wall art graphic')['product_type'] == 'Canvas'


def test_sign_head_survives_wool_hanging_wall_art_qualifiers():
    actual = read_product_type('Sign Wool Fabric Embroidered Hanging Wall Art')
    assert actual['product_type'] == 'Sign'
    assert actual['product_construction'] == 'Hanging'
    assert actual['product_material'] == 'Wool'
    assert actual['product_treatment'] == 'Embroidery'
    assert read_product_type('Canvas with sign wall art graphic')['product_type'] == 'Canvas'


def test_baby_frame_does_not_invent_a_photo_function():
    assert read_product_type('Assorted Baby Frames')['product_type'] == 'Frame'
    assert read_product_type('Assorted Baby Photo Frames')['product_type'] == 'Photo Frame'


def test_toy_bin_is_a_bin_and_toy_chest_is_a_chest():
    assert read_product_type('Fabric Toy Bin')['product_type'] == 'Storage Bin'
    assert read_product_type('Fabric Toy Chest')['product_type'] == 'Storage Toy Chest'
    assert read_product_type('Toy Bin and Toy Chest')['product_type_status'] == 'unreadable'


def test_misspelled_shadowbox_does_not_invent_a_frame():
    assert read_product_type('SHAWOWBOX')['product_type'] == 'Shadowbox'
    assert read_product_type('Framed SHAWOWBOX')['product_type'] == 'Framed Shadowbox'


def test_explicit_tabletop_mdf_block_keeps_placement():
    actual = read_product_type('MDF Tabletop Bobble Head Block')
    assert actual['product_type'] == 'Tabletop Block'
    assert actual['product_material'] == 'MDF'
    assert read_product_type('MDF Block depicting tabletop scene')['product_type'] == 'Block'


def test_abbreviated_trinket_tray_keeps_its_explicit_kit_and_material():
    actual = read_product_type('DIY CRMIC TRNKT TRAY with Paint Pots')
    assert actual['product_type'] == 'Trinket Tray'
    assert actual['product_construction'] == 'DIY'
    assert actual['product_material'] == 'Ceramic'
    assert read_product_type('Canvas depicting a trinket tray')['product_type'] == 'Canvas'


def test_canvas_and_sign_without_a_physical_relation_abstains():
    assert read_product_type('Canvas Blue Destination Sign')['product_type_status'] == 'unreadable'
    assert read_product_type('Canvas with destination sign artwork')['product_type'] == 'Canvas'
    assert read_product_type('Canvas and Sign')['product_type_status'] == 'unreadable'


def test_action_object_hook_does_not_become_canvas_hardware():
    assert read_product_type('Canvas figure shooting a hook')['product_type'] == 'Canvas'
    assert read_product_type('Canvas with hooks')['product_type'] == 'Canvas'
    assert read_product_type('Canvas and Hook')['product_type_status'] == 'unreadable'


def test_spinner_alone_does_not_name_a_display_rack():
    assert read_product_type('Canvas with spinner caption')['product_type'] == 'Canvas'
    assert read_product_type('Spinner')['product_type_status'] == 'unreadable'
    assert read_product_type('Desktop Display Rack')['product_type'] == 'Display Rack'


def test_hanging_closet_storage_has_an_organizer_head_not_a_shelf_head():
    assert read_product_type('Fabric Storage 6 Shelf Hanging Closet')['product_type'] == 'Storage Organizer'
    assert read_product_type('Fabric Storage 3 Shelf Hanging Closet Org with Hamper')['product_type'] == 'Hanging Closet Organizer'
    assert read_product_type('Fabric Storage Shelf')['product_type'] != 'Storage Organizer'


def test_faux_book_organizer_preserves_form_and_faux_book_construction():
    actual = read_product_type('MDF Faux Book Organizer with Foil')
    assert actual['product_type'] == 'Organizer'
    assert actual['product_construction'] == 'Faux Book'
    assert actual['product_material'] == 'MDF'
    assert actual['product_treatment'] == 'Foil'
    assert read_product_type('MDF Faux Book')['product_type'] == 'Faux Book'


def test_misspelled_storage_chest_outweighs_printed_artwork():
    actual = read_product_type('Flat Top Greyboard STRAGE CHEST with Floral Print')
    assert actual['product_type'] == 'Storage Chest'
    assert actual['product_construction'] == 'Flat-Top'
    assert actual['product_material'] == 'Greyboard'


def test_box_with_elastics_and_hooks_is_one_box_with_attached_hardware():
    assert read_product_type('MDF box art with elastics and hooks 12x16')['product_type'] == 'MDF Box'
    assert read_product_type('MDF box art and hooks 12x16')['product_type_status'] == 'unreadable'
    assert read_product_type('MDF box art with elastics and hook plaque 12x16')['product_type_status'] == 'unreadable'


def test_magnetic_dry_erase_corkboard_with_pins_is_one_combined_board():
    actual = read_product_type('Die-cut corkboard with magnetic dry-erase and push pins 12x16')
    assert actual['product_type'] == 'Corkboard with Dry-Erase Board'
    assert actual['product_material'] == 'Cork'
    assert actual['product_treatment'] == 'Dry-Erase'
    assert read_product_type('Corkboard with magnetic pins 12x16')['product_type'] == 'Corkboard'
    assert read_product_type('Canvas depicting a corkboard with magnetic dry-erase and pins graphic')['product_type'] == 'Canvas'


def test_canvasboard_is_a_canvas_panel_even_when_a_painting_set_is_named():
    actual = read_product_type('Canvasboard 8x10 floral painting set')
    assert actual['product_type'] == 'Canvas'
    assert actual['product_construction'] == 'Panel; Set'
    assert actual['product_material'] == 'Canvas'
    assert read_product_type('Canvasboard artwork depicting painting set')['product_type'] == 'Canvas'
    assert read_product_type('Canvasboard and MDF Box')['product_type_status'] == 'unreadable'
    assert read_product_type('DIY Canvas with paint pots and brush')['product_type'] == 'Paint-Your-Own Canvas Set'


def test_faux_book_storage_is_a_faux_book_and_only_a_stated_set_is_a_set():
    single = read_product_type('Studio Alpha faux book storage')
    assert (single['product_type'], single['product_construction']) == ('Faux Book', '')
    stated = read_product_type('Studio Alpha 2-piece faux book storage set')
    assert (stated['product_type'], stated['product_construction']) == ('Faux Book', 'Set')


@pytest.mark.parametrize("description", ["Storage Hamper", "Studio Alpha storage hampers"])
def test_storage_hamper_singular_and_plural(description):
    actual = read_product_type(description)
    assert actual['product_type_status'] == 'accepted'
    assert actual['product_type'] == 'Storage Hamper'


@pytest.mark.parametrize("description,product,material,treatment", [
    ("Plastic tray with wooden bowl artwork", "Tray", "Plastic", ""),
    ("Canvas with small wooden bird artwork", "Canvas", "Canvas", ""),
    ("Canvas with glitter blue bird artwork", "Canvas", "Canvas", ""),
    ("Canvas with glitter bird artwork and foil finish", "Canvas", "Canvas", "Foil"),
])
def test_words_describing_pictured_artwork_are_not_product_attributes(description, product, material, treatment):
    actual = read_product_type(description)
    assert actual['product_type'] == product
    assert actual['product_material'] == material
    assert actual['product_treatment'] == treatment


def test_broad_noun_prefix_keeps_caption_out_of_type():
    # Invented phrases: a broad-noun product captioned with another product's name.
    assert read_product_type("Wall art with mug graphic")["product_type"] == "Wall Art"
    assert read_product_type("Wall art with plush bunny graphic")["product_type"] == "Wall Art"
    assert read_product_type("Sign with zorblax mug artwork")["product_type"] == "Sign"


def test_inline_caption_does_not_supply_construction():
    # Invented phrases: construction words inside a caption are not physical facts.
    for description, product in (("Wall art with raised zorblax artwork", "Wall Art"),
                                 ("Wall sign, graphic of raised zorblax", "Wall Sign")):
        result = read_product_type(description)
        assert result["product_type"] == product
        assert "raised" not in (result["product_construction"] or "").lower()
