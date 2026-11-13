-- popcre/shared-db#6269, plan docs/plan_property-name-fields.md (Steps 1-3).
-- Albert Hazan, 2026-11-13: each property carries four names kept in one place on core.property:
--   name                     Coldlion name (synced, unchanged here)
--   submission_property_name exact licensor-submission spelling, copied from the linked scrape row,
--                            never typed and never name-matched
--   nickname                 user-facing name (existing column, reused)
--   short_name               shortened form for item descriptions
-- The licensor link moves out of metadata->'submission_canonical' into real columns, and the old
-- key is blocked so nothing can write it again. Additive; no Coldlion field is touched.

alter table core.property
  add column if not exists submission_source text,
  add column if not exists submission_property_id text,
  add column if not exists submission_property_name text,
  add column if not exists short_name text;

comment on column core.property.nickname is 'User-facing name shown in POP apps.';
comment on column core.property.short_name is 'Shortened property name used in item descriptions (POP-maintained).';
comment on column core.property.submission_source is 'Licensor submission site this property is linked to (disney_opa, paramount_trackerplus).';
comment on column core.property.submission_property_id is 'The property''s id on that submission site (OPA licensed_property_id; TrackerPlus property_local_key).';
comment on column core.property.submission_property_name is 'Exact property name as the submission site spells it; filled automatically from the scrape row, never typed.';

alter table core.property
  add constraint property_submission_link_pair_ck check (
    (submission_source is null) = (submission_property_id is null)
    and (submission_source is null or submission_source in ('disney_opa', 'paramount_trackerplus'))
    and (submission_source is not null or submission_property_name is null));

create unique index if not exists property_submission_link_uq
  on core.property (submission_source, submission_property_id)
  where submission_source is not null;

-- Exact scrape spelling for one link; NULL when the scrape has no such row.
create or replace function core.submission_property_label(p_source text, p_id text)
returns text
language sql stable security definer
set search_path = pg_catalog
as $$
  select case p_source
    when 'disney_opa' then
      (select o.property_name from plm.opa_property o
        where p_id ~ '^-?[0-9]{1,18}$' and o.licensed_property_id = p_id::bigint)
    when 'paramount_trackerplus' then
      (select s.exact_label from plm.pmt_trackerplus_submission_property s
        where s.property_local_key = p_id order by s.exact_label limit 1)
  end
$$;
revoke all on function core.submission_property_label(text, text) from public, anon, authenticated;

-- Row trigger: the name always follows the link.
create or replace function core.property_submission_name_fill()
returns trigger language plpgsql security definer
set search_path = pg_catalog
as $$
declare v_sc jsonb := new.metadata->'submission_canonical';
begin
  -- A late writer of the retired metadata key (e.g. a repaired older migration) is moved into
  -- the columns; any shape that cannot be moved is left for property_no_submission_canonical_ck.
  if v_sc is not null and jsonb_typeof(v_sc) = 'object' then
    if v_sc->>'source_system' = 'disney_opa' and v_sc ? 'licensed_property_id' then
      new.submission_source := 'disney_opa';
      new.submission_property_id := v_sc->>'licensed_property_id';
      new.metadata := new.metadata - 'submission_canonical';
    elsif coalesce(v_sc->>'source_system', 'paramount_trackerplus') = 'paramount_trackerplus'
          and v_sc ? 'property_local_key' then
      new.submission_source := 'paramount_trackerplus';
      new.submission_property_id := v_sc->>'property_local_key';
      new.metadata := new.metadata - 'submission_canonical';
    end if;
  end if;
  new.submission_property_name := core.submission_property_label(new.submission_source, new.submission_property_id);
  return new;
end
$$;

create trigger property_submission_name_fill
  before insert or update of submission_source, submission_property_id, submission_property_name, metadata
  on core.property for each row execute function core.property_submission_name_fill();
revoke all on function core.property_submission_name_fill() from public, anon, authenticated;

-- Re-copy every linked name from the scrapes; returns rows changed.
create or replace function core.refresh_property_submission_name()
returns integer language plpgsql security definer
set search_path = pg_catalog
as $$
declare v_n integer;
begin
  update core.property p
     set submission_property_name = core.submission_property_label(p.submission_source, p.submission_property_id)
   where p.submission_source is not null
     and p.submission_property_name is distinct from
         core.submission_property_label(p.submission_source, p.submission_property_id);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function core.refresh_property_submission_name() from public, anon, authenticated;

create or replace function core.refresh_property_submission_name_trg()
returns trigger language plpgsql security definer
set search_path = pg_catalog
as $$
begin
  perform core.refresh_property_submission_name();
  return null;
end
$$;
revoke all on function core.refresh_property_submission_name_trg() from public, anon, authenticated;

-- Every scrape load refreshes the copies, whichever loader wrote the rows.
create trigger opa_property_refresh_submission_name
  after insert or update or delete on plm.opa_property
  for each statement execute function core.refresh_property_submission_name_trg();
create trigger trackerplus_property_refresh_submission_name
  after insert or update or delete on plm.pmt_trackerplus_submission_property
  for each statement execute function core.refresh_property_submission_name_trg();

-- Back-fill the link from metadata, then remove the old key.
-- Links without source_system were all written by 20261026150931 from TrackerPlus
-- (its taxonomy_source_ref records source_system paramount_trackerplus by property_local_key).
do $backfill$
declare v_total int; v_moved int;
begin
  select count(*) into v_total from core.property where metadata ? 'submission_canonical';

  update core.property p
     set submission_source = case
           when p.metadata->'submission_canonical'->>'source_system' = 'disney_opa' then 'disney_opa'
           when p.metadata->'submission_canonical'->>'source_system' is null
            and p.metadata->'submission_canonical'->>'migration' = '20261026150931'
            and p.metadata->'submission_canonical' ? 'property_local_key' then 'paramount_trackerplus'
         end,
         submission_property_id = coalesce(p.metadata->'submission_canonical'->>'licensed_property_id',
                                           p.metadata->'submission_canonical'->>'property_local_key')
   where p.metadata ? 'submission_canonical'
     and (p.metadata->'submission_canonical'->>'source_system' = 'disney_opa'
          or (p.metadata->'submission_canonical'->>'source_system' is null
              and p.metadata->'submission_canonical'->>'migration' = '20261026150931'
              and p.metadata->'submission_canonical' ? 'property_local_key'));
  get diagnostics v_moved = row_count;

  if v_moved <> v_total then
    raise exception 'submission_canonical back-fill moved % of % links; unknown shape present', v_moved, v_total;
  end if;

  update core.property set metadata = metadata - 'submission_canonical'
   where metadata ? 'submission_canonical';

  -- Owner ruling, Albert Hazan, 2026-11-13 2:19 PM EST (docs/owner-rulings.md): a design with only
  -- Mickey goes under 'Mickey Mouse' (OPA 372); Mickey plus anyone else goes under 'Standard
  -- Characters' (OPA 361). They are separate properties, so MM 'Standard Characters' links to 361,
  -- not 372. (X-Men is the same property as X-Men Classic: XM keeps its link.)
  if exists (select 1 from plm.opa_property where licensed_property_id = 361)
     and not exists (select 1 from core.property where submission_source = 'disney_opa' and submission_property_id = '361') then
    update core.property set submission_property_id = '361'
     where code = 'MM' and name = 'Standard Characters'
       and submission_source = 'disney_opa' and submission_property_id = '372';
  end if;
end
$backfill$;

alter table core.property
  add constraint property_no_submission_canonical_ck
  check (not coalesce(metadata ? 'submission_canonical', false));

-- Step 3: one read view with the four names and the display fallbacks.
create or replace view api.property_names with (security_invoker = false, security_barrier = true) as
select p.id,
       p.code,
       l.code as licensor_code,
       l.name as licensor_name,
       p.name,
       p.nickname,
       p.short_name,
       p.submission_source,
       p.submission_property_id,
       p.submission_property_name,
       coalesce(nullif(btrim(p.nickname), ''), p.name) as display_name,
       coalesce(nullif(btrim(p.short_name), ''), nullif(btrim(p.nickname), ''), p.name) as description_name,
       p.status
  from core.property p
  left join core.licensor l on l.id = p.licensor_id;

comment on view api.property_names is
  'Each property''s four names (Coldlion name, licensor-submission name, nickname, short name) with display_name = nickname else name and description_name = short name else nickname else name (shared-db#6269).';
revoke all on api.property_names from public, anon;
grant select on api.property_names to authenticated, service_role;

-- DesignFlow backend reads display names for its property pickers (plan Step 4).
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'designflow_prod_backend_grants') then
    grant usage on schema api to designflow_prod_backend_grants;
    grant select on api.property_names to designflow_prod_backend_grants;
  end if;
end
$grant$;
