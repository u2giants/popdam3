-- derived-from: 20260902035909, 20260902053756
--
-- Issue #2449. Exactly one table records "which Submissions property does this
-- Creative property map to". Today two ledgers claim that job:
--
--   plm.dcp_opa_property_resolution(_member)              -- live, the RPC writes it
--   plm.creative_submission_property_resolution(_member)  -- frozen, the reader reads it
--
-- The review RPC writes the first pair; api.db_data_admin_scraped_properties
-- reads the second. A decision recorded through the UI therefore never reaches
-- the screen. This migration generalises the live ledger so it can hold every
-- creative source (not just Disney DCP) and every submission identity (not just
-- an OPA licensed_property_id), moves the frozen ledger's approved crosswalk
-- rows into it, repoints the reader, and archives the frozen pair. There is no
-- dual write: the archived evidence cannot accept inserts or other mutations.

begin;

-- Source-to-source equivalence is distinct from a single canonical UUID decision.
-- NULL creative_decision_state preserves the existing DCP approval semantics.
create or replace function plm.enforce_dcp_opa_crosswalk_members()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $crosswalk$
declare
  h plm.dcp_opa_property_resolution%rowtype;
  member_count bigint;
  previous_version bigint;
begin
  select * into strict h from plm.dcp_opa_property_resolution
    where resolution_id = new.resolution_id;
  if h.creative_decision_state is null then return null; end if;
  select count(*) into member_count from plm.dcp_opa_property_resolution_member
    where resolution_id = h.resolution_id;
  if (h.creative_decision_state = 'mapped' and member_count = 0)
     or (h.creative_decision_state = 'unmapped' and member_count <> 0) then
    raise exception 'Creative crosswalk state and exact members disagree' using errcode = '23514';
  end if;
  if h.supersedes_resolution_id is not null then
    select decision_version into strict previous_version from plm.dcp_opa_property_resolution
      where resolution_id = h.supersedes_resolution_id;
    if previous_version >= h.decision_version then
      raise exception 'Creative crosswalk must supersede an earlier version' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$crosswalk$;
revoke all on function plm.enforce_dcp_opa_crosswalk_members() from public, anon, authenticated;

do $migration$
declare
  v_definition text;
  v_needle text;
  v_hits integer;
  v_headers bigint;
  v_members bigint;
  v_expected_headers bigint;
  v_expected_members bigint;
  v_expected_warner bigint;
  v_archive_header_oid oid;
  v_archive_member_oid oid;
begin
  ------------------------------------------------------------------
  -- Step 0. Preflight. Refuse to run against a shape we did not read.
  ------------------------------------------------------------------
  if to_regclass('plm.dcp_opa_property_resolution') is null
     or to_regclass('plm.dcp_opa_property_resolution_member') is null
     or to_regclass('plm.creative_submission_property_resolution') is null
     or to_regclass('plm.creative_submission_property_resolution_member') is null then
    raise exception 'issue 2449: expected all four resolution tables to exist';
  end if;

  if exists (
    select 1
    from plm.creative_submission_property_resolution r
    where exists (
            select 1 from plm.creative_submission_property_resolution_member m
            where m.resolution_id = r.resolution_id
          )
      and (r.decision_version <> 1 or r.supersedes_resolution_id is not null)
  ) then
    raise exception 'issue 2449: frozen ledger carries a supersession chain this migration does not model';
  end if;

  if exists (
    select 1
    from plm.creative_submission_property_resolution r
    join plm.dcp_opa_property_resolution d on d.resolution_id = r.resolution_id
  ) then
    raise exception 'issue 2449: resolution_id collision between the two ledgers';
  end if;

  if exists (
    select 1
    from plm.creative_submission_property_resolution r
    join plm.dcp_opa_property_resolution d
      on d.source_system = r.creative_source_system
     and d.source_table = r.creative_source_table
     and d.source_property_id = r.creative_source_id
    where r.decision_state = 'mapped'
  ) then
    raise exception 'issue 2449: creative identity already present in the live ledger';
  end if;

  v_archive_header_oid := 'plm.creative_submission_property_resolution'::regclass;
  v_archive_member_oid := 'plm.creative_submission_property_resolution_member'::regclass;

  ------------------------------------------------------------------
  -- Step 1. The live ledger is no longer Disney-only.
  --
  -- The old check pinned source_table to the three Disney DCP tables. The
  -- ledger now covers every scraped creative source (Warner, NBCU, Sega,
  -- Paramount, Coca-Cola, Peanuts, Sesame, WildBrain and the rest), so an
  -- enumerated whitelist would have to be re-migrated for each new source and
  -- would silently reject decisions in the meantime. A shape check keeps blanks
  -- and unqualified names out without freezing the source list.
  ------------------------------------------------------------------
  alter table plm.dcp_opa_property_resolution
    add column creative_decision_state text
      constraint dcp_opa_property_resolution_creative_state_ck
      check (creative_decision_state is null or
        (creative_decision_state in ('mapped','unmapped','conflict') and approval_status = 'approved'));

  -- Generic Creative decisions remain private to the audited API/service role.
  -- Existing DCP direct reads keep their original role predicate.
  alter policy dcp_opa_property_resolution_read on plm.dcp_opa_property_resolution
    using (creative_decision_state is null and (
      app.has_role('administrator'::app.app_role)
      or app.has_app_access('plm'::app.app_name)
      or app.has_any_role(array['sales'::app.app_role, 'licensing'::app.app_role])
    ));

  alter table plm.dcp_opa_property_resolution
    drop constraint dcp_opa_property_resolution_identity_ck;

  alter table plm.dcp_opa_property_resolution
    add constraint dcp_opa_property_resolution_identity_ck
    check (
      btrim(source_system) <> ''
      and btrim(source_property_id) <> ''
      and source_table ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
    );

  ------------------------------------------------------------------
  -- Step 2. Rebuild the member table around a generic submission identity.
  --
  -- The member table is append-only through an ENABLE ALWAYS trigger, so an
  -- ADD COLUMN plus UPDATE backfill would require disabling that guard.
  -- Building the replacement table and inserting into it never touches it.
  ------------------------------------------------------------------
  create table plm.dcp_opa_property_resolution_member_new (
    resolution_id uuid not null
      references plm.dcp_opa_property_resolution(resolution_id) on delete restrict,
    submission_source_system text not null,
    submission_source_table text not null,
    submission_source_id text not null,
    licensed_property_id bigint
      references plm.opa_property(licensed_property_id) on delete restrict,
    member_ordinal integer not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint dcp_opa_property_resolution_member_new_pkey
      primary key (resolution_id, submission_source_system, submission_source_table, submission_source_id),
    constraint dcp_opa_property_resolution_member_new_ordinal_key
      unique (resolution_id, member_ordinal),
    constraint dcp_opa_property_resolution_member_new_ordinal_ck
      check (member_ordinal > 0),
    constraint dcp_opa_property_resolution_member_new_identity_ck
      check (
        btrim(submission_source_system) <> ''
        and btrim(submission_source_table) <> ''
        and btrim(submission_source_id) <> ''
      ),
    -- An OPA member carries the numeric key; every other submission source
    -- carries only its own text identity. The two never disagree.
    constraint dcp_opa_property_resolution_member_new_opa_ck
      check (
        (submission_source_table = 'plm.opa_property') = (licensed_property_id is not null)
        and (licensed_property_id is null or submission_source_id = licensed_property_id::text)
      )
  );

  insert into plm.dcp_opa_property_resolution_member_new (
    resolution_id, submission_source_system, submission_source_table,
    submission_source_id, licensed_property_id, member_ordinal, created_at
  )
  select m.resolution_id, 'disney_opa', 'plm.opa_property',
    m.licensed_property_id::text, m.licensed_property_id, m.member_ordinal, m.created_at
  from plm.dcp_opa_property_resolution_member m;

  drop table plm.dcp_opa_property_resolution_member;

  alter table plm.dcp_opa_property_resolution_member_new
    rename to dcp_opa_property_resolution_member;

  alter table plm.dcp_opa_property_resolution_member
    rename constraint dcp_opa_property_resolution_member_new_pkey
    to dcp_opa_property_resolution_member_pkey;
  alter table plm.dcp_opa_property_resolution_member
    rename constraint dcp_opa_property_resolution_member_new_ordinal_key
    to dcp_opa_property_resolution_member_ordinal_key;
  alter table plm.dcp_opa_property_resolution_member
    rename constraint dcp_opa_property_resolution_member_new_ordinal_ck
    to dcp_opa_property_resolution_member_ordinal_ck;
  alter table plm.dcp_opa_property_resolution_member
    rename constraint dcp_opa_property_resolution_member_new_identity_ck
    to dcp_opa_property_resolution_member_identity_ck;
  alter table plm.dcp_opa_property_resolution_member
    rename constraint dcp_opa_property_resolution_member_new_opa_ck
    to dcp_opa_property_resolution_member_opa_ck;

  alter table plm.dcp_opa_property_resolution_member enable row level security;
  alter table plm.dcp_opa_property_resolution_member force row level security;

  -- Rebuilding a relation does not preserve its ACL. Restore the reviewed
  -- source-crosswalk privileges explicitly; default privileges are not proof.
  revoke all on plm.dcp_opa_property_resolution_member from public, anon, authenticated;
  revoke all on plm.dcp_opa_property_resolution_member from service_role;
  grant select on plm.dcp_opa_property_resolution_member to authenticated;
  grant select, insert on plm.dcp_opa_property_resolution_member to service_role;

  create policy dcp_opa_property_resolution_member_read
    on plm.dcp_opa_property_resolution_member
    for select to authenticated
    using (
      exists (select 1 from plm.dcp_opa_property_resolution h
        where h.resolution_id = dcp_opa_property_resolution_member.resolution_id
          and h.creative_decision_state is null)
      and (app.has_role('administrator'::app.app_role)
      or app.has_app_access('plm'::app.app_name)
      or app.has_any_role(array['sales'::app.app_role, 'licensing'::app.app_role]))
    );

  create trigger dcp_opa_property_resolution_member_append_only
    before delete or update on plm.dcp_opa_property_resolution_member
    for each row execute function plm.reject_dcp_opa_resolution_mutation();
  alter table plm.dcp_opa_property_resolution_member
    enable always trigger dcp_opa_property_resolution_member_append_only;

  create trigger dcp_opa_property_resolution_member_no_truncate
    before truncate on plm.dcp_opa_property_resolution_member
    for each statement execute function plm.reject_dcp_opa_resolution_mutation();
  alter table plm.dcp_opa_property_resolution_member
    enable always trigger dcp_opa_property_resolution_member_no_truncate;

  comment on table plm.dcp_opa_property_resolution_member is
    'Explicit approved crosswalk members from one versioned exact creative identity decision to stable Submissions identities. An OPA member also carries licensed_property_id. Display text and co-occurrence never populate this table.';

  ------------------------------------------------------------------
  -- Step 3. Preserve every mapping and non-overlapping explicit disposition.
  -- Overlapping non-mapped placeholders remain immutable archive evidence;
  -- they must not supersede an existing operative DCP decision.
  ------------------------------------------------------------------
  select count(*) into v_expected_headers
  from plm.creative_submission_property_resolution r
  where r.decision_state = 'mapped' or not exists (
    select 1 from plm.dcp_opa_property_resolution existing
    where existing.source_system=r.creative_source_system
      and existing.source_table=r.creative_source_table
      and existing.source_property_id=r.creative_source_id
  );
  select count(*) into v_expected_members
  from plm.creative_submission_property_resolution_member m
  join plm.creative_submission_property_resolution r using (resolution_id)
  where r.decision_state = 'mapped' or not exists (
    select 1 from plm.dcp_opa_property_resolution existing
    where existing.source_system=r.creative_source_system
      and existing.source_table=r.creative_source_table
      and existing.source_property_id=r.creative_source_id
  );
  select count(*) into v_expected_warner
  from plm.dcp_opa_property_resolution r
  where r.source_system = 'warner_starlabs' and r.approval_status = 'approved'
    and exists (select 1 from plm.dcp_opa_property_resolution_member m where m.resolution_id=r.resolution_id);
  select v_expected_warner + count(*) into v_expected_warner
  from plm.creative_submission_property_resolution r
  where r.creative_source_system = 'warner_starlabs'
    and exists (select 1 from plm.creative_submission_property_resolution_member m where m.resolution_id=r.resolution_id)
    and (r.decision_state = 'mapped' or not exists (
      select 1 from plm.dcp_opa_property_resolution existing
      where existing.source_system=r.creative_source_system
        and existing.source_table=r.creative_source_table
        and existing.source_property_id=r.creative_source_id));

  insert into plm.dcp_opa_property_resolution (
    resolution_id, source_system, source_table, source_property_id,
    decision_version, approval_status, supersedes_resolution_id,
    evidence_reference, evidence_sha256, decision_reason,
    approved_at, approved_by, created_at, creative_decision_state
  )
  select r.resolution_id, r.creative_source_system, r.creative_source_table,
    r.creative_source_id, 1, 'approved', null,
    'plm.creative_submission_property_resolution:' || r.resolution_id::text
      || ' batch ' || r.reviewed_batch_id::text,
    substring(r.reviewed_batch_digest from 8),
    'Migrated from the retired creative/submission resolution ledger by issue #2449 so that a single ledger records creative-to-submission mapping.',
    r.approved_at, r.approval_actor_id::text, r.created_at, r.decision_state
  from plm.creative_submission_property_resolution r
  where r.decision_state = 'mapped' or not exists (
    select 1 from plm.dcp_opa_property_resolution existing
    where existing.source_system=r.creative_source_system
      and existing.source_table=r.creative_source_table
      and existing.source_property_id=r.creative_source_id
  );

  get diagnostics v_headers = row_count;

  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, submission_source_system, submission_source_table,
    submission_source_id, licensed_property_id, member_ordinal, created_at
  )
  select m.resolution_id, m.submission_source_system, m.submission_source_table,
    m.submission_source_id, case when m.submission_source_table='plm.opa_property' then m.submission_source_id::bigint else null end,
    row_number() over (
      partition by m.resolution_id
      order by m.submission_source_system, m.submission_source_table, m.submission_source_id
    )::integer,
    m.created_at
  from plm.creative_submission_property_resolution_member m
  join plm.creative_submission_property_resolution r on r.resolution_id = m.resolution_id
  where exists (select 1 from plm.dcp_opa_property_resolution current_header
    where current_header.resolution_id=r.resolution_id);

  get diagnostics v_members = row_count;

  if v_headers <> v_expected_headers or v_members <> v_expected_members then
    raise exception 'issue 2449: crosswalk transfer count mismatch: headers % expected %, members % expected %', v_headers, v_expected_headers, v_members, v_expected_members;
  end if;

  if exists (
    select 1
    from plm.creative_submission_property_resolution_member m
    join plm.creative_submission_property_resolution r on r.resolution_id = m.resolution_id
    where r.decision_state = 'mapped'
      and not exists (
        select 1 from plm.dcp_opa_property_resolution_member n
        where n.resolution_id = m.resolution_id
          and n.submission_source_system = m.submission_source_system
          and n.submission_source_table = m.submission_source_table
          and n.submission_source_id = m.submission_source_id
      )
  ) then
    raise exception 'issue 2449: a frozen crosswalk member did not survive the move';
  end if;

  ------------------------------------------------------------------
  -- Step 4. Point the reader at the surviving ledger.
  --
  -- The body is seven hundred lines of unrelated logic, so it is re-derived
  -- from the catalog and edited in place rather than restated. Each edit must
  -- match exactly once or the migration refuses to run.
  ------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname = 'db_data_admin_scraped_properties';

  if v_definition is null then
    raise exception 'issue 2449: api.db_data_admin_scraped_properties not found';
  end if;

  v_needle := $old1$  ), page_creative_decision as materialized (
    select o.row_key, r.*
    from ordered o
    left join lateral (
      select candidate.*
      from plm.creative_submission_property_resolution candidate
      where candidate.creative_source_system=o.source_system
        and candidate.creative_source_table=o.source_table
        and candidate.creative_source_id=o.source_property_id
        and not exists (
          select 1
          from plm.creative_submission_property_resolution newer
          where newer.supersedes_resolution_id=candidate.resolution_id
        )
      order by candidate.decision_version desc,
        candidate.approved_at desc,candidate.resolution_id desc
      limit 1
    ) r on true
  ), page_submission_identity as materialized (
    select distinct m.submission_source_system,m.submission_source_table,
      m.submission_source_id
    from page_creative_decision d
    join plm.creative_submission_property_resolution_member m
      on m.resolution_id=d.resolution_id$old1$;

  v_hits := (length(v_definition) - length(replace(v_definition, v_needle, '')))
            / nullif(length(v_needle), 0);
  if v_hits is distinct from 1 then
    raise exception 'issue 2449: expected 1 creative-decision CTE to rewrite, found %', v_hits;
  end if;

  v_definition := replace(v_definition, v_needle, $new1$  ), page_creative_decision as materialized (
    select o.row_key, r.resolution_id,
      (case
        when r.creative_decision_state is not null then r.creative_decision_state
        when r.resolution_id is null then null
        when r.approval_status='approved' and exists (
          select 1 from plm.dcp_opa_property_resolution_member mm
          where mm.resolution_id=r.resolution_id
        ) then 'mapped'
        else 'unmapped'
      end)::text as decision_state
    from ordered o
    left join lateral (
      select candidate.*
      from plm.dcp_opa_property_resolution candidate
      where candidate.source_system=o.source_system
        and candidate.source_table=o.source_table
        and candidate.source_property_id=o.source_property_id
        -- Pending rows are proposals, not terminal decisions. Read the newest
        -- approved/rejected version so a later pending proposal cannot hide an
        -- approval, while a later rejection still supersedes that approval.
        and candidate.approval_status in ('approved','rejected')
      order by candidate.decision_version desc,
        candidate.approved_at desc nulls last,candidate.resolution_id desc
      limit 1
    ) r on true
  ), page_submission_identity as materialized (
    select distinct m.submission_source_system,m.submission_source_table,
      m.submission_source_id
    from page_creative_decision d
    join plm.dcp_opa_property_resolution_member m
      on m.resolution_id=d.resolution_id$new1$);

  v_needle := $old2$      from plm.creative_submission_property_resolution_member m$old2$;
  v_hits := (length(v_definition) - length(replace(v_definition, v_needle, '')))
            / nullif(length(v_needle), 0);
  if v_hits is distinct from 1 then
    raise exception 'issue 2449: expected 1 enriched member read to rewrite, found %', v_hits;
  end if;
  v_definition := replace(v_definition, v_needle,
    $new2$      from plm.dcp_opa_property_resolution_member m$new2$);

  if position('creative_submission_property_resolution' in v_definition) > 0 then
    raise exception 'issue 2449: the reader still references the retired ledger';
  end if;

  execute v_definition;

  ------------------------------------------------------------------
  -- Step 5. The writer must supply the new submission identity columns.
  ------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname = 'db_data_admin_decide_property_match';

  if v_definition is null then
    raise exception 'issue 2449: api.db_data_admin_decide_property_match not found';
  end if;

  v_needle := $old3$      insert into plm.dcp_opa_property_resolution_member (
        resolution_id, licensed_property_id, member_ordinal
      )
      select v_written.resolution_id, s.licensed_property_id, s.member_ordinal$old3$;
  v_hits := (length(v_definition) - length(replace(v_definition, v_needle, '')))
            / nullif(length(v_needle), 0);
  if v_hits is distinct from 1 then
    raise exception 'issue 2449: expected 1 member insert to rewrite, found %', v_hits;
  end if;

  v_definition := replace(v_definition, v_needle, $new3$      insert into plm.dcp_opa_property_resolution_member (
        resolution_id, submission_source_system, submission_source_table,
        submission_source_id, licensed_property_id, member_ordinal
      )
      select v_written.resolution_id, 'disney_opa', 'plm.opa_property',
        s.licensed_property_id::text, s.licensed_property_id, s.member_ordinal$new3$);

  execute v_definition;

  ------------------------------------------------------------------
  -- Step 6. The mappings the issue names must still stand on the one ledger.
  ------------------------------------------------------------------
  if exists (
    select 1
    from plm.dcp_opa_property_resolution r
    where r.approval_status = 'approved'
      and coalesce(r.creative_decision_state,'mapped') = 'mapped'
      and r.source_system in ('warner_starlabs','nbcu_creative_asset_factory','sega_dsi')
      and not exists (
        select 1 from plm.dcp_opa_property_resolution_member m
        where m.resolution_id = r.resolution_id
      )
  ) then
    raise exception 'issue 2449: a migrated mapping lost its crosswalk members';
  end if;

  select count(*) into v_members
  from plm.dcp_opa_property_resolution r
  where r.source_system = 'warner_starlabs'
    and r.approval_status = 'approved'
    and exists (
      select 1 from plm.dcp_opa_property_resolution_member m
      where m.resolution_id = r.resolution_id
    );

  if v_members <> v_expected_warner then
    raise exception 'issue 2449: Warner crosswalk count changed: found %, expected %', v_members, v_expected_warner;
  end if;

  -- The Disney titles named in the issue are decided in the live ledger and
  -- must still resolve to an approved head with members.
  if exists (
    select 1
    from plm.dcp_opa_property_resolution r
    where r.approval_status = 'approved'
      and coalesce(r.creative_decision_state,'mapped') = 'mapped'
      and not exists (
        select 1 from plm.dcp_opa_property_resolution newer
        where newer.supersedes_resolution_id = r.resolution_id
      )
      and not exists (
        select 1 from plm.dcp_opa_property_resolution_member m
        where m.resolution_id = r.resolution_id
      )
  ) then
    raise exception 'issue 2449: an approved head decision has no crosswalk members';
  end if;

  ------------------------------------------------------------------
  -- Step 7. Retire the frozen pair. Nothing reads it any more.
  ------------------------------------------------------------------
  -- Preserve every historical disposition, actor, timestamp and member byte.
  -- Overlapping stale placeholders remain evidence, never superseding a live decision.
  alter table plm.creative_submission_property_resolution
    rename to creative_submission_property_resolution_archive;
  alter table plm.creative_submission_property_resolution_member
    rename to creative_submission_property_resolution_member_archive;
  revoke all on plm.creative_submission_property_resolution_archive,
    plm.creative_submission_property_resolution_member_archive from public, anon, authenticated, service_role;
  grant select on plm.creative_submission_property_resolution_archive,
    plm.creative_submission_property_resolution_member_archive to service_role;
  create trigger creative_submission_property_resolution_archive_no_insert
    before insert on plm.creative_submission_property_resolution_archive
    for each row execute function plm.reject_creative_submission_property_resolution_mutation();
  alter table plm.creative_submission_property_resolution_archive
    enable always trigger creative_submission_property_resolution_archive_no_insert;
  create trigger creative_submission_member_archive_no_insert
    before insert on plm.creative_submission_property_resolution_member_archive
    for each row execute function plm.reject_creative_submission_property_resolution_mutation();
  alter table plm.creative_submission_property_resolution_member_archive
    enable always trigger creative_submission_member_archive_no_insert;
  if 'plm.creative_submission_property_resolution_archive'::regclass::oid <> v_archive_header_oid
     or 'plm.creative_submission_property_resolution_member_archive'::regclass::oid <> v_archive_member_oid then
    raise exception 'issue 2449: archival did not preserve the original relations';
  end if;

  create constraint trigger dcp_opa_property_resolution_mapping_members_check
    after insert or update on plm.dcp_opa_property_resolution
    deferrable initially deferred for each row
    execute function plm.enforce_dcp_opa_crosswalk_members();
  create constraint trigger dcp_opa_property_resolution_member_mapping_header_check
    after insert or update on plm.dcp_opa_property_resolution_member
    deferrable initially deferred for each row
    execute function plm.enforce_dcp_opa_crosswalk_members();

end;
$migration$;

do $verify$
begin
  if to_regclass('plm.creative_submission_property_resolution') is not null
     or to_regclass('plm.creative_submission_property_resolution_member') is not null then
    raise exception 'issue 2449: the retired ledger still exists';
  end if;

  if (
    select count(*)
    from pg_attribute a
    where a.attrelid = 'plm.dcp_opa_property_resolution_member'::regclass
      and a.attname in ('submission_source_system','submission_source_table','submission_source_id')
      and a.attnotnull
  ) <> 3 then
    raise exception 'issue 2449: the surviving member table lacks the submission identity';
  end if;

  if exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'plm.dcp_opa_property_resolution_member'::regclass
      and a.attname = 'licensed_property_id'
      and a.attnotnull
  ) then
    raise exception 'issue 2449: licensed_property_id must be optional for non-OPA members';
  end if;

  if not exists (
    select 1 from pg_class c
    where c.oid = 'plm.dcp_opa_property_resolution_member'::regclass
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'issue 2449: row level security was not restored';
  end if;

  if (
    select count(*) from pg_trigger
    where tgrelid = 'plm.dcp_opa_property_resolution_member'::regclass
      and tgname in ('dcp_opa_property_resolution_member_append_only','dcp_opa_property_resolution_member_no_truncate')
      and not tgisinternal and tgenabled = 'A'
  ) <> 2 then
    raise exception 'issue 2449: the append-only guards were not restored as ENABLE ALWAYS';
  end if;

  if not has_table_privilege('authenticated', 'plm.dcp_opa_property_resolution_member', 'SELECT')
     or not has_table_privilege('service_role', 'plm.dcp_opa_property_resolution_member', 'SELECT')
     or not has_table_privilege('service_role', 'plm.dcp_opa_property_resolution_member', 'INSERT')
     or has_table_privilege('authenticated', 'plm.dcp_opa_property_resolution_member', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_table_privilege('anon', 'plm.dcp_opa_property_resolution_member', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_table_privilege('service_role', 'plm.dcp_opa_property_resolution_member', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'issue 2449: source-crosswalk privilege parity was not restored';
  end if;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'plm.dcp_opa_property_resolution_member'::regclass
      and polname = 'dcp_opa_property_resolution_member_read'
  ) then
    raise exception 'issue 2449: the read policy was not restored';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname in ('db_data_admin_scraped_properties','db_data_admin_decide_property_match')
      and pg_get_functiondef(p.oid) like '%creative_submission_property_resolution%'
  ) then
    raise exception 'issue 2449: an api routine still references the retired ledger';
  end if;
end;
$verify$;

commit;
