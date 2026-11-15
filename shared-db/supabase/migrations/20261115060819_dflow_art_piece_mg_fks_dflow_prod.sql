-- derived-from: none
-- Claim popcre/shared-db#6343. Work issue popcre/designflow-item-master#205,
-- plan plan_merch-group-environment-parity.md step 3.1 (remaining links).
-- PRODUCTION SHAPE (schema dflow_prod, project qsllyeztdwjgirsysgai), promoted
-- by the normal shared preview -> production lanes. Not needed on DesignFlow
-- non-production: there all ten keys already reference dflow."merchGroup"
-- (read-only 2026-11-15 1:10 AM EST).
--
-- Why: production DesignFlow services read and write dflow_prod."merchGroup";
-- core."merchGroup" is a stale copy due to be renamed (step 3.2). Ten keys on
-- dflow.art_piece (9) and dflow.artists (1) still reference it. This drops and
-- re-adds each same-named key against dflow_prod."merchGroup"(mg_id), keeping
-- its actions (ON UPDATE/ON DELETE NO ACTION): added NOT VALID, then VALIDATE.
--
-- Read-only before authoring (2026-11-15 1:08 AM EST): 1,116 art_piece rows,
-- 14 artists rows, 0 values absent from dflow_prod."merchGroup" (4,417 rows).
-- The self-check refuses (never deletes or edits rows) if any orphan appears.
-- Empty-parent guard (pattern of 20261114231235): ONLY when
-- dflow_prod."merchGroup" holds no row (unseeded preview, fresh database) the
-- orphan refusal and VALIDATE are skipped, so the keys stay NOT VALID there;
-- new rows are still checked. A key already on dflow_prod is left alone
-- (re-apply is a no-op). Statements are static (no dynamic SQL).
-- Rollback: drop each constraint and re-add it referencing core."merchGroup"(mg_id).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $check$
declare
  n bigint;
begin
  if to_regclass('dflow_prod."merchGroup"') is null
     or to_regclass('dflow.art_piece') is null or to_regclass('dflow.artists') is null then
    raise exception '#6343/20261115060819 self-check: dflow_prod."merchGroup", dflow.art_piece or dflow.artists missing; production-shape migration only'
      using errcode = 'feature_not_supported';
  end if;
  if not exists (select 1 from dflow_prod."merchGroup") then
    raise notice '#6343/20261115060819: dflow_prod."merchGroup" is empty (unseeded preview or fresh database); keys will be NOT VALID, orphan check skipped';
    return;
  end if;
  select count(*) into n from (
    select 1 from dflow.art_piece t where t.age_group_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.age_group_id)
    union all
    select 1 from dflow.art_piece t where t.art_source_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.art_source_id)
    union all
    select 1 from dflow.art_piece t where t.art_type_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.art_type_id)
    union all
    select 1 from dflow.art_piece t where t.artist_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.artist_id)
    union all
    select 1 from dflow.art_piece t where t.big_theme_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.big_theme_id)
    union all
    select 1 from dflow.art_piece t where t.licensor_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.licensor_id)
    union all
    select 1 from dflow.art_piece t where t.little_theme_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.little_theme_id)
    union all
    select 1 from dflow.art_piece t where t.property_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.property_id)
    union all
    select 1 from dflow.art_piece t where t.style_guide_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.style_guide_id)
    union all
    select 1 from dflow.artists t where t.art_source_id is not null and not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = t.art_source_id)) o;
  if n <> 0 then
    raise exception '#6343/20261115060819: % art_piece/artists values are absent from dflow_prod."merchGroup"; refuse (nothing deleted)', n
      using errcode = 'foreign_key_violation';
  end if;
end
$check$;

do $repoint$
declare
  parent_empty boolean := not exists (select 1 from dflow_prod."merchGroup");
begin
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_age_group_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_age_group_id_fkey;
    alter table dflow.art_piece add constraint art_piece_age_group_id_fkey
      foreign key (age_group_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_age_group_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_art_source_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_art_source_id_fkey;
    alter table dflow.art_piece add constraint art_piece_art_source_id_fkey
      foreign key (art_source_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_art_source_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_art_type_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_art_type_id_fkey;
    alter table dflow.art_piece add constraint art_piece_art_type_id_fkey
      foreign key (art_type_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_art_type_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_artist_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_artist_id_fkey;
    alter table dflow.art_piece add constraint art_piece_artist_id_fkey
      foreign key (artist_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_artist_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_big_theme_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_big_theme_id_fkey;
    alter table dflow.art_piece add constraint art_piece_big_theme_id_fkey
      foreign key (big_theme_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_big_theme_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_licensor_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_licensor_id_fkey;
    alter table dflow.art_piece add constraint art_piece_licensor_id_fkey
      foreign key (licensor_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_licensor_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_little_theme_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_little_theme_id_fkey;
    alter table dflow.art_piece add constraint art_piece_little_theme_id_fkey
      foreign key (little_theme_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_little_theme_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_property_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_property_id_fkey;
    alter table dflow.art_piece add constraint art_piece_property_id_fkey
      foreign key (property_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_property_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.art_piece'::regclass
                 and conname = 'art_piece_style_guide_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.art_piece drop constraint if exists art_piece_style_guide_id_fkey;
    alter table dflow.art_piece add constraint art_piece_style_guide_id_fkey
      foreign key (style_guide_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.art_piece validate constraint art_piece_style_guide_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'dflow.artists'::regclass
                 and conname = 'artists_art_source_id_fkey' and confrelid = 'dflow_prod."merchGroup"'::regclass) then
    alter table dflow.artists drop constraint if exists artists_art_source_id_fkey;
    alter table dflow.artists add constraint artists_art_source_id_fkey
      foreign key (art_source_id) references dflow_prod."merchGroup"(mg_id)
      on update no action on delete no action not valid;
  end if;
  if not parent_empty then
    alter table dflow.artists validate constraint artists_art_source_id_fkey;
  end if;
end
$repoint$;

commit;
