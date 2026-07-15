-- File-level classification: what each individual DAM asset is.

alter table public.assets
  add column content_type text;

alter table public.assets
  add constraint assets_content_type_check
  check (content_type in (
    'source_art',
    'style_guide_art',
    'pattern_allover',
    'icon_badge',
    'product_photo',
    'lifestyle_photo',
    'render_mockup',
    'tech_pack',
    'licensing_sheet',
    'spec_layout_doc',
    'packaging_art',
    'sticker',
    'jcard',
    'other'
  ));

comment on column public.assets.content_type is
  'Controlled file-level classification assigned by image tagging; distinct from product-level item_description.';

