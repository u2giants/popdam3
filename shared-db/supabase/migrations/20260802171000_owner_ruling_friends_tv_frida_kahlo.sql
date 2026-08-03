-- Albert's owner ruling of 2026-08-02 on FRIENDS TV (`FR`) and FRIDA KAHLO (`FK`).
--
-- Predecessor in the same PR: 20260802170000_plm_import_preserve_curated_licensor_property_status.sql,
-- which stops plm.import_master_data() force-setting `status = 'active'` on every matched
-- licensor and property. WITHOUT that migration the data change below reverts silently on
-- the next PLM master-data sync. The two must ship and be applied together, in this order.
--
-- WHAT ALBERT RULED, ON 2026-08-02
-- --------------------------------
--   (a) Licensor `FR` = "FRIENDS TV" was NEVER a real licensor. It was created by mistake.
--   (b) "FRIDA KAHLO" was a PROPERTY under a FRIDA KAHLO LICENSOR, and that licensor is
--       now DEFUNCT.
--   (c) Therefore the current production mapping -- core.property `FK` (FRIDA KAHLO)
--       -> core.licensor `FR` (FRIENDS TV) -- is wrong on BOTH halves.
--
-- THE PRODUCTION FACTS THIS RULING LANDS ON (read 2026-08-02, ref qsllyeztdwjgirsysgai)
-- ------------------------------------------------------------------------------------
--   core.licensor  FR  "FRIENDS TV"  status=active  id 2b2caddf-4fb0-4fc3-8245-ccd8f8177e48
--                      metadata {"plm_import_source":"designflow_plm"}
--   core.property  FK  "FRIDA KAHLO" status=active  id cb26ec58-0edb-4d45-8c0b-ba283ffb23f8
--                      licensor_id -> FR
--   `FK` is the ONLY property under `FR` (1 of 1). It has ZERO core.character rows.
--   There is a separate, unrelated, correct property `FN` "FRIENDS" under `WB` WARNER BROS
--   -- the actual Friends TV series already lives where it belongs. Nothing below touches it.
--   Each of FR and FK carries exactly one core.taxonomy_source_ref row (designflow_plm).
--   No core.licensor row anywhere in production is 'inactive'. This ruling creates the first.
--
-- WHAT THIS MIGRATION DOES -- AND THE MUCH LARGER THING IT DELIBERATELY DOES NOT DO
-- --------------------------------------------------------------------------------
-- DOES:
--   1. Creates core.taxonomy_owner_ruling: a durable, constrained record of who ruled,
--      when, on what, and what the ruling was -- so the ruling survives independently of
--      whatever the taxonomy rows later say. Modelled directly on the approval-provenance
--      contract of core.licensor_alias (20260731210000): an owner ruling is unrepresentable
--      without a named ruler, a timestamp AND evidence, so it cannot be faked by a direct
--      service_role write.
--   2. Records ruling (a) and ruling (b) as rows in that table.
--   3. Sets core.licensor `FR` to status 'inactive' -- the unambiguous half of the ruling.
--
-- DOES NOT (escalated to the owner instead of guessed):
--   * Does NOT create a FRIDA KAHLO licensor and does NOT re-point property `FK` at it.
--     Reason, in plain business terms: plm.import_master_data() re-points an existing
--     property at whatever parent DesignFlow PLM reports, on every re-pull. Migration
--     20260802170000 protects `status`; it deliberately does NOT protect parentage,
--     because deciding that our master data outranks DesignFlow on who a property belongs
--     to is a business decision Albert has not made. Creating the licensor and re-pointing
--     `FK` today would look correct for exactly as long as it takes the next PLM sync to
--     run, and would then quietly revert -- the precise failure this repository forbids.
--     The open question is written up in
--     docs/owner-ruling-friends-tv-frida-kahlo-20260802.md.
--   * Does NOT drop, delete or archive the `FR` row, the `FK` row, their source refs, or
--     any relationship. Everything here is additive and reversible with a one-line update.
--   * Does NOT use status 'archived' or 'deleted' for `FR`, even though "created by
--     mistake" arguably reads that way. 'inactive' is the value the owner brief named and
--     the least destructive value that expresses the ruling. Escalating `FR` further is a
--     separate owner decision.
--
-- NO NEW STATUS COLUMN IS ADDED. core.licensor.status has existed since 20260621150815
-- and app.entity_status already offers 'active','inactive','archived','deleted','potential'.

-- ---------------------------------------------------------------------------
-- 1. The ruling record
-- ---------------------------------------------------------------------------
create table if not exists core.taxonomy_owner_ruling (
  id                uuid primary key default gen_random_uuid(),

  -- What the ruling is ABOUT. Kept as schema/table/id rather than a hard FK so that a
  -- ruling can be recorded about an entity that is later merged or superseded without
  -- the audit trail being dragged along or, worse, cascaded away.
  entity_schema     text not null default 'core',
  entity_table      text not null,
  entity_id         uuid,
  entity_code       text,
  entity_name       text,

  -- The ruling itself, in the owner's terms.
  ruling            text not null,

  -- PROVENANCE. Same contract as core.licensor_alias: a ruling without a named person,
  -- a timestamp and evidence is not a ruling.
  ruled_by          text not null,
  ruled_at          timestamptz not null,
  ruling_evidence   text not null,

  -- What was actually done to the data as a result -- and, just as importantly, what
  -- was NOT done and why. A reader must be able to tell a recorded opinion from an
  -- applied change without re-reading the migration.
  action_taken      text not null,
  open_questions    text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint taxonomy_owner_ruling_entity_table_not_blank
    check (length(btrim(entity_table)) > 0),
  constraint taxonomy_owner_ruling_ruling_not_blank
    check (length(btrim(ruling)) > 0),
  constraint taxonomy_owner_ruling_ruled_by_not_blank
    check (length(btrim(ruled_by)) > 0),
  constraint taxonomy_owner_ruling_evidence_not_blank
    check (length(btrim(ruling_evidence)) > 0),
  constraint taxonomy_owner_ruling_action_not_blank
    check (length(btrim(action_taken)) > 0),

  -- A ruling must point at something identifiable. An id, a code or a name -- but not
  -- three nulls, which would be an unattributable assertion floating in an audit table.
  constraint taxonomy_owner_ruling_has_a_subject
    check (
      entity_id is not null
      or (entity_code is not null and length(btrim(entity_code)) > 0)
      or (entity_name is not null and length(btrim(entity_name)) > 0)
    )
);

create index if not exists taxonomy_owner_ruling_entity_idx
  on core.taxonomy_owner_ruling (entity_schema, entity_table, entity_id);

create index if not exists taxonomy_owner_ruling_ruled_at_idx
  on core.taxonomy_owner_ruling (ruled_at desc);

drop trigger if exists set_updated_at on core.taxonomy_owner_ruling;
create trigger set_updated_at
  before update on core.taxonomy_owner_ruling
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS and grants -- identical shape to core.licensor_alias
-- ---------------------------------------------------------------------------
alter table core.taxonomy_owner_ruling enable row level security;

drop policy if exists shared_read on core.taxonomy_owner_ruling;
create policy shared_read on core.taxonomy_owner_ruling
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

revoke all on core.taxonomy_owner_ruling from public, anon, authenticated;
grant select on core.taxonomy_owner_ruling to authenticated;
grant all    on core.taxonomy_owner_ruling to service_role;

comment on table core.taxonomy_owner_ruling is
  'Durable record of owner decisions about licensor/property/character master data: who '
  'ruled, when, on what, what the ruling was, what was done about it, and what was left '
  'open. Survives independently of the taxonomy rows themselves, so a later reader can '
  'tell a deliberate curated value from an accident. Browser roles are read-only.';
comment on column core.taxonomy_owner_ruling.action_taken is
  'What was actually applied to the data, and what was deliberately NOT applied. Lets a '
  'reader distinguish a recorded opinion from an executed change without reading SQL.';
comment on column core.taxonomy_owner_ruling.open_questions is
  'Business judgements the owner has not made, which block fully applying this ruling.';
comment on column core.taxonomy_owner_ruling.ruled_at is
  'The DATE OF THE RULING, not of the migration. Pinned to midday UTC on purpose: this '
  'database runs America/New_York, so a midnight-UTC timestamp reads back one day early '
  'via ruled_at::date for any server-local reader.';

-- ---------------------------------------------------------------------------
-- 3. Albert's ruling of 2026-08-02, recorded
-- ---------------------------------------------------------------------------
-- TIMEZONE. ruled_at is pinned to '2026-08-02 12:00:00+00'. It is NOT now() -- the ruling
-- happened on 2026-08-02 regardless of when this migration runs -- and it is NOT midnight.
-- The server's timezone is America/New_York (UTC-4 in August), so '2026-08-02 00:00:00+00'
-- would render as 2026-08-01 to a server-local reader and the audit trail would state the
-- wrong day. Midday UTC = 08:00 America/New_York, so the date reads 2026-08-02 both ways.
-- This is the same trap and the same fix as 20260731220000.

do $ruling$
declare
  v_fr_id      uuid;
  v_fk_id      uuid;
  v_ruled_at   constant timestamptz := timestamptz '2026-08-02 12:00:00+00';
  v_ruler      constant text := 'Albert Hazan (owner)';
  v_evidence   constant text :=
    'Owner ruling given in session on 2026-08-02 and carried into shared-db as a dispatched '
    'implementation task. Written up in docs/owner-ruling-friends-tv-frida-kahlo-20260802.md. '
    'Production state at time of ruling (ref qsllyeztdwjgirsysgai): licensor FR "FRIENDS TV" '
    'active with exactly one property, FK "FRIDA KAHLO", which has zero characters.';
begin
  select id into v_fr_id from core.licensor where code = 'FR' and name = 'FRIENDS TV';
  select id into v_fk_id from core.property where code = 'FK' and name = 'FRIDA KAHLO';

  -- Loud, not silent. If the rows this ruling is about are not there, this migration must
  -- stop rather than record a ruling about nothing and report success.
  if v_fr_id is null then
    raise exception
      'Owner ruling 2026-08-02 cannot be applied: core.licensor (code=FR, name=FRIENDS TV) not found. '
      'Do not weaken this check -- re-verify the target database before proceeding.';
  end if;

  if v_fk_id is null then
    raise exception
      'Owner ruling 2026-08-02 cannot be applied: core.property (code=FK, name=FRIDA KAHLO) not found. '
      'Do not weaken this check -- re-verify the target database before proceeding.';
  end if;

  -- Ruling (a): FR was never a real licensor.
  insert into core.taxonomy_owner_ruling (
    entity_table, entity_id, entity_code, entity_name,
    ruling, ruled_by, ruled_at, ruling_evidence, action_taken, open_questions
  )
  select
    'licensor', v_fr_id, 'FR', 'FRIENDS TV',
    'Licensor FR "FRIENDS TV" was never a real licensor. It was created by mistake. '
    'The genuine Friends TV series is already correctly held as property FN "FRIENDS" '
    'under licensor WB WARNER BROS, which this ruling does not touch.',
    v_ruler, v_ruled_at, v_evidence,
    'APPLIED: core.licensor FR set to status ''inactive'' (was ''active''). '
    'NOT APPLIED, deliberately: the FR row, its core.taxonomy_source_ref row and its '
    'relationship to property FK are all left intact -- deleting a licensor is an owner '
    'gate this change does not hold, and nothing here is destructive or hard to reverse. '
    'Status ''archived''/''deleted'' was also not used; ''inactive'' is the least '
    'destructive value that expresses the ruling.',
    'Should a licensor created by mistake be escalated beyond ''inactive'' to '
    '''archived'' or ''deleted'', or removed entirely once property FK no longer points '
    'at it? Not decided by the owner; not assumed here.'
  where not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'licensor' and entity_id = v_fr_id and ruled_at = v_ruled_at
  );

  -- Ruling (b) + (c): FRIDA KAHLO was a property under a now-defunct FRIDA KAHLO licensor,
  -- so the current FK -> FR mapping is wrong on both halves. RECORDED ONLY -- see
  -- open_questions for exactly why the data half is not applied.
  insert into core.taxonomy_owner_ruling (
    entity_table, entity_id, entity_code, entity_name,
    ruling, ruled_by, ruled_at, ruling_evidence, action_taken, open_questions
  )
  select
    'property', v_fk_id, 'FK', 'FRIDA KAHLO',
    'FRIDA KAHLO was a property under a FRIDA KAHLO licensor, and that licensor is now '
    'defunct. The current mapping property FK -> licensor FR (FRIENDS TV) is therefore '
    'wrong on both halves: FK does not belong to FRIENDS TV, and FRIENDS TV is not a real '
    'licensor.',
    v_ruler, v_ruled_at, v_evidence,
    'RECORDED ONLY -- no data change applied to property FK. Its licensor_id, status, code '
    'and name are untouched, and nothing was dropped or deleted. The related licensor FR '
    'has been marked inactive under ruling (a), so FK is now visibly parented to an '
    'inactive licensor, which is a truthful representation of the ruling and is trivially '
    'reversible.',
    'BLOCKING OWNER DECISIONS, none of which have been made: '
    '(1) Should a new FRIDA KAHLO licensor be created in our master data at all, given it '
    'is defunct and does not exist in the DesignFlow PLM feed? '
    '(2) If yes, what licensor CODE should it carry? "FR" is taken by FRIENDS TV, and '
    'core.licensor enforces uniqueness on code. The established convention for licensors '
    'absent from the PLM/ColdLion feed is an "X-" prefix (X-NASA, X-FORD, X-NFL, added by '
    'migration 20260724021500), which would suggest "X-FRIDAKAHLO" -- but assigning a '
    'master-data code is a business decision, not an engineering one. '
    '(3) Should property FK be re-pointed to that licensor, and should FK itself also be '
    'marked inactive since its licensor is defunct? '
    '(4) DURABILITY BLOCKER: plm.import_master_data() re-points an existing property at '
    'whatever parent DesignFlow PLM reports, on every re-pull. Migration 20260802170000 '
    'protects status but deliberately does NOT protect parentage. Until the owner decides '
    'that our curated parentage outranks DesignFlow PLM, any re-point applied here would '
    'silently revert on the next sync.'
  where not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'property' and entity_id = v_fk_id and ruled_at = v_ruled_at
  );

  -- Apply the unambiguous half of the ruling.
  update core.licensor
  set status = 'inactive',
      metadata = metadata || jsonb_build_object(
        'owner_ruling', jsonb_build_object(
          'ruled_by', v_ruler,
          'ruled_on', '2026-08-02',
          'ruling', 'never a real licensor; created by mistake',
          'migration', '20260802171000'
        )
      )
  where id = v_fr_id
    and status is distinct from 'inactive';
end;
$ruling$;
