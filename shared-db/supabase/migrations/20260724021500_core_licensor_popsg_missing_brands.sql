-- Add licensors present in the PopSG style-guide library but absent from the
-- DesignFlow PLM / ColdLion feed.
--
-- Context: PopSG resolves style_guide_files.licensor_name (a generated column,
-- split_part(relative_path,'/',1)) against core.licensor by name + merch-group
-- code. After switching to core and adding curated aliases, 801 of 216,472
-- active files still had no licensor. 698 of those are these six real brands,
-- which simply never arrive from PLM/ColdLion.
--
--   Miller Coors 283 · Anheuser Busch 187 · NASA 153 · NFL 32 · Ford 22 · NCAA 21
--
-- The remaining 103 are intentionally NOT licensors and are excluded here:
--   Spirit Halloween (98) is a CUSTOMER, CAA (4) is a talent agency whose files
--   are actually Ford's (CAA/Ford/*), and seafile-ignore.txt (1) is another
--   application's canary file, now filtered at crawl time.
--
-- Upstream source, verified live 2026-07-23 (do not assume ColdLion here):
--   core.customer  -> coldlion (830 rows)   ] already cut over to direct ColdLion
--   core.factory   -> coldlion (104 rows)   ]
--   core.licensor  -> designflow_plm (20/20)  ] NOT cut over; still DesignFlow PLM
--   core.property  -> designflow_plm (256/256)]
-- core.taxonomy_source_ref is 505/505 designflow_plm, and there is no
-- plm.erp_licensor / plm.erp_property mirror — only plm.licensor_import (37) and
-- plm.property_import (468), last imported 2026-07-08. The taxonomy stays on
-- DesignFlow because ColdLion exposes no licensor->property parent relationship
-- and no active/inactive flag; DesignFlow supplies parent_id, which is what makes
-- core.property.licensor_id trustworthy.
--
-- Code choice: core.licensor has UNIQUE NULLS NOT DISTINCT (code), so every row
-- needs a distinct non-null code. Merch-group codes are short (AA, WB, 1P), so
-- these use an "X-" namespaced placeholder that a real merch-group code can never
-- collide with. The importer matches by code first and then by lower(name);
-- because these codes cannot match, a future upstream record for the same brand
-- (whether it arrives via DesignFlow today or ColdLion after a taxonomy cutover,
-- e.g. once a license is signed) will match by NAME and update the row in place,
-- adopting the real merch-group code. Durable now, self-correcting later.
--
-- NOTE on NASA: shared-db docs flag NASA as a LAPSED license that a naive direct
-- ColdLion pull would wrongly resurrect. It is included here by explicit owner
-- request and is tagged 'manual_popsg_backfill' in metadata so it stays
-- distinguishable from feed-sourced rows.
--
-- Idempotent: skips any brand whose name already exists (case-insensitive).

insert into core.licensor (name, code, status, metadata)
select
  v.name,
  v.code,
  'active'::app.entity_status,
  jsonb_build_object(
    'source', 'manual_popsg_backfill',
    'reason', 'present in PopSG style-guide library, absent from PLM/ColdLion feed',
    'added_migration', '20260724021500'
  )
from (values
  ('Miller Coors',   'X-MILLERCOORS'),
  ('Anheuser Busch', 'X-ANHEUSERBUSCH'),
  ('NASA',           'X-NASA'),
  ('NFL',            'X-NFL'),
  ('Ford',           'X-FORD'),
  ('NCAA',           'X-NCAA')
) as v(name, code)
where not exists (
  select 1 from core.licensor l where lower(l.name) = lower(v.name)
)
and not exists (
  select 1 from core.licensor l where l.code = v.code
);

-- Preview briefly recorded this change under a colliding migration version.
-- Keep the durable audit metadata aligned with this migration when replaying
-- against rows created by that earlier preview-only run.
update core.licensor
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'source', 'manual_popsg_backfill',
  'reason', 'present in PopSG style-guide library, absent from PLM/ColdLion feed',
  'added_migration', '20260724021500'
)
where code in (
  'X-MILLERCOORS',
  'X-ANHEUSERBUSCH',
  'X-NASA',
  'X-NFL',
  'X-FORD',
  'X-NCAA'
)
and metadata ->> 'added_migration' is distinct from '20260724021500';
