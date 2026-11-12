-- shared-db#4705 second REISSUE (20261112025353) of plm.license_agreement; byte-equivalent body to
-- 20261111230455, which is now retired: it shared PR #6075 with the failing nickname
-- migration 20261111230502, so all three automatic attempts failed on that sibling and the
-- lane parked it (trigger run 43140986121). Idempotent; never apply alongside 192349/230455.
-- shared-db#4705 REISSUE of 20261111192349 (PR #6066), identical intent, made idempotent.
-- Why: 20261111192349 is unpromotable. PR #6066's pull_request checks never ran on its
-- exact head 6685cfd (GitHub Actions outage 2026-11-11); it passed only in the merge
-- queue, so the production business-risk gate refuses it ("required exact-head checks
-- are not successful", run 43114723101). Preview already holds 20261111192349, so this
-- reissue uses IF NOT EXISTS / ON CONFLICT and is a no-op there. 20261111192349 is
-- retired in scripts/production_migration_guard.py. Never apply both in production.
-- canonical home: plm.license_agreement, linked to core.licensor.
-- Owner authority (Albert Hazan, 2026-11-11): add FOB and LDP royalty rates on the
-- production database; table placement left to the implementer (plm chosen per #4705).
--   royalty_rate     = LDP royalty rate (legacy "licenseList_royalty_rate")
--   fob_royalty_rate = FOB royalty rate (legacy "licenseList_fob_royalty_rate")
-- One row per legacy licenseList row (not per licensor): source_system/source_id keep
-- every row traceable. status copies the legacy licenseList_status verbatim because it
-- differs from core.licensor.status for some rows.
--
-- Access: server services only, like every plm table since 20260710135975:
-- service_role gets the schema's default table grants; anon/authenticated get nothing;
-- RLS enabled with no policies. Runtime-role grants come with the DesignFlow repoint.
--
-- Load: one-time copy from core."licenseList" (19 live rows read 2026-11-11). Mapping is
-- on legacy id (code alone is ambiguous: two legacy rows use code SS). Owner/coordinator
-- mappings: WWE->WW, SS id 14 (Strawberry Shortcake)->SS, SS id 18 (Sesame Street)->SM,
-- NU->NB, NK->VM, GC->ZZ, MP->ZZ, others same code.
-- NOT loaded (no core.licensor row): legacy ids 1 (DS, Dis/Mrv/SW), 8 (RB), 9 (FK),
-- 11 (AL); all but DS are INACTIVE.
-- Fail-closed: no-op when the legacy table is absent or empty (CI shadow); otherwise
-- aborts if any mapped licensor code is missing or the inserted count is not 15.
-- Purely additive. Rollback: drop table plm.license_agreement.

create table if not exists plm.license_agreement (
  id uuid primary key default gen_random_uuid(),
  licensor_id uuid not null references core.licensor (id),
  royalty_rate numeric(7,4) null check (royalty_rate is null or royalty_rate >= 0),
  fob_royalty_rate numeric(7,4) null check (fob_royalty_rate is null or fob_royalty_rate >= 0),
  status text null,
  source_system text not null default 'designflow',
  source_id text not null,
  source_code text null,
  source_title text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint license_agreement_source_key unique (source_system, source_id)
);

comment on table plm.license_agreement is
  'DesignFlow royalty rates: one row per source license agreement, not per licensor. Multiple agreements may share a licensor; consumers must select the intended agreement (shared-db#4705).';
comment on column plm.license_agreement.royalty_rate is 'LDP royalty rate, percent.';
comment on column plm.license_agreement.fob_royalty_rate is 'FOB royalty rate, percent.';

create index if not exists license_agreement_licensor_id_idx on plm.license_agreement (licensor_id);

do $trg$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'plm.license_agreement'::regclass
                 and tgname = 'set_updated_at' and not tgisinternal) then
    create trigger set_updated_at before update on plm.license_agreement
      for each row execute function app.set_updated_at();
  end if;
end
$trg$;

alter table plm.license_agreement enable row level security;
revoke all on table plm.license_agreement from anon, authenticated;
grant select, insert, update, delete on table plm.license_agreement to service_role;

do $load$
declare
  v_missing text;
  v_inserted integer;
begin
  if to_regclass('core."licenseList"') is null then
    raise notice '#4705: core."licenseList" absent; load skipped';
    return;
  end if;
  if not exists (select 1 from core."licenseList") then
    raise notice '#4705: core."licenseList" empty; load skipped';
    return;
  end if;

  create temp table _la_map (legacy_id int primary key, licensor_code text not null) on commit drop;
  insert into _la_map values
    (2,'WB'),(3,'MV'),(4,'VM'),(5,'ZZ'),(6,'ZZ'),(7,'SW'),(10,'NB'),(12,'WW'),
    (13,'CC'),(14,'SS'),(15,'SE'),(16,'PN'),(17,'VM'),(18,'SM'),(19,'AA');

  select string_agg(m.licensor_code, ',') into v_missing
  from _la_map m left join core.licensor l on l.code = m.licensor_code
  where l.id is null;
  if v_missing is not null then
    raise exception '#4705: core.licensor codes missing: %', v_missing;
  end if;

  select string_agg(m.legacy_id::text, ',') into v_missing
  from _la_map m left join core."licenseList" s on s."licenseList_id" = m.legacy_id
  where s."licenseList_id" is null;
  if v_missing is not null then
    raise exception '#4705: legacy licenseList ids missing: %', v_missing;
  end if;

  insert into plm.license_agreement
    (licensor_id, royalty_rate, fob_royalty_rate, status, source_system, source_id, source_code, source_title)
  select l.id, s."licenseList_royalty_rate"::numeric, s."licenseList_fob_royalty_rate"::numeric,
         s."licenseList_status", 'designflow', s."licenseList_id"::text,
         s."licenseList_code", s."licenseList_title"
  from _la_map m
  join core."licenseList" s on s."licenseList_id" = m.legacy_id
  join core.licensor l on l.code = m.licensor_code
  on conflict (source_system, source_id) do nothing;
  get diagnostics v_inserted = row_count;

  if (select count(*) from plm.license_agreement a
      join _la_map m on a.source_id = m.legacy_id::text
      where a.source_system = 'designflow') <> 15 then
    raise exception '#4705: expected 15 license_agreement rows, inserted %', v_inserted;
  end if;
end
$load$;
