export const CONTENT_TYPE_OPTIONS = [
  "source_art",
  "style_guide_art",
  "pattern_allover",
  "icon_badge",
  "product_photo",
  "lifestyle_photo",
  "render_mockup",
  "tech_pack",
  "licensing_sheet",
  "spec_layout_doc",
  "packaging_art",
  "sticker",
  "jcard",
  "other",
] as const;

export const CONTENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  CONTENT_TYPE_OPTIONS.map((value) => [
    value,
    value.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
  ]),
);

