-- shared-db#4350 (claim #4355) — Stage Catalog for DesignFlow Production Tracking
-- (popcre/designflow-tracking#125, Phase 1 of plan_stage-catalog-editable.md §8).
-- Business authority: docs/business-rules/production-milestones-and-dates.md
-- (Stage lists and who maintains them; Stages run concurrently; Conditional stages).
--
-- Six new plm tables, one trigger function, and a structural seed:
-- 5 lists, 24 stages, 637 durations, 32 Linesheet option rows (16 enabled), 0 dependencies.
-- Access: server services only. Like every plm table created since
-- 20260710135975, service_role (BYPASSRLS) receives the schema's default table grants plus EXECUTE on the trigger function; the
-- owner (postgres, used by designflow-tracking today) keeps full access. anon and
-- authenticated get no privilege, and RLS is enabled with no policies so a browser
-- role can never read or write it even if a grant were added later.
-- Purely additive: no existing object is altered, no foreign key to an existing table.
-- Supabase applies the file in one transaction, so the closing count assertion rolls
-- the whole migration back if the seed is wrong.
-- Rollback: drop table plm.prod_stage_progress, plm.licensor_stage_option,
-- plm.stage_dependency, plm.stage_duration, plm.stage, plm.stage_list (this also
-- drops their triggers), then drop function plm.stage_catalog_bump_version().
--
-- Seed provenance (designflow-tracking docs/stage-catalog-seed/ on sandbox-albert):
-- the sheet "Order Timeline Calculator", canonical product-type names already applied.
-- Licensing Submission / Re-Submission / PPS Approval use the live production
-- plm."LicensingTime" values read 2026-10-15 where the licensor exists there
-- ("live rows win", plan Phase 1 step 4); the differences are listed in the PR.
-- Maintainers are dflow.users ids read 2026-10-15: Marcel 18, Yuchen 36, Ilona 41.

create table plm.stage_list (
  id integer generated always as identity primary key,
  key text not null unique,
  name text not null,
  duration_unit text not null check (duration_unit in ('minutes', 'days')),
  maintainers integer[] not null default '{}'::integer[],
  position integer not null unique,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plm.stage (
  id integer generated always as identity primary key,
  list_id integer not null references plm.stage_list (id) on delete cascade,
  position integer not null,
  name text not null,
  pending_label text not null,
  default_duration numeric null check (default_duration is null or default_duration >= 0),
  duration_varies_by text null check (duration_varies_by in ('product_type', 'licensor')),
  counts_toward_total boolean not null default true,
  applies_to text not null default 'all'
    check (applies_to in ('all', 'licensed', 'non_licensed', 'on_resubmit', 'licensor_specific')),
  done_signal text null,
  shown_on_tracker boolean not null default false,
  active boolean not null default true,
  updated_by integer null,
  updated_at timestamptz not null default now(),
  constraint stage_list_id_position_key unique (list_id, position) deferrable initially immediate,
  constraint stage_list_id_name_key unique (list_id, name)
);

create table plm.stage_duration (
  id bigint generated always as identity primary key,
  stage_id integer not null references plm.stage (id) on delete cascade,
  scope_kind text not null check (scope_kind in ('product_type', 'licensor')),
  scope_value text not null,
  duration numeric null check (duration is null or duration >= 0),
  constraint stage_duration_scope_key unique (stage_id, scope_kind, scope_value)
);

create table plm.stage_dependency (
  stage_id integer not null references plm.stage (id) on delete cascade,
  depends_on_stage_id integer not null references plm.stage (id) on delete cascade,
  kind text not null check (kind in ('hard', 'soft')),
  allowed_early_days numeric null check (allowed_early_days is null or allowed_early_days >= 0),
  primary key (stage_id, depends_on_stage_id),
  constraint stage_dependency_no_self check (stage_id <> depends_on_stage_id)
);

create table plm.licensor_stage_option (
  licensor_name text not null,
  stage_id integer not null references plm.stage (id) on delete cascade,
  enabled boolean not null default false,
  primary key (licensor_name, stage_id)
);

create table plm.prod_stage_progress (
  id bigint generated always as identity primary key,
  prod_order_header_id integer not null,
  sku text null check (sku is null or sku <> ''),
  stage_id integer not null references plm.stage (id) on delete restrict,
  done_at date null,
  failed boolean not null default false,
  failed_reason text null,
  updated_by integer null,
  updated_at timestamptz not null default now()
);

create unique index prod_stage_progress_order_sku_stage_key
  on plm.prod_stage_progress (prod_order_header_id, coalesce(sku, ''), stage_id);
create index stage_dependency_depends_on_idx on plm.stage_dependency (depends_on_stage_id);
create index licensor_stage_option_stage_id_idx on plm.licensor_stage_option (stage_id);
create index prod_stage_progress_stage_id_idx on plm.prod_stage_progress (stage_id);

alter table plm.stage_list enable row level security;
alter table plm.stage enable row level security;
alter table plm.stage_duration enable row level security;
alter table plm.stage_dependency enable row level security;
alter table plm.licensor_stage_option enable row level security;
alter table plm.prod_stage_progress enable row level security;

revoke all on plm.stage_list, plm.stage, plm.stage_duration, plm.stage_dependency,
  plm.licensor_stage_option, plm.prod_stage_progress from anon, authenticated;

comment on table plm.stage_list is 'Stage Catalog list (Design, Licensing, Sampling, Production, Shipping). Admin creates/deletes; maintainers (dflow.users ids) and admins edit. version bumps on any change to the list or its stages, durations, dependencies or licensor options. shared-db#4350.';
comment on column plm.stage_list.maintainers is 'dflow.users.id values allowed to edit this list (admins always can).';
comment on column plm.stage_list.version is 'Optimistic-concurrency version; bumped by plm.stage_catalog_bump_version().';
comment on table plm.stage is 'One step of a stage list. No waits between stages: a needed date = next stage needed date minus this stage duration. When duration_varies_by is set, durations come from plm.stage_duration; a scope with no row shows missing time (seeded so for Re-design and Re-sampling, and for all five licensing stages of Steal a Brain Rot and Aardman Animations, which have no licensing times yet). updated_by is a dflow.users.id; updated_at and updated_by are set by the designflow-tracking API on every edit.';
comment on column plm.stage.name is 'Shown in Last Completed.';
comment on column plm.stage.pending_label is 'Noun shown in Waiting On.';
comment on column plm.stage.default_duration is 'Duration in the list unit when it does not vary; NULL = not set yet (shown as missing time, never 0).';
comment on column plm.stage.applies_to is 'all | licensed | non_licensed | on_resubmit (only while a licensor Resubmit is active at concept or PPS) | licensor_specific (only when plm.licensor_stage_option is enabled for the order licensor).';
comment on column plm.stage.done_signal is 'Existing order field that marks the step done, from the code allow-list; NULL = user-added step ticked through plm.prod_stage_progress.';
comment on column plm.stage.shown_on_tracker is 'Stage counted on Production Tracking; percent complete = done / shown stages that apply.';
comment on column plm.stage.counts_toward_total is 'Included in timeline totals. Seeded false for Linesheet, on_resubmit and zero-time steps (including Factory Prep).';
comment on column plm.stage.updated_by is 'dflow.users.id of the last editor.';
comment on table plm.stage_duration is 'Per product type or per licensor duration of a stage, in the list unit; NULL duration = not set yet.';
comment on table plm.stage_dependency is 'Stage A depends on stage B: hard = cannot start until B is done; soft = may start early by allowed_early_days. Filled by maintainers; seeded empty. Cycles rejected by the API.';
comment on table plm.licensor_stage_option is 'Turns licensor_specific stages (Linesheet) on per licensor.';
comment on table plm.prod_stage_progress is 'Done/failed ticks for user-added stages (done_signal NULL) per production order and optional SKU (NULL = PO level). prod_order_header_id = plm."ProdOrderHeader".id; no foreign key because that table is sync-owned. updated_by is a dflow.users.id; updated_at and updated_by are set by the designflow-tracking API on every write, including upserts.';
comment on column plm.prod_stage_progress.sku is 'plm."ProdOrderDetail"."itemNo"; NULL = the whole PO (empty string refused). Uniqueness is the expression index prod_stage_progress_order_sku_stage_key on (prod_order_header_id, coalesce(sku, ''''), stage_id): upserts use ON CONFLICT (prod_order_header_id, coalesce(sku, ''''), stage_id).';

insert into plm.stage_list (key, name, duration_unit, maintainers, position) values
  ('design', 'Design Stages', 'minutes', '{18}'::integer[], 1),
  ('licensing', 'Licensing Stages', 'days', '{41}'::integer[], 2),
  ('sampling', 'Sampling Stages', 'days', '{36,41}'::integer[], 3),
  ('production', 'Production Stages', 'days', '{36}'::integer[], 4),
  ('shipping', 'Shipping Stages', 'days', '{36}'::integer[], 5);

insert into plm.stage (list_id, position, name, pending_label, default_duration, duration_varies_by, counts_toward_total, applies_to, done_signal, shown_on_tracker)
select l.id, v.position, v.name, v.pending_label, v.default_duration, v.duration_varies_by, v.counts_toward_total, v.applies_to, v.done_signal, v.shown_on_tracker
from (values
  ('design', 1, 'Brief', 'Brief', null::numeric, 'product_type', true, 'all', null, false),
  ('design', 2, 'Design', 'Design', null::numeric, 'product_type', true, 'all', null, false),
  ('design', 3, 'Tech Packing', 'Tech Packing', null::numeric, 'product_type', true, 'all', null, false),
  ('design', 4, 'Revisions', 'Revisions', null::numeric, 'product_type', true, 'all', null, false),
  ('design', 5, 'Re-design', 'Re-design', null::numeric, 'product_type', false, 'on_resubmit', null, false),
  ('design', 6, 'Files for Factory', 'Files for Factory', null::numeric, 'product_type', true, 'all', null, false),
  ('licensing', 1, 'Linesheet Submission', 'Linesheet Submission', null::numeric, 'licensor', false, 'licensor_specific', null, false),
  ('licensing', 2, 'Linesheet Re-submission (1 Time)', 'Linesheet Re-submission', null::numeric, 'licensor', false, 'licensor_specific', null, false),
  ('licensing', 3, 'Submission', 'Licensor Review', null::numeric, 'licensor', true, 'licensed', null, false),
  ('licensing', 4, 'Re-Submission (1 Time)', 'Licensor Re-review', null::numeric, 'licensor', true, 'licensed', null, false),
  ('licensing', 5, 'PPS Approval', 'PPS Approval', null::numeric, 'licensor', true, 'licensed', 'pps_done', true),
  ('sampling', 1, 'Tech Pack Sent', 'Tech Pack', null::numeric, null, false, 'licensed', 'tech_pack_done', true),
  ('sampling', 2, 'Sample Started', 'Sample', null::numeric, 'product_type', true, 'licensed', 'sample_start_date', true),
  ('sampling', 3, 'Re-sampling', 'Re-sample', null::numeric, 'product_type', false, 'on_resubmit', null, false),
  ('sampling', 4, 'Sample Photos Received', 'Sample Photos', null::numeric, null, false, 'licensed', 'photos_done', true),
  ('sampling', 5, 'Buyer Approval', 'Buyer Approval', null::numeric, null, false, 'licensed', 'buyer_approval_date', true),
  ('production', 1, 'Factory Prep', 'Factory Prep', null::numeric, null, false, 'all', null, false),
  ('production', 2, 'Material Arrival', 'Material', null::numeric, null, false, 'all', 'material_done', true),
  ('production', 3, 'Mass Production Start', 'Mass Production', null::numeric, null, false, 'all', 'mass_prod_start_date', true),
  ('production', 4, 'Assembly', 'Assembly', null::numeric, null, false, 'all', 'assembly_start_date', true),
  ('production', 5, 'Mass Production Complete', 'Production Completion', null::numeric, 'product_type', true, 'all', 'actual_prod_complete', true),
  ('production', 6, 'Packing', 'Packing', null::numeric, null, false, 'all', 'packing_start_date', true),
  ('production', 7, 'QC Inspection', 'QC', null::numeric, null, false, 'all', 'qc_inspection_date', true),
  ('shipping', 1, 'Shipping', 'Shipment', null::numeric, null, false, 'all', 'actual_etd', true)
) as v(list_key, position, name, pending_label, default_duration, duration_varies_by, counts_toward_total, applies_to, done_signal, shown_on_tracker)
join plm.stage_list l on l.key = v.list_key;

insert into plm.stage_duration (stage_id, scope_kind, scope_value, duration)
select s.id, v.scope_kind, v.scope_value, v.duration
from (values
  ('design', 'Brief', 'product_type', 'Plain Canvas', 30::numeric),
  ('design', 'Design', 'product_type', 'Plain Canvas', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Plain Canvas', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Plain Canvas', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Plain Canvas', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Plain Canvas', 6::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Plain Canvas', 30::numeric),
  ('design', 'Brief', 'product_type', 'Framed MDF', 30::numeric),
  ('design', 'Design', 'product_type', 'Framed MDF', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Framed MDF', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Framed MDF', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Framed MDF', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Framed MDF', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Framed MDF', 40::numeric),
  ('design', 'Brief', 'product_type', 'Wall Clocks', 60::numeric),
  ('design', 'Design', 'product_type', 'Wall Clocks', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Wall Clocks', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Wall Clocks', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Wall Clocks', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Wall Clocks', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Wall Clocks', 30::numeric),
  ('design', 'Brief', 'product_type', 'Foam', 30::numeric),
  ('design', 'Design', 'product_type', 'Foam', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Foam', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Foam', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Foam', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Foam', 20::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Foam', 40::numeric),
  ('design', 'Brief', 'product_type', 'Wall Decals', 30::numeric),
  ('design', 'Design', 'product_type', 'Wall Decals', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Wall Decals', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Wall Decals', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Wall Decals', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Wall Decals', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Wall Decals', 30::numeric),
  ('design', 'Brief', 'product_type', 'Metal Signs', 30::numeric),
  ('design', 'Design', 'product_type', 'Metal Signs', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Metal Signs', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Metal Signs', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Metal Signs', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Metal Signs', 20::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Metal Signs', 35::numeric),
  ('design', 'Brief', 'product_type', 'Metallic Canvas', 30::numeric),
  ('design', 'Design', 'product_type', 'Metallic Canvas', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Metallic Canvas', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Metallic Canvas', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Metallic Canvas', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Metallic Canvas', 6::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Metallic Canvas', 33::numeric),
  ('design', 'Brief', 'product_type', 'Lenticular Art', 30::numeric),
  ('design', 'Design', 'product_type', 'Lenticular Art', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Lenticular Art', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Lenticular Art', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Lenticular Art', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Lenticular Art', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Lenticular Art', 40::numeric),
  ('design', 'Brief', 'product_type', 'Wall Hangings (Fabric i.e. Tapestries)', 30::numeric),
  ('design', 'Design', 'product_type', 'Wall Hangings (Fabric i.e. Tapestries)', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Wall Hangings (Fabric i.e. Tapestries)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Wall Hangings (Fabric i.e. Tapestries)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Wall Hangings (Fabric i.e. Tapestries)', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Wall Hangings (Fabric i.e. Tapestries)', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Wall Hangings (Fabric i.e. Tapestries)', 30::numeric),
  ('design', 'Brief', 'product_type', 'Seasonal Wall Decor', 30::numeric),
  ('design', 'Design', 'product_type', 'Seasonal Wall Decor', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Seasonal Wall Decor', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Seasonal Wall Decor', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Seasonal Wall Decor', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Seasonal Wall Decor', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Seasonal Wall Decor', 35::numeric),
  ('design', 'Brief', 'product_type', 'Printed Glass', 30::numeric),
  ('design', 'Design', 'product_type', 'Printed Glass', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Printed Glass', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Printed Glass', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Printed Glass', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Printed Glass', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Printed Glass', 35::numeric),
  ('design', 'Brief', 'product_type', 'Molded Shadowbox', 30::numeric),
  ('design', 'Design', 'product_type', 'Molded Shadowbox', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Molded Shadowbox', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Molded Shadowbox', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Molded Shadowbox', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Molded Shadowbox', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Molded Shadowbox', 40::numeric),
  ('design', 'Brief', 'product_type', 'Picture & Photo Frames (children to Adult)', 30::numeric),
  ('design', 'Design', 'product_type', 'Picture & Photo Frames (children to Adult)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Picture & Photo Frames (children to Adult)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Picture & Photo Frames (children to Adult)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Picture & Photo Frames (children to Adult)', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Picture & Photo Frames (children to Adult)', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Picture & Photo Frames (children to Adult)', 40::numeric),
  ('design', 'Brief', 'product_type', 'LED Wall Art (i.e. Infinity Mirror, LED Canvas, and LED Printed Glass) NOT SIGNS', 30::numeric),
  ('design', 'Design', 'product_type', 'LED Wall Art (i.e. Infinity Mirror, LED Canvas, and LED Printed Glass) NOT SIGNS', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'LED Wall Art (i.e. Infinity Mirror, LED Canvas, and LED Printed Glass) NOT SIGNS', 30::numeric),
  ('design', 'Revisions', 'product_type', 'LED Wall Art (i.e. Infinity Mirror, LED Canvas, and LED Printed Glass) NOT SIGNS', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'LED Wall Art (i.e. Infinity Mirror, LED Canvas, and LED Printed Glass) NOT SIGNS', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'LED Wall Art (i.e. Infinity Mirror, LED Canvas, and LED Printed Glass) NOT SIGNS', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'LED Wall Art (i.e. Infinity Mirror, LED Canvas, and LED Printed Glass) NOT SIGNS', 48::numeric),
  ('design', 'Brief', 'product_type', 'Canvas With Embellishments', 30::numeric),
  ('design', 'Design', 'product_type', 'Canvas With Embellishments', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Canvas With Embellishments', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Canvas With Embellishments', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Canvas With Embellishments', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Canvas With Embellishments', 8::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Canvas With Embellishments', 38::numeric),
  ('design', 'Brief', 'product_type', 'DIY / craft wall art', 30::numeric),
  ('design', 'Design', 'product_type', 'DIY / craft wall art', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'DIY / craft wall art', 30::numeric),
  ('design', 'Revisions', 'product_type', 'DIY / craft wall art', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'DIY / craft wall art', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'DIY / craft wall art', 25::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'DIY / craft wall art', 35::numeric),
  ('design', 'Brief', 'product_type', 'Plaques', 30::numeric),
  ('design', 'Design', 'product_type', 'Plaques', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Plaques', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Plaques', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Plaques', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Plaques', 9::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Plaques', 38::numeric),
  ('design', 'Brief', 'product_type', 'Stringed Lights w/o photoclips', 30::numeric),
  ('design', 'Design', 'product_type', 'Stringed Lights w/o photoclips', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Stringed Lights w/o photoclips', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Stringed Lights w/o photoclips', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Stringed Lights w/o photoclips', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Stringed Lights w/o photoclips', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Stringed Lights w/o photoclips', 75::numeric),
  ('design', 'Brief', 'product_type', 'Stringed Lights w photoclips', 30::numeric),
  ('design', 'Design', 'product_type', 'Stringed Lights w photoclips', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Stringed Lights w photoclips', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Stringed Lights w photoclips', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Stringed Lights w photoclips', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Stringed Lights w photoclips', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Stringed Lights w photoclips', 75::numeric),
  ('design', 'Brief', 'product_type', 'Wreathes', 30::numeric),
  ('design', 'Design', 'product_type', 'Wreathes', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Wreathes', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Wreathes', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Wreathes', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Wreathes', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Wreathes', 75::numeric),
  ('design', 'Brief', 'product_type', 'Infant Frames', 30::numeric),
  ('design', 'Design', 'product_type', 'Infant Frames', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Infant Frames', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Infant Frames', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Infant Frames', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Infant Frames', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Infant Frames', 35::numeric),
  ('design', 'Brief', 'product_type', 'Infant Clocks', 30::numeric),
  ('design', 'Design', 'product_type', 'Infant Clocks', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Infant Clocks', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Infant Clocks', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Infant Clocks', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Infant Clocks', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Infant Clocks', 30::numeric),
  ('design', 'Brief', 'product_type', 'Shelves', 30::numeric),
  ('design', 'Design', 'product_type', 'Shelves', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Shelves', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Shelves', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Shelves', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Shelves', 5::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Shelves', 35::numeric),
  ('design', 'Brief', 'product_type', 'Wall Hooks', 30::numeric),
  ('design', 'Design', 'product_type', 'Wall Hooks', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Wall Hooks', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Wall Hooks', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Wall Hooks', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Wall Hooks', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Wall Hooks', 35::numeric),
  ('design', 'Brief', 'product_type', 'Letter Boards', 30::numeric),
  ('design', 'Design', 'product_type', 'Letter Boards', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Letter Boards', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Letter Boards', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Letter Boards', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Letter Boards', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Letter Boards', 40::numeric),
  ('design', 'Brief', 'product_type', 'Memo Boards', 30::numeric),
  ('design', 'Design', 'product_type', 'Memo Boards', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Memo Boards', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Memo Boards', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Memo Boards', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Memo Boards', 9::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Memo Boards', 42::numeric),
  ('design', 'Brief', 'product_type', 'Felt/Cork Pinboard Grids', 30::numeric),
  ('design', 'Design', 'product_type', 'Felt/Cork Pinboard Grids', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Felt/Cork Pinboard Grids', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Felt/Cork Pinboard Grids', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Felt/Cork Pinboard Grids', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Felt/Cork Pinboard Grids', 9::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Felt/Cork Pinboard Grids', 48::numeric),
  ('design', 'Brief', 'product_type', 'Easels', 30::numeric),
  ('design', 'Design', 'product_type', 'Easels', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Easels', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Easels', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Easels', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Easels', 13::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Easels', 58::numeric),
  ('design', 'Brief', 'product_type', 'Freeform Ceramic Blocks', 30::numeric),
  ('design', 'Design', 'product_type', 'Freeform Ceramic Blocks', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Freeform Ceramic Blocks', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Freeform Ceramic Blocks', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Freeform Ceramic Blocks', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Freeform Ceramic Blocks', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Freeform Ceramic Blocks', 75::numeric),
  ('design', 'Brief', 'product_type', 'Fabric Letters', 30::numeric),
  ('design', 'Design', 'product_type', 'Fabric Letters', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Fabric Letters', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Fabric Letters', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Fabric Letters', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Fabric Letters', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Fabric Letters', 30::numeric),
  ('design', 'Brief', 'product_type', 'MDF Letters', 30::numeric),
  ('design', 'Design', 'product_type', 'MDF Letters', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'MDF Letters', 30::numeric),
  ('design', 'Revisions', 'product_type', 'MDF Letters', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'MDF Letters', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'MDF Letters', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'MDF Letters', 40::numeric),
  ('design', 'Brief', 'product_type', 'Greyboard Letters', 30::numeric),
  ('design', 'Design', 'product_type', 'Greyboard Letters', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Greyboard Letters', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Greyboard Letters', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Greyboard Letters', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Greyboard Letters', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Greyboard Letters', 40::numeric),
  ('design', 'Brief', 'product_type', 'Clip Photo Holders (Tabletop Block with Clip)', 30::numeric),
  ('design', 'Design', 'product_type', 'Clip Photo Holders (Tabletop Block with Clip)', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Clip Photo Holders (Tabletop Block with Clip)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Clip Photo Holders (Tabletop Block with Clip)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Clip Photo Holders (Tabletop Block with Clip)', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Clip Photo Holders (Tabletop Block with Clip)', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Clip Photo Holders (Tabletop Block with Clip)', 40::numeric),
  ('design', 'Brief', 'product_type', 'LED/Neon Light Items (DECORATIVE ONLY, NOT A FUNCTIONAL LIGHT)', 60::numeric),
  ('design', 'Design', 'product_type', 'LED/Neon Light Items (DECORATIVE ONLY, NOT A FUNCTIONAL LIGHT)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'LED/Neon Light Items (DECORATIVE ONLY, NOT A FUNCTIONAL LIGHT)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'LED/Neon Light Items (DECORATIVE ONLY, NOT A FUNCTIONAL LIGHT)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'LED/Neon Light Items (DECORATIVE ONLY, NOT A FUNCTIONAL LIGHT)', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'LED/Neon Light Items (DECORATIVE ONLY, NOT A FUNCTIONAL LIGHT)', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'LED/Neon Light Items (DECORATIVE ONLY, NOT A FUNCTIONAL LIGHT)', 40::numeric),
  ('design', 'Brief', 'product_type', 'Glass Paperweight', 30::numeric),
  ('design', 'Design', 'product_type', 'Glass Paperweight', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Glass Paperweight', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Glass Paperweight', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Glass Paperweight', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Glass Paperweight', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Glass Paperweight', 35::numeric),
  ('design', 'Brief', 'product_type', 'Glass Decorative Blocks (not a paperweight)', 30::numeric),
  ('design', 'Design', 'product_type', 'Glass Decorative Blocks (not a paperweight)', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Glass Decorative Blocks (not a paperweight)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Glass Decorative Blocks (not a paperweight)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Glass Decorative Blocks (not a paperweight)', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Glass Decorative Blocks (not a paperweight)', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Glass Decorative Blocks (not a paperweight)', 35::numeric),
  ('design', 'Brief', 'product_type', 'Pencil Cups', 30::numeric),
  ('design', 'Design', 'product_type', 'Pencil Cups', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Pencil Cups', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Pencil Cups', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Pencil Cups', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Pencil Cups', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Pencil Cups', 40::numeric),
  ('design', 'Brief', 'product_type', 'Desk Organizers', 60::numeric),
  ('design', 'Design', 'product_type', 'Desk Organizers', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Desk Organizers', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Desk Organizers', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Desk Organizers', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Desk Organizers', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Desk Organizers', 40::numeric),
  ('design', 'Brief', 'product_type', 'Bookends', 60::numeric),
  ('design', 'Design', 'product_type', 'Bookends', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Bookends', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Bookends', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Bookends', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Bookends', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Bookends', 40::numeric),
  ('design', 'Brief', 'product_type', 'Lap Desks', 60::numeric),
  ('design', 'Design', 'product_type', 'Lap Desks', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Lap Desks', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Lap Desks', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Lap Desks', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Lap Desks', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Lap Desks', 45::numeric),
  ('design', 'Brief', 'product_type', 'Monitor Stands', 60::numeric),
  ('design', 'Design', 'product_type', 'Monitor Stands', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Monitor Stands', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Monitor Stands', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Monitor Stands', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Monitor Stands', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Monitor Stands', 45::numeric),
  ('design', 'Brief', 'product_type', 'Desk and Nameplates', 60::numeric),
  ('design', 'Design', 'product_type', 'Desk and Nameplates', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Desk and Nameplates', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Desk and Nameplates', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Desk and Nameplates', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Desk and Nameplates', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Desk and Nameplates', 40::numeric),
  ('design', 'Brief', 'product_type', 'Perpetual Calendars', 60::numeric),
  ('design', 'Design', 'product_type', 'Perpetual Calendars', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Perpetual Calendars', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Perpetual Calendars', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Perpetual Calendars', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Perpetual Calendars', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Perpetual Calendars', 40::numeric),
  ('design', 'Brief', 'product_type', 'Perpetual Calendars Seasonal', 60::numeric),
  ('design', 'Design', 'product_type', 'Perpetual Calendars Seasonal', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Perpetual Calendars Seasonal', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Perpetual Calendars Seasonal', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Perpetual Calendars Seasonal', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Perpetual Calendars Seasonal', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Perpetual Calendars Seasonal', 40::numeric),
  ('design', 'Brief', 'product_type', 'Banks', 30::numeric),
  ('design', 'Design', 'product_type', 'Banks', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Banks', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Banks', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Banks', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Banks', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Banks', 35::numeric),
  ('design', 'Brief', 'product_type', 'Door Hangers', 30::numeric),
  ('design', 'Design', 'product_type', 'Door Hangers', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Door Hangers', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Door Hangers', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Door Hangers', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Door Hangers', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Door Hangers', 50::numeric),
  ('design', 'Brief', 'product_type', 'Light Switch Covers', 30::numeric),
  ('design', 'Design', 'product_type', 'Light Switch Covers', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Light Switch Covers', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Light Switch Covers', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Light Switch Covers', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Light Switch Covers', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Light Switch Covers', 75::numeric),
  ('design', 'Brief', 'product_type', 'Tablet Stand', 30::numeric),
  ('design', 'Design', 'product_type', 'Tablet Stand', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Tablet Stand', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Tablet Stand', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Tablet Stand', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Tablet Stand', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Tablet Stand', 35::numeric),
  ('design', 'Brief', 'product_type', 'Phone Stand', 30::numeric),
  ('design', 'Design', 'product_type', 'Phone Stand', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Phone Stand', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Phone Stand', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Phone Stand', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Phone Stand', 7::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Phone Stand', 35::numeric),
  ('design', 'Brief', 'product_type', 'Closet', 60::numeric),
  ('design', 'Design', 'product_type', 'Closet', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Closet', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Closet', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Closet', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Closet', 26::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Closet', 60::numeric),
  ('design', 'Brief', 'product_type', 'Soft storage Cubes (Collapsible and Non-Collapsible)', 60::numeric),
  ('design', 'Design', 'product_type', 'Soft storage Cubes (Collapsible and Non-Collapsible)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Soft storage Cubes (Collapsible and Non-Collapsible)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Soft storage Cubes (Collapsible and Non-Collapsible)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Soft storage Cubes (Collapsible and Non-Collapsible)', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Soft storage Cubes (Collapsible and Non-Collapsible)', 26::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Soft storage Cubes (Collapsible and Non-Collapsible)', 60::numeric),
  ('design', 'Brief', 'product_type', 'Hanging Closet Storage', 60::numeric),
  ('design', 'Design', 'product_type', 'Hanging Closet Storage', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Hanging Closet Storage', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Hanging Closet Storage', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Hanging Closet Storage', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Hanging Closet Storage', 26::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Hanging Closet Storage', 60::numeric),
  ('design', 'Brief', 'product_type', 'Hampers', 60::numeric),
  ('design', 'Design', 'product_type', 'Hampers', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Hampers', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Hampers', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Hampers', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Hampers', 26::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Hampers', 60::numeric),
  ('design', 'Brief', 'product_type', 'Storage Baskets (**Not Wicker Baskets**)', 60::numeric),
  ('design', 'Design', 'product_type', 'Storage Baskets (**Not Wicker Baskets**)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Storage Baskets (**Not Wicker Baskets**)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Storage Baskets (**Not Wicker Baskets**)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Storage Baskets (**Not Wicker Baskets**)', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Storage Baskets (**Not Wicker Baskets**)', 13::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Storage Baskets (**Not Wicker Baskets**)', 40::numeric),
  ('design', 'Brief', 'product_type', 'Storage Baskets (**Made of Wicker, Hyacinth, Seagrass, & Natural Fibers**)', 60::numeric),
  ('design', 'Design', 'product_type', 'Storage Baskets (**Made of Wicker, Hyacinth, Seagrass, & Natural Fibers**)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Storage Baskets (**Made of Wicker, Hyacinth, Seagrass, & Natural Fibers**)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Storage Baskets (**Made of Wicker, Hyacinth, Seagrass, & Natural Fibers**)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Storage Baskets (**Made of Wicker, Hyacinth, Seagrass, & Natural Fibers**)', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Storage Baskets (**Made of Wicker, Hyacinth, Seagrass, & Natural Fibers**)', 16::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Storage Baskets (**Made of Wicker, Hyacinth, Seagrass, & Natural Fibers**)', 40::numeric),
  ('design', 'Brief', 'product_type', 'Chests', 60::numeric),
  ('design', 'Design', 'product_type', 'Chests', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Chests', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Chests', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Chests', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Chests', 26::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Chests', 60::numeric),
  ('design', 'Brief', 'product_type', 'Faux Book Storage', 60::numeric),
  ('design', 'Design', 'product_type', 'Faux Book Storage', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Faux Book Storage', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Faux Book Storage', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Faux Book Storage', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Faux Book Storage', 21::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Faux Book Storage', 43::numeric),
  ('design', 'Brief', 'product_type', 'Makeup Organizers (Acrylic Desk Organizer **Jewelry Organizer)', 60::numeric),
  ('design', 'Design', 'product_type', 'Makeup Organizers (Acrylic Desk Organizer **Jewelry Organizer)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Makeup Organizers (Acrylic Desk Organizer **Jewelry Organizer)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Makeup Organizers (Acrylic Desk Organizer **Jewelry Organizer)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Makeup Organizers (Acrylic Desk Organizer **Jewelry Organizer)', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Makeup Organizers (Acrylic Desk Organizer **Jewelry Organizer)', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Makeup Organizers (Acrylic Desk Organizer **Jewelry Organizer)', 50::numeric),
  ('design', 'Brief', 'product_type', 'Under Bed Storage', 60::numeric),
  ('design', 'Design', 'product_type', 'Under Bed Storage', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Under Bed Storage', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Under Bed Storage', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Under Bed Storage', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Under Bed Storage', 26::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Under Bed Storage', 60::numeric),
  ('design', 'Brief', 'product_type', 'Music Jewelry Boxes', 60::numeric),
  ('design', 'Design', 'product_type', 'Music Jewelry Boxes', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Music Jewelry Boxes', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Music Jewelry Boxes', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Music Jewelry Boxes', 30::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Music Jewelry Boxes', 13::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Music Jewelry Boxes', 58::numeric),
  ('design', 'Brief', 'product_type', 'Coir Mats (All Ages)', 60::numeric),
  ('design', 'Design', 'product_type', 'Coir Mats (All Ages)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Coir Mats (All Ages)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Coir Mats (All Ages)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Coir Mats (All Ages)', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Coir Mats (All Ages)', 20::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Coir Mats (All Ages)', 50::numeric),
  ('design', 'Brief', 'product_type', 'Door Mats (Adults)', 60::numeric),
  ('design', 'Design', 'product_type', 'Door Mats (Adults)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Door Mats (Adults)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Door Mats (Adults)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Door Mats (Adults)', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Door Mats (Adults)', 20::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Door Mats (Adults)', 50::numeric),
  ('design', 'Brief', 'product_type', 'Kitchen Mats', 60::numeric),
  ('design', 'Design', 'product_type', 'Kitchen Mats', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Kitchen Mats', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Kitchen Mats', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Kitchen Mats', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Kitchen Mats', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Kitchen Mats', 75::numeric),
  ('design', 'Brief', 'product_type', 'Throw Rugs (Adults)', 60::numeric),
  ('design', 'Design', 'product_type', 'Throw Rugs (Adults)', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Throw Rugs (Adults)', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Throw Rugs (Adults)', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Throw Rugs (Adults)', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Throw Rugs (Adults)', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Throw Rugs (Adults)', 75::numeric),
  ('design', 'Brief', 'product_type', 'Planters', 60::numeric),
  ('design', 'Design', 'product_type', 'Planters', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Planters', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Planters', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Planters', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Planters', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Planters', 75::numeric),
  ('design', 'Brief', 'product_type', 'Decorative Watering Cans', 60::numeric),
  ('design', 'Design', 'product_type', 'Decorative Watering Cans', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Decorative Watering Cans', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Decorative Watering Cans', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Decorative Watering Cans', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Decorative Watering Cans', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Decorative Watering Cans', 75::numeric),
  ('design', 'Brief', 'product_type', 'Garden Flags', 60::numeric),
  ('design', 'Design', 'product_type', 'Garden Flags', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Garden Flags', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Garden Flags', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Garden Flags', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Garden Flags', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Garden Flags', 75::numeric),
  ('design', 'Brief', 'product_type', 'Lawn Signs', 60::numeric),
  ('design', 'Design', 'product_type', 'Lawn Signs', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Lawn Signs', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Lawn Signs', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Lawn Signs', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Lawn Signs', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Lawn Signs', 75::numeric),
  ('design', 'Brief', 'product_type', 'Gloves', 60::numeric),
  ('design', 'Design', 'product_type', 'Gloves', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Gloves', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Gloves', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Gloves', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Gloves', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Gloves', 75::numeric),
  ('design', 'Brief', 'product_type', 'Aprons', 60::numeric),
  ('design', 'Design', 'product_type', 'Aprons', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Aprons', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Aprons', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Aprons', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Aprons', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Aprons', 75::numeric),
  ('design', 'Brief', 'product_type', 'Kneeling pads', 60::numeric),
  ('design', 'Design', 'product_type', 'Kneeling pads', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Kneeling pads', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Kneeling pads', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Kneeling pads', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Kneeling pads', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Kneeling pads', 75::numeric),
  ('design', 'Brief', 'product_type', 'Hand cultivators', 60::numeric),
  ('design', 'Design', 'product_type', 'Hand cultivators', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Hand cultivators', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Hand cultivators', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Hand cultivators', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Hand cultivators', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Hand cultivators', 75::numeric),
  ('design', 'Brief', 'product_type', 'Hand trowels', 60::numeric),
  ('design', 'Design', 'product_type', 'Hand trowels', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Hand trowels', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Hand trowels', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Hand trowels', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Hand trowels', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Hand trowels', 75::numeric),
  ('design', 'Brief', 'product_type', 'Shovels', 60::numeric),
  ('design', 'Design', 'product_type', 'Shovels', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Shovels', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Shovels', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Shovels', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Shovels', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Shovels', 75::numeric),
  ('design', 'Brief', 'product_type', 'Rakes', 60::numeric),
  ('design', 'Design', 'product_type', 'Rakes', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Rakes', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Rakes', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Rakes', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Rakes', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Rakes', 75::numeric),
  ('design', 'Brief', 'product_type', 'Garden pails', 60::numeric),
  ('design', 'Design', 'product_type', 'Garden pails', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Garden pails', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Garden pails', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Garden pails', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Garden pails', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Garden pails', 75::numeric),
  ('design', 'Brief', 'product_type', 'Functional Watering Cans', 60::numeric),
  ('design', 'Design', 'product_type', 'Functional Watering Cans', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Functional Watering Cans', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Functional Watering Cans', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Functional Watering Cans', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Functional Watering Cans', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Functional Watering Cans', 75::numeric),
  ('design', 'Brief', 'product_type', 'Garden Sculptures', 60::numeric),
  ('design', 'Design', 'product_type', 'Garden Sculptures', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Garden Sculptures', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Garden Sculptures', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Garden Sculptures', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Garden Sculptures', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Garden Sculptures', 75::numeric),
  ('design', 'Brief', 'product_type', 'Window Shades and Blinds', 30::numeric),
  ('design', 'Design', 'product_type', 'Window Shades and Blinds', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Window Shades and Blinds', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Window Shades and Blinds', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Window Shades and Blinds', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Window Shades and Blinds', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Window Shades and Blinds', 75::numeric),
  ('design', 'Brief', 'product_type', 'Door and Drawer Knobs', 30::numeric),
  ('design', 'Design', 'product_type', 'Door and Drawer Knobs', 30::numeric),
  ('design', 'Tech Packing', 'product_type', 'Door and Drawer Knobs', 30::numeric),
  ('design', 'Revisions', 'product_type', 'Door and Drawer Knobs', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Door and Drawer Knobs', 10::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Door and Drawer Knobs', 15::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Door and Drawer Knobs', 75::numeric),
  ('design', 'Brief', 'product_type', 'Tall MDF Signs', 30::numeric),
  ('design', 'Design', 'product_type', 'Tall MDF Signs', 60::numeric),
  ('design', 'Tech Packing', 'product_type', 'Tall MDF Signs', 60::numeric),
  ('design', 'Revisions', 'product_type', 'Tall MDF Signs', 30::numeric),
  ('design', 'Files for Factory', 'product_type', 'Tall MDF Signs', 20::numeric),
  ('sampling', 'Sample Started', 'product_type', 'Tall MDF Signs', 10::numeric),
  ('production', 'Mass Production Complete', 'product_type', 'Tall MDF Signs', 40::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Disney', 3::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Disney', 3::numeric),
  ('licensing', 'Submission', 'licensor', 'Disney', 5::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Disney', 5::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Disney', 7::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'LucasFilm, LLC (Star Wars)', 2::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'LucasFilm, LLC (Star Wars)', 2::numeric),
  ('licensing', 'Submission', 'licensor', 'LucasFilm, LLC (Star Wars)', 2::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'LucasFilm, LLC (Star Wars)', 2::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'LucasFilm, LLC (Star Wars)', 2::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Warner Brothers', 12::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Warner Brothers', 5::numeric),
  ('licensing', 'Submission', 'licensor', 'Warner Brothers', 10::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Warner Brothers', 10::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Warner Brothers', 10::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Marvel', 2::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Marvel', 2::numeric),
  ('licensing', 'Submission', 'licensor', 'Marvel', 2::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Marvel', 2::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Marvel', 2::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Nickelodeon (Paramount)', 5::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Nickelodeon (Paramount)', 5::numeric),
  ('licensing', 'Submission', 'licensor', 'Nickelodeon (Paramount)', 6::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Nickelodeon (Paramount)', 6::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Nickelodeon (Paramount)', 6::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'NBC Universal', 12::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'NBC Universal', 12::numeric),
  ('licensing', 'Submission', 'licensor', 'NBC Universal', 7::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'NBC Universal', 7::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'NBC Universal', 7::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Peanuts', 6::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Peanuts', 6::numeric),
  ('licensing', 'Submission', 'licensor', 'Peanuts', 10::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Peanuts', 10::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Peanuts', 10::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'SEGA', 8::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'SEGA', 8::numeric),
  ('licensing', 'Submission', 'licensor', 'SEGA', 10::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'SEGA', 10::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'SEGA', 10::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Strawberry Shortcake (Wildbrain CPLP)', 34::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Strawberry Shortcake (Wildbrain CPLP)', 34::numeric),
  ('licensing', 'Submission', 'licensor', 'Strawberry Shortcake (Wildbrain CPLP)', 10::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Strawberry Shortcake (Wildbrain CPLP)', 10::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Strawberry Shortcake (Wildbrain CPLP)', 10::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'WWE', 10::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'WWE', 10::numeric),
  ('licensing', 'Submission', 'licensor', 'WWE', 10::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'WWE', 10::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'WWE', 10::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'One Piece (Toei)', 21::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'One Piece (Toei)', 21::numeric),
  ('licensing', 'Submission', 'licensor', 'One Piece (Toei)', 15::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'One Piece (Toei)', 15::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'One Piece (Toei)', 15::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Coca-Cola', 6::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Coca-Cola', 6::numeric),
  ('licensing', 'Submission', 'licensor', 'Coca-Cola', 6::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Coca-Cola', 6::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Coca-Cola', 13::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Sesame Street', 4::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Sesame Street', 4::numeric),
  ('licensing', 'Submission', 'licensor', 'Sesame Street', 4::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Sesame Street', 4::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Sesame Street', 4::numeric),
  ('licensing', 'Linesheet Submission', 'licensor', 'Ford', null::numeric),
  ('licensing', 'Linesheet Re-submission (1 Time)', 'licensor', 'Ford', null::numeric),
  ('licensing', 'Submission', 'licensor', 'Ford', null::numeric),
  ('licensing', 'Re-Submission (1 Time)', 'licensor', 'Ford', null::numeric),
  ('licensing', 'PPS Approval', 'licensor', 'Ford', null::numeric)
) as v(list_key, stage_name, scope_kind, scope_value, duration)
join plm.stage_list l on l.key = v.list_key
join plm.stage s on s.list_id = l.id and s.name = v.stage_name;

insert into plm.licensor_stage_option (licensor_name, stage_id, enabled)
select v.licensor_name, s.id, v.enabled
from (values
  ('Disney', true),
  ('LucasFilm, LLC (Star Wars)', true),
  ('Warner Brothers', true),
  ('Marvel', true),
  ('Nickelodeon (Paramount)', false),
  ('NBC Universal', true),
  ('Peanuts', false),
  ('SEGA', false),
  ('Strawberry Shortcake (Wildbrain CPLP)', false),
  ('WWE', false),
  ('One Piece (Toei)', false),
  ('Coca-Cola', true),
  ('Sesame Street', false),
  ('Ford', false),
  ('Steal a Brain Rot', true),
  ('Aardman Animations', true)
) as v(licensor_name, enabled)
cross join plm.stage s
join plm.stage_list l on l.id = s.list_id and l.key = 'licensing'
where s.applies_to = 'licensor_specific';

create function plm.stage_catalog_bump_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list_ids integer[];
begin
  if tg_table_name = 'stage_list' then
    -- BEFORE UPDATE: any edit to the list row itself bumps its version once.
    if new.version = old.version and row(new.*) is distinct from row(old.*) then
      new.version := old.version + 1;
      new.updated_at := now();
    end if;
    return new;
  end if;

  if tg_table_name = 'stage' then
    v_list_ids := array_remove(array[
      case when tg_op <> 'DELETE' then new.list_id end,
      case when tg_op <> 'INSERT' then old.list_id end], null);
  elsif tg_table_name = 'stage_dependency' then
    select array_agg(distinct s.list_id) into v_list_ids
    from plm.stage s
    where s.id = any (array_remove(array[
      case when tg_op <> 'DELETE' then new.stage_id end,
      case when tg_op <> 'DELETE' then new.depends_on_stage_id end,
      case when tg_op <> 'INSERT' then old.stage_id end,
      case when tg_op <> 'INSERT' then old.depends_on_stage_id end], null));
  else
    -- stage_duration, licensor_stage_option
    select array_agg(distinct s.list_id) into v_list_ids
    from plm.stage s
    where s.id = any (array_remove(array[
      case when tg_op <> 'DELETE' then new.stage_id end,
      case when tg_op <> 'INSERT' then old.stage_id end], null));
  end if;

  update plm.stage_list l
     set version = l.version + 1, updated_at = now()
   where l.id = any (coalesce(v_list_ids, '{}'::integer[]));
  return null;
end;
$$;

comment on function plm.stage_catalog_bump_version() is 'Bumps plm.stage_list.version on any change to a list or its stages, durations, dependencies or licensor options. shared-db#4350.';
revoke all on function plm.stage_catalog_bump_version() from public, anon, authenticated;
-- service_role writes these tables through its schema default grants, so it must be able
-- to fire the triggers (precedent: 20260830203342_opa_durable_entity_lifecycle.sql).
grant execute on function plm.stage_catalog_bump_version() to service_role;

-- Triggers are created after the seed so every list starts at version 1.
create trigger stage_list_bump_version before update on plm.stage_list
  for each row execute function plm.stage_catalog_bump_version();
create trigger stage_bump_version after insert or update or delete on plm.stage
  for each row execute function plm.stage_catalog_bump_version();
create trigger stage_duration_bump_version after insert or update or delete on plm.stage_duration
  for each row execute function plm.stage_catalog_bump_version();
create trigger stage_dependency_bump_version after insert or update or delete on plm.stage_dependency
  for each row execute function plm.stage_catalog_bump_version();
create trigger licensor_stage_option_bump_version after insert or update or delete on plm.licensor_stage_option
  for each row execute function plm.stage_catalog_bump_version();

do $$
begin
  if (select count(*) from plm.stage_list) <> 5
     or (select count(*) from plm.stage) <> 24
     or (select count(*) from plm.stage_duration) <> 637
     or (select count(*) from plm.licensor_stage_option) <> 32
     or (select count(*) from plm.licensor_stage_option where enabled) <> 16
     or (select count(*) from plm.stage where shown_on_tracker) <> 12
     or (select count(*) from plm.stage_dependency) <> 0 then
    raise exception 'stage catalog seed counts are wrong';
  end if;
end;
$$;
