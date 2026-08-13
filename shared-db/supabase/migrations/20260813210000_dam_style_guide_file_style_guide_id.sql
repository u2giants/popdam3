-- Add the optional canonical style-guide link requested by issue #812.
-- Existing PopDAM rows remain valid because the new column is nullable.

alter table dam.style_guide_file
  add column style_guide_id uuid null
  references core.style_guide(id) on delete set null;

create index idx_style_guide_file_style_guide_id
  on dam.style_guide_file (style_guide_id)
  where style_guide_id is not null;

comment on column dam.style_guide_file.style_guide_id is
  'Optional link from an app-owned style-guide file to its reviewed canonical core.style_guide record. NULL means no canonical link has been approved.';
