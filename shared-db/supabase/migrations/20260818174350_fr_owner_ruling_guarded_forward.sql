-- #1090 / #1143: fresh, guarded replacement for held migration 20260802171000.
-- The old version remains readable history but must never be promoted.
--
-- AGENTS.md 6.14 (PUBLIC REPO / no personal identifiers) -- CHECKED, AND
-- `ruled_by = 'Albert Hazan (owner)'` STAYS. Reviewed 2026-08-18; do not
-- "fix" it, and do not re-raise it.
--   1. 6.14 exempts "personal names that are THE DATA ITSELF". core.taxonomy_-
--      owner_ruling.ruled_by is exactly that: the table's stated contract is
--      that "a ruling without a named person, a timestamp and evidence is not
--      a ruling" (20260802171000). The name is the stored business value, not
--      an incidental mention in a comment or a debugging note.
--   2. Same-table precedent: 20260807030000_owner_ruling_coco_is_a_disney_-
--      license.sql stores the identical literal in the identical column.
--   3. THIS MIGRATION EXISTS TO REPRODUCE ON PRODUCTION THE ROW PREVIEW
--      ALREADY HOLDS from historical 20260802171000. Writing a different
--      ruled_by would leave preview and production permanently disagreeing on
--      the content of the same owner ruling -- the divergence AGENTS.md 6.5
--      goes to some length to close, re-opened for cosmetics.
--   4. No app.profile UUID for the owner is named anywhere in this repository,
--      so "use the UUID instead" would mean inventing an identifier that
--      resolves to nothing.

create table if not exists core.taxonomy_owner_ruling (
  id uuid primary key default gen_random_uuid(),
  entity_schema text not null default 'core',
  entity_table text not null,
  entity_id uuid,
  entity_code text,
  entity_name text,
  ruling text not null,
  ruled_by text not null,
  ruled_at timestamptz not null,
  ruling_evidence text not null,
  action_taken text not null,
  open_questions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taxonomy_owner_ruling_entity_table_not_blank check (length(btrim(entity_table)) > 0),
  constraint taxonomy_owner_ruling_ruling_not_blank check (length(btrim(ruling)) > 0),
  constraint taxonomy_owner_ruling_ruled_by_not_blank check (length(btrim(ruled_by)) > 0),
  constraint taxonomy_owner_ruling_evidence_not_blank check (length(btrim(ruling_evidence)) > 0),
  constraint taxonomy_owner_ruling_action_not_blank check (length(btrim(action_taken)) > 0),
  constraint taxonomy_owner_ruling_has_a_subject check (
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
create trigger set_updated_at before update on core.taxonomy_owner_ruling
for each row execute function app.set_updated_at();

alter table core.taxonomy_owner_ruling enable row level security;
drop policy if exists shared_read on core.taxonomy_owner_ruling;
create policy shared_read on core.taxonomy_owner_ruling
for select to authenticated
using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));
revoke all on core.taxonomy_owner_ruling from public, anon, authenticated;
grant select on core.taxonomy_owner_ruling to authenticated;
grant all on core.taxonomy_owner_ruling to service_role;

do $ruling$
declare
  v_fr_id uuid;
  v_fk_id uuid;
  v_ruled_at constant timestamptz := timestamptz '2026-08-02 12:00:00+00';
  v_ruler constant text := 'Albert Hazan (owner)';
  v_plan constant uuid := '78f8489b-88ba-5d4c-8430-f7275ae6f201'::uuid;
  v_evidence constant text :=
    'Owner ruling given in session on 2026-08-02 and recorded in '
    'docs/owner-ruling-friends-tv-frida-kahlo-20260802.md. Fresh guarded '
    'replacement 20260818174350 supersedes held version 20260802171000.';
  v_rows integer;
begin
  select id into strict v_fr_id
  from core.licensor where code = 'FR' and name = 'FRIENDS TV';
  select id into strict v_fk_id
  from core.property where code = 'FK' and name = 'FRIDA KAHLO';

  insert into core.taxonomy_owner_ruling (
    entity_table, entity_id, entity_code, entity_name, ruling, ruled_by,
    ruled_at, ruling_evidence, action_taken, open_questions
  )
  select 'licensor', v_fr_id, 'FR', 'FRIENDS TV',
    'Licensor FR "FRIENDS TV" was never a real licensor. It was created by mistake.',
    v_ruler, v_ruled_at, v_evidence,
    'core.licensor FR set to inactive. Final removal remains held for the complete section 6.5 bundle.',
    'Final dependent re-homing and removal remain in the held FR bundle.'
  where not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'licensor' and entity_id = v_fr_id and ruled_at = v_ruled_at
  );

  insert into core.taxonomy_owner_ruling (
    entity_table, entity_id, entity_code, entity_name, ruling, ruled_by,
    ruled_at, ruling_evidence, action_taken, open_questions
  )
  select 'property', v_fk_id, 'FK', 'FRIDA KAHLO',
    'FRIDA KAHLO was a property under a now-defunct FRIDA KAHLO licensor; its current FR parent is wrong.',
    v_ruler, v_ruled_at, v_evidence,
    'Ruling recorded only. Property FK is unchanged in this prerequisite.',
    'Re-parenting and final FR removal remain in the held FR bundle.'
  where not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'property' and entity_id = v_fk_id and ruled_at = v_ruled_at
  );

  if (select status from core.licensor where id = v_fr_id) = 'active' then
    insert into plm.licensing_write_authorization (
      backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
      actor, protected_columns, expires_at
    ) values (
      pg_backend_pid(), txid_current(), 'core.licensor',
      'owner_ruling_fr_inactivation', v_plan,
      'd6f39e72b533b01a76977a822d8d30178c96775fa943c63b6699be9db068ddcf',
      'shared-db migration 20260818174350', array['status'],
      clock_timestamp() + interval '1 minute'
    );

    update core.licensor
    set status = 'inactive',
        metadata = metadata || jsonb_build_object('owner_ruling', jsonb_build_object(
          'ruled_by', v_ruler,
          'ruled_on', '2026-08-02',
          'ruling', 'never a real licensor; created by mistake',
          'migration', '20260818174350',
          'supersedes', '20260802171000'
        ))
    where id = v_fr_id and status = 'active';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'guarded FR owner ruling updated % rows, expected 1', v_rows; end if;
    if not exists (
      select 1 from plm.licensing_write_authorization
      where plan_id = v_plan and consumed_at is not null
        and backend_pid = pg_backend_pid() and transaction_id = txid_current()
    ) then raise exception 'FR owner-ruling authorization was not consumed in its transaction'; end if;
    if not exists (
      select 1 from plm.licensing_write_guard_audit
      where plan_id = v_plan and write_kind = 'owner_ruling_fr_inactivation'
        and target_table = 'core.licensor'::regclass and operation = 'UPDATE'
        and protected_columns = array['status']::text[]
    ) then raise exception 'FR owner-ruling update left no immutable guard audit'; end if;
  elsif (select status from core.licensor where id = v_fr_id) = 'inactive' then
    if not exists (
      select 1 from core.taxonomy_owner_ruling
      where entity_table = 'licensor' and entity_id = v_fr_id and ruled_at = v_ruled_at
    ) then raise exception 'FR is inactive without the exact owner-ruling evidence'; end if;
  else
    raise exception 'FR owner ruling expected active or already-proven inactive status';
  end if;
end;
$ruling$;
